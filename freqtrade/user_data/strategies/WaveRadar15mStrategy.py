"""波段雷達 Freqtrade 試點策略。

這是研究與 Dry-run 專用策略：1d 判斷趨勢、4h 計算區間突破與 ATR、15m 等待價格
越過參考位才入場。它與網站既有 crypto_wave 同一方向，但成交模型及指標函式不同，
不可把兩套回測結果直接視為完全相同；必須通過樣本外與 Dry-run 比對才可評估。
"""

from __future__ import annotations

import pandas as pd
from pandas import DataFrame

from freqtrade.strategy import IStrategy, informative


class WaveRadar15mStrategy(IStrategy):
    """用短週期進場、長週期確認的現貨做多策略，無做空與無實盤設定。"""

    INTERFACE_VERSION = 3
    can_short = False
    timeframe = "15m"
    process_only_new_candles = True
    startup_candle_count = 400

    # 8% 是試點期間的硬上限；4h ATR 只用來過濾過度波動幣，尚未取代交易所停損。
    stoploss = -0.08
    minimal_roi = {}
    use_exit_signal = True
    exit_profit_only = False

    def version(self) -> str:
        return "wave-15m-v2-experimental"

    @staticmethod
    def _atr(dataframe: DataFrame, period: int = 14) -> pd.Series:
        """以簡單移動平均計算 ATR；維持可讀性並避免引入額外指標套件。"""
        prior_close = dataframe["close"].shift(1)
        true_range = pd.concat([
            dataframe["high"] - dataframe["low"],
            (dataframe["high"] - prior_close).abs(),
            (dataframe["low"] - prior_close).abs(),
        ], axis=1).max(axis=1)
        return true_range.rolling(period, min_periods=period).mean()

    @informative("1d")
    def populate_indicators_1d(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """日線 MA20/MA50 只在已收盤日線確認趨勢，避免日內資料偷看收盤。"""
        dataframe["ma20"] = dataframe["close"].rolling(20, min_periods=20).mean()
        dataframe["ma50"] = dataframe["close"].rolling(50, min_periods=50).mean()
        dataframe["daily_trend"] = (
            (dataframe["close"] > dataframe["ma20"])
            & (dataframe["ma20"] > dataframe["ma50"])
            & (dataframe["ma20"] > dataframe["ma20"].shift(1))
        ).astype(int)
        return dataframe

    @informative("4h")
    def populate_indicators_4h(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """4h 區間必須排除當前 K 線，20 根前高與均量才不會有前視偏差。"""
        dataframe["atr14"] = self._atr(dataframe)
        dataframe["breakout_level"] = dataframe["high"].shift(1).rolling(20, min_periods=20).max()
        dataframe["volume_mean20"] = dataframe["volume"].shift(1).rolling(20, min_periods=20).mean()
        # 已收盤 4h 同時突破與放量，單純放量不能當成結構突破。
        dataframe["breakout_volume_ok"] = ((dataframe["volume"] >= dataframe["volume_mean20"] * 2)
                                           & (dataframe["close"] > dataframe["breakout_level"])).astype(int)
        dataframe["exit_floor"] = dataframe["low"].shift(1).rolling(10, min_periods=10).min()
        return dataframe

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # 15m 量能只作為執行品質過濾，主訊號仍由完整的 1d/4h 收盤資料決定。
        dataframe["volume_mean20"] = dataframe["volume"].shift(1).rolling(20, min_periods=20).mean()
        dataframe["volume_ok"] = dataframe["volume"] >= dataframe["volume_mean20"] * 1.2
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        reference = dataframe["breakout_level_4h"]
        atr = dataframe["atr14_4h"]
        # 15m 價格由下向上越過已確認的 4h 前高才進場；距離超過 1 ATR 時不追價。
        crossed_breakout = (dataframe["close"] > reference) & (dataframe["close"].shift(1) <= reference.shift(1))
        # 2 ATR 只作過濾；模擬停損仍固定 8%，不是動態 ATR 停損。
        risk_pct = 2 * atr / dataframe["close"] * 100
        conditions = (
            (dataframe["volume"] > 0)
            & (dataframe["daily_trend_1d"] == 1)
            & (dataframe["breakout_volume_ok_4h"] == 1)
            & dataframe["volume_ok"]
            & crossed_breakout
            & ((dataframe["close"] - reference) <= atr)
            & (risk_pct > 0)
            & (risk_pct <= 8)
        )
        dataframe.loc[conditions, ["enter_long", "enter_tag"]] = (1, "15m_breakout_with_4h_trend")
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # 4h 收盤跌破先前 10 根低點時，下一個可執行週期送出退出訊號。
        conditions = (
            (dataframe["close_4h"] < dataframe["exit_floor_4h"])
            | (dataframe["daily_trend_1d"] == 0)
        )
        dataframe.loc[conditions, ["exit_long", "exit_tag"]] = (1, "4h_structure_exit")
        return dataframe
