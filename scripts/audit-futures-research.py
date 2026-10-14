"""以標準函式庫獨立重算逐筆淨損益與實際歷史資金費率，不共用 TS 統計 helper。"""
import json
import math
import pathlib
import sys


def audit(directory):
    directory = pathlib.Path(directory)
    report = json.loads((directory / "results.json").read_text())
    data = {symbol: json.loads((directory / f"{symbol}.json").read_text()) for symbol in report["manifest"]["symbols"]}
    # 目前候選沒有模型強平；一般成交逐筆以實際含滑價價格、雙邊費用及結算現金流核對。
    groups = [report[key] for key in ("holdout", "stress", "full", "holdoutStress") if key in report]
    checked = 0
    for group in groups:
        fee_rate = 0.0012 if group is report.get("stress") or group is report.get("holdoutStress") else 0.0006
        trades = group["tradeRecords"]
        for trade in trades:
            source = data[trade["symbol"]]
            marks = {c["openTime"]: c["open"] for c in source["marks"]}
            direction = 1 if trade["side"] == "LONG" else -1
            assert "模型強平" not in trade["exitReason"], "強平需按保證金上限另驗證"
            gross = direction * (trade["exitPrice"] - trade["entryPrice"]) * trade["quantity"]
            fees = (trade["entryPrice"] + trade["exitPrice"]) * trade["quantity"] * fee_rate
            funding = sum(-direction * trade["quantity"] * marks[p["time"]] * p["rate"]
                          for p in source["funding"] if trade["entryTime"] < p["time"] <= trade["exitTime"])
            for actual, expected in [(trade["fee"], fees), (trade["fundingPnl"], funding), (trade["pnl"], gross - fees + funding)]:
                assert math.isclose(actual, expected, abs_tol=1e-8), (trade, actual, expected)
            assert group["from"] <= trade["entryTime"] <= trade["exitTime"] < group["to"]
            checked += 1
        pooled = group["pooled"]
        assert pooled["trades"] == len(trades)
        assert pooled["wins"] == sum(t["pnl"] > 0 for t in trades)
        assert math.isclose(pooled["netPnl"], sum(t["pnl"] for t in trades), abs_tol=1e-8)
    print(json.dumps({"directory": str(directory), "checkedTrades": checked, "result": "損益、費用與歷史結算獨立核對通過"}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("請指定研究結果資料夾")
    for folder in sys.argv[1:]:
        audit(folder)
