#!/usr/bin/env python3
"""Détecte des valeurs de secrets probables tout en autorisant les noms de variables."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP_PARTS = {".git", "__pycache__", ".codex-backups", "node_modules"}
TEXT_SUFFIXES = {"", ".css", ".env", ".example", ".html", ".js", ".json", ".md", ".mjs", ".py", ".txt", ".yml", ".yaml"}

SECRET_VALUE_PATTERNS = (
    re.compile(r"xkeysib-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bsk_[A-Za-z0-9_-]{20,}"),
    re.compile(r"(?im)^[ \t]*BREVO_API_KEY[ \t]*=[ \t]*[^\s#][^\r\n#]*$"),
    re.compile(r"(?i)(?:api[_-]?key|secret|token)\s*[:=]\s*['\"][A-Za-z0-9_./+=-]{20,}['\"]"),
)


def main() -> int:
    findings = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or SKIP_PARTS.intersection(path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES and path.name != ".env.example":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for pattern in SECRET_VALUE_PATTERNS:
            if pattern.search(text):
                findings.append(path.relative_to(ROOT).as_posix())
                break
    if findings:
        print("REAL_SECRET_SUSPECTED")
        for finding in sorted(findings):
            print(f"- {finding}")
        return 1
    print("NO_REAL_SECRET_DETECTED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
