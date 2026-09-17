#!/usr/bin/env python3
"""只讀取 Freqtrade 模擬摘要，失敗不補造零值；Dashboard 自行判斷資料過期。"""
from __future__ import annotations
import argparse
import base64
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("不允許同步服務重新導向")

def request_json(url, headers=None, body=None):
    # Cloudflare 可拒絕沒有 User-Agent 的 Python 預設請求；固定識別不含帳戶或策略秘密。
    request_headers = {"User-Agent": "wave-radar-dry-run-sync/1.0", "Accept": "application/json"}
    request_headers.update(headers or {})
    request = urllib.request.Request(url, data=body, headers=request_headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise ValueError("API 回應過大")
        return json.loads(raw)

def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None

def ratio_pct(value):
    value = number(value)
    return None if value is None else value * 100

def normalize_metrics(profit, positions):
    closed = profit.get("closed_trade_count")
    if type(closed) is not int or closed < 0 or not isinstance(positions, list):
        raise ValueError("缺少已平倉樣本數")
    # 官方 winrate、max_drawdown 為比例；收益採已平倉損益／初始資金，不能加總單筆百分比。
    return {
        "totalTrades": closed,
        "winRatePct": ratio_pct(profit.get("winrate")) if closed else None,
        "profitFactor": number(profit.get("profit_factor")) if closed and profit.get("losing_trades", 0) > 0 else None,
        "maxDrawdownPct": ratio_pct(profit.get("max_drawdown")) if closed else None,
        "netProfitPct": number(profit.get("profit_closed_percent")) if closed else None,
        "openTrades": len(positions),
    }

def dry_run_payload(api_url, config, now_ms):
    parsed = urlparse(api_url)
    if parsed.scheme != "http" or parsed.hostname not in {"freqtrade", "127.0.0.1", "localhost"} or parsed.username:
        raise ValueError("Freqtrade API 僅允許本機或 Docker 服務位址")
    api = config["api_server"]
    credentials = base64.b64encode(f'{api["username"]}:{api["password"]}'.encode()).decode()
    headers = {"Authorization": f"Basic {credentials}"}
    get = lambda path: request_json(f"{api_url.rstrip('/')}/api/v1/{path}", headers)
    actual = get("show_config")
    if actual.get("dry_run") is not True or actual.get("trading_mode") != "spot":
        raise ValueError("只允許現貨模擬資料")
    if actual.get("strategy") != config["strategy"] or actual.get("timeframe") != config["timeframe"]:
        raise ValueError("執行策略與同步設定不一致")
    version = actual.get("strategy_version")
    if not version:
        raise ValueError("策略必須提供 version()")
    profit, positions, health = get("profit"), get("status"), get("health")
    pairs = get("whitelist")["whitelist"]
    # 心跳為秒，績效日期為毫秒；連續三分鐘沒有策略迴圈即顯示異常。
    last = number(health.get("last_process_ts"))
    state = str(actual.get("state", "")).lower()
    status = "STOPPED" if state == "stopped" else "RUNNING" if state == "running" and last and 0 <= now_ms / 1000 - last <= 180 else "ERROR"
    scope = {key: config.get(key) for key in ("stake_amount", "max_open_trades", "fee", "dry_run_wallet", "db_url")}
    # 只雜湊交易設定，排除所有憑證；固定資料庫對應同一實驗。
    scope.update(exchange=actual["exchange"], pairs=pairs, strategy_version=version)
    fingerprint = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()[:20]
    return {
        "schemaVersion": 1, "runId": f"dry-{config['bot_name']}-{fingerprint}", "mode": "DRY_RUN",
        "strategyVersion": version, "strategyName": actual["strategy"], "exchange": actual["exchange"],
        "timeframe": actual["timeframe"], "status": status, "generatedAt": now_ms,
        "metrics": normalize_metrics(profit, positions),
        "research": {
            "pairs": pairs, "periodStart": profit.get("bot_start_timestamp") or None,
            "periodEnd": now_ms, "engineVersion": actual["version"], "configurationId": fingerprint,
            "feeRate": number(config.get("fee")), "slippageBps": None,
        },
    }

def send_payload(payload, settings):
    url, secret = settings["dashboard_url"], settings["sync_secret"]
    parsed = urlparse(url)
    if parsed.username or parsed.fragment or parsed.query or parsed.path != "/api/freqtrade/sync":
        raise ValueError("同步位址必須指向 /api/freqtrade/sync")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "host.docker.internal"}):
        raise ValueError("外部同步必須使用 HTTPS")
    if len(secret) < 32:
        raise ValueError("同步金鑰至少需要 32 字元")
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(raw) > 32768:
        raise ValueError("同步摘要超過大小上限")
    timestamp = str(int(time.time() * 1000))
    signature = hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    result = request_json(url, {"Content-Type": "application/json", "X-Freqtrade-Timestamp": timestamp, "X-Freqtrade-Signature": signature}, raw)
    if result.get("accepted") is not True:
        raise ValueError("同步未被接受")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="user_data/config.dryrun.local.json")
    parser.add_argument("--settings", default="user_data/config.sync.local.json")
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    settings = json.loads(Path(args.settings).read_text())
    while True:
        try:
            payload = dry_run_payload(os.environ.get("FREQTRADE_API_URL", "http://127.0.0.1:8080"), config, int(time.time() * 1000))
            send_payload(payload, settings)
            print("模擬研究摘要已同步", flush=True)
        except urllib.error.HTTPError as error:
            # 僅保留狀態碼供診斷，避免把遠端回應內容或任何憑證寫進容器日誌。
            print(f"同步失敗（HTTP {error.code}），請檢查服務狀態與設定", flush=True)
            if not args.loop:
                raise SystemExit(1) from None
        except Exception as error:
            # 不輸出 URL、回應內容或憑證；下一輪重試，前端保留過期標記。
            print(f"同步失敗（{type(error).__name__}），請檢查服務狀態與設定", flush=True)
            if not args.loop:
                raise SystemExit(1) from None
        if not args.loop:
            return
        time.sleep(60)

if __name__ == "__main__":
    main()
