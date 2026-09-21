#!/usr/bin/env python3
"""Contrôle non destructif des liens externes BlueWave."""
from __future__ import annotations

import json
import socket
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
USER_AGENT = "BlueWaveSolutions-LinkCheck/1.0"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href", "")
        if href.startswith(("https://", "http://")):
            self.urls.add(href)


def collect_urls() -> list[str]:
    urls = set()
    for page in ROOT.glob("*.html"):
        parser = Links()
        parser.feed(page.read_text(encoding="utf-8"))
        urls.update(parser.urls)
    for item in json.loads((ROOT / "data" / "actualites.json").read_text(encoding="utf-8")).get("items", []):
        if item.get("url"):
            urls.add(item["url"])
    for source in json.loads((ROOT / "data" / "actualites-sources.json").read_text(encoding="utf-8")).get("sources", []):
        urls.update(filter(None, (source.get("feed_url"), source.get("url"))))
    return sorted(urls)


def check(url: str) -> dict:
    request = Request(url, method="HEAD", headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urlopen(request, timeout=20) as response:
            code = response.status
        return {"url": url, "status": "PASS", "http_status": code}
    except HTTPError as exc:
        if exc.code == 405:
            try:
                request = Request(url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-1024"})
                with urlopen(request, timeout=20) as response:
                    return {"url": url, "status": "PASS", "http_status": response.status}
            except (HTTPError, URLError, TimeoutError, socket.timeout) as retry:
                return classify_error(url, retry)
        return classify_error(url, exc)
    except (URLError, TimeoutError, socket.timeout) as exc:
        return classify_error(url, exc)


def classify_error(url: str, exc: Exception) -> dict:
    code = exc.code if isinstance(exc, HTTPError) else None
    if code in {401, 403, 429} or code is None:
        return {"url": url, "status": "WARNING", "http_status": code, "detail": str(exc)}
    return {"url": url, "status": "DEAD", "http_status": code, "detail": str(exc)}


def main() -> int:
    urls = collect_urls()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(check, urls))
    counts = {status: sum(1 for result in results if result["status"] == status) for status in ("PASS", "WARNING", "DEAD")}
    print(json.dumps({"checked": len(urls), "counts": counts, "results": results}, ensure_ascii=False, indent=2))
    return 1 if counts["DEAD"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
