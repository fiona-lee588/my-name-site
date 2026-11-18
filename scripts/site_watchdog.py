#!/usr/bin/env python3
"""网站看门狗：每小时检查网站关键页面，只在 故障发生/恢复 时发邮件（不刷屏）。

邮件走 163 SMTP，账号密码在仓库加密密钥 WATCHDOG_MAIL_USER / WATCHDOG_MAIL_PASS。
状态记在 watchdog/state.json，随仓库持久化。
"""
import json
import os
import smtplib
import urllib.request
from datetime import datetime, timezone
from email.header import Header
from email.mime.text import MIMEText
from pathlib import Path

URLS = [
    "https://mychinesename.co/",
    "https://mychinesename.co/name/qingyang/",
    "https://mychinesename.co/assets/pins/card_11.png",
]
STATE = Path("watchdog/state.json")
USER = os.environ["WATCHDOG_MAIL_USER"]
PASSWORD = os.environ["WATCHDOG_MAIL_PASS"]
TO = ["13701333366@163.com", "fionalee588@outlook.com"]


def check(url: str) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "vm-watchdog/1.0"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status == 200
    except Exception:
        return False


def send(subject: str, body: str) -> None:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = USER
    msg["To"] = ", ".join(TO)
    with smtplib.SMTP_SSL("smtp.163.com", 465, timeout=30) as client:
        client.login(USER, PASSWORD)
        client.sendmail(USER, TO, msg.as_string())


def main() -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    results = {u: check(u) for u in URLS}
    up = all(results.values())
    print(json.dumps({"up": up, "results": results}, ensure_ascii=False))

    prev = json.loads(STATE.read_text(encoding="utf-8")) if STATE.is_file() else None
    prev_up = prev["up"] if prev else None

    if prev_up is None:
        new = {"up": up, "since": now, "note": "first run"}
    elif prev_up != up:
        if not up:
            bad = [u for u, ok in results.items() if not ok]
            send("【看门狗】起名网站打不开了", f"{now}\n以下地址访问失败：\n" + "\n".join(bad)
                 + "\n\n虚拟的我已发现异常，正在排查。")
        else:
            send("【看门狗】起名网站已恢复", f"{now}\n网站已恢复正常。")
        new = {"up": up, "since": now}
    else:
        new = {"up": up, "since": (prev or {}).get("since", now)}

    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(new, ensure_ascii=False, indent=2), encoding="utf-8")


main()
