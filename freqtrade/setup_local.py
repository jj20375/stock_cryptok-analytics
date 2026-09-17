#!/usr/bin/env python3
"""建立本機模擬服務設定與專用同步金鑰，不覆寫現有設定，也不輸出秘密。"""
import argparse
import json
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parent

def write_private(path, value):
    # 檔案從建立時即限制權限，避免設定初始化期間短暫暴露密碼。
    with open(path, "x", opener=lambda p, flags: __import__("os").open(p, flags, 0o600)) as stream:
        stream.write(value)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dashboard-url", default="http://host.docker.internal:8787/api/freqtrade/sync")
    args = parser.parse_args()
    config_path = ROOT / "user_data/config.dryrun.local.json"
    if not config_path.exists():
        config = json.loads((ROOT / "user_data/config.dryrun.example.json").read_text())
        config["api_server"].update(username="dashboard", password=secrets.token_urlsafe(36),
                                     jwt_secret_key=secrets.token_urlsafe(36), ws_token=secrets.token_urlsafe(36))
        write_private(config_path, json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    settings_path = ROOT / "user_data/config.sync.local.json"
    dev_vars = ROOT.parent / ".dev.vars"
    existing = dev_vars.read_text() if dev_vars.exists() else ""
    match = re.search(r"^FREQTRADE_SYNC_SECRET=(.*)$", existing, re.M)
    if not settings_path.exists():
        secret = match[1].strip().strip('\"\'') if match else secrets.token_urlsafe(36)
        write_private(settings_path, json.dumps({"dashboard_url": args.dashboard_url, "sync_secret": secret}, indent=2) + "\n")
    settings = json.loads(settings_path.read_text())
    if settings["dashboard_url"] != args.dashboard_url:
        # 網址可在部署後切換，但同步金鑰必須維持不變，否則會導致遠端拒絕摘要。
        settings["dashboard_url"] = args.dashboard_url
        settings_path.write_text(json.dumps(settings, indent=2) + "\n")
    if match and match[1].strip().strip('\"\'') != settings["sync_secret"]:
        raise SystemExit("本機金鑰不一致，請自行核對設定；未覆寫任何秘密。")
    if not match:
        # 只追加本功能的金鑰，既有登入及其他服務設定保持原樣。
        import os
        with os.fdopen(os.open(dev_vars, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), "a") as stream:
            stream.write("\nFREQTRADE_SYNC_SECRET=" + settings["sync_secret"] + "\n")
    print("本機模擬設定就緒。同步金鑰已寫入忽略追蹤的本機設定，未顯示於終端。")

if __name__ == "__main__":
    main()
