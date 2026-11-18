#!/usr/bin/env python3
"""Post ONE queued pin to Pinterest via v5 API, then mark it posted in queue.json.

Run by GitHub Actions (runs overseas, can reach api.pinterest.com).
Token comes from repo secret PINTEREST_TOKEN (never commit it).
"""
import datetime
import json
import os
import sys
import urllib.request

API = "https://api.pinterest.com/v5"
TOKEN = os.environ["PINTEREST_TOKEN"]
BOARD_NAME = os.environ.get("PINTEREST_BOARD", "Chinese Names")
SITE = os.environ.get("SITE_URL", "https://mychinesename.co").rstrip("/")
DRY = os.environ.get("DRY_RUN") == "1"


def req(method, path, body=None):
    r = urllib.request.Request(API + path, method=method)
    r.add_header("Authorization", "Bearer " + TOKEN)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, data=data, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:500])
        sys.exit(2)


def main():
    with open("pinterest/queue.json", encoding="utf-8") as f:
        q = json.load(f)
    nxt = next((p for p in q["pins"] if not p.get("posted")), None)
    if not nxt:
        print("QUEUE_EMPTY: nothing to post")
        return

    boards = req("GET", "/boards?owner=me&page_size=100")
    board = next((b for b in boards.get("items", []) if b.get("name") == BOARD_NAME), None)
    if not board:
        print("BOARD_NOT_FOUND:", BOARD_NAME, "| available:",
              [b.get("name") for b in boards.get("items", [])])
        sys.exit(1)

    body = {
        "board_id": board["id"],
        "image_source": f"{SITE}/assets/pins/{nxt['image']}",
        "title": nxt["title"][:100],
        "description": nxt["description"][:500],
        "link": f"{SITE}/name/{nxt['slug']}/",
    }
    print("POSTING:", nxt["slug"], "->", body["link"])
    if DRY:
        print("DRY_RUN, not posting")
        return

    pin = req("POST", "/pins", body)
    nxt["posted"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    nxt["pin_id"] = pin.get("id")
    with open("pinterest/queue.json", "w", encoding="utf-8") as f:
        json.dump(q, f, ensure_ascii=False, indent=2)
    print("OK pin_id:", pin.get("id"))


main()
