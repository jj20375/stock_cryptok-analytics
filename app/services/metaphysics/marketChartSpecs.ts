/** @file 三個市場的紫微「本命盤」出生時刻設定；產生器與執行期共用。修改後必須重跑產生器並升版 ZIWEI_RULE_VERSION。 */

/** 市場代碼，與 klineStore 的 MarketType 相同字串。 */
export type MetaMarket = 'TW' | 'CRYPTO' | 'US';

export interface MarketChartSpec {
  market: MetaMarket;
  /** 顯示名稱。 */
  label: string;
  /** 本命盤國曆日期（當地時間）YYYY-M-D，iztro 的輸入格式。 */
  solarDate: string;
  /** iztro 時辰序號：5 巳時（09–11）、6 午時（11–13）、9 酉時（17–19）。 */
  timeIndex: number;
  /** 出生時刻文字說明（含依據），頁面顯示用。 */
  birthNote: string;
  /** 時辰是否為假設（史料無記載）；true 時頁面必須註明。 */
  timeAssumed: boolean;
  /** 流日換日所依據的 IANA 時區，與該市場日 K 收盤切法一致。 */
  timeZone: string;
  /** 回測與回填使用的行情代號：股市為 Yahoo 指數代號，加密貨幣為交易對。 */
  quoteSymbol: string;
}

/**
 * 市場盤性別一律以「男」排盤：紫微的大限順逆需要性別，市場沒有性別，這是本系統的約定。
 * 評分只用流年、流月、流日，大限只作背景顯示，因此性別約定不影響分數。
 */
export const MARKET_CHART_GENDER = '男' as const;

export const MARKET_CHART_SPECS: Record<MetaMarket, MarketChartSpec> = {
  TW: { market: 'TW', label: '台股', solarDate: '1962-2-9', timeIndex: 5, timeAssumed: false,
    birthNote: '臺灣證券交易所開業 1962-02-09 09:00（台北）', timeZone: 'Asia/Taipei', quoteSymbol: '^TWII' },
  CRYPTO: { market: 'CRYPTO', label: 'BTC', solarDate: '2009-1-3', timeIndex: 9, timeAssumed: false,
    birthNote: '比特幣創世區塊 2009-01-03 18:15 UTC', timeZone: 'UTC', quoteSymbol: 'BTCUSDT' },
  US: { market: 'US', label: '美股', solarDate: '1792-5-17', timeIndex: 6, timeAssumed: true,
    birthNote: 'NYSE 梧桐樹協議 1792-05-17，史料無時辰，假設為午時', timeZone: 'America/New_York', quoteSymbol: '^GSPC' },
};

/** 各市場出生年（國曆），計算大限虛歲用。 */
export const MARKET_BIRTH_YEAR: Record<MetaMarket, number> = { TW: 1962, CRYPTO: 2009, US: 1792 };
