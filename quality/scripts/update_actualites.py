#!/usr/bin/env python3
"""Collecte RSS/Atom déterministe pour la veille BlueWave.

Bibliothèque standard uniquement. Une source défaillante n'arrête pas les autres et
une panne totale ne remplace jamais un jeu de données valide déjà présent.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
SOURCES_PATH = DATA_DIR / "actualites-sources.json"
CURATION_PATH = DATA_DIR / "actualites-curation.json"
OUTPUT_PATH = DATA_DIR / "actualites.json"
STATUS_PATH = DATA_DIR / "actualites-status.json"
USER_AGENT = "BlueWaveSolutions-NewsWatch/1.0 (+https://ouagabokouayao.github.io/bluewave-solutions-site/)"
TRACKING_KEYS = {"fbclid", "gclid", "mc_cid", "mc_eid"}
SCORE_LIMITS = {"freshness": 40, "relevance": 25, "authority": 20, "geography": 10, "diversity": 5}

BLUEWAVE_RELEVANCE_KEYWORDS = {
    "very_strong": (
        "coastal erosion", "coastal adaptation", "littoral", "érosion côtière",
        "submersion", "coastal resilience", "maritime governance",
        "gouvernance maritime", "marine pollution", "pollution marine",
        "port governance", "blue economy", "économie bleue", "law of the sea",
        "droit de la mer", "maritime safety", "maritime security",
    ),
    "strong": (
        "coast", "coastal", "shoreline", "marine environment", "port",
        "maritime", "ocean governance", "adaptation", "resilience",
        "stakeholder", "coastal planning",
    ),
    "weak": ("fisheries", "aquaculture", "ocean", "shipping", "youth", "innovation"),
}
RELEVANCE_WEIGHTS = {"very_strong": 5, "strong": 3, "weak": 1}
RELEVANCE_CAPS = {"very_strong": 20, "strong": 12, "weak": 3}
FEATURED_RELEVANCE_MINIMUM = 15

THEME_KEYWORDS = {
    "littoral-adaptation": (
        "littoral", "coast", "coastal", "shoreline", "erosion", "submersion",
        "adaptation", "resilience", "climate", "sea level", "trait de cote",
    ),
    "gouvernance-maritime": (
        "governance", "gouvernance", "maritime policy", "ocean pact", "planning",
        "planification", "stakeholder", "acteurs", "cooperation", "coopération",
    ),
    "environnement-marin": (
        "marine environment", "environnement marin", "biodiversity", "biodiversité",
        "ecosystem", "écosystème", "pollution", "protected area", "restoration",
        "restauration", "nature-based", "solution fondée sur la nature",
    ),
    "economie-bleue": (
        "blue economy", "économie bleue", "fisheries", "pêche", "aquaculture",
        "ocean energy", "innovation", "investment", "financement bleu",
    ),
    "ports-maritime": (
        "port", "shipping", "ship", "navire", "maritime transport", "seafarer",
        "gens de mer", "decarbonisation", "décarbonation", "vessel", "terminal",
    ),
    "droit-securite": (
        "maritime safety", "sécurité maritime", "security", "sûreté", "law of the sea",
        "droit de la mer", "regulation", "réglementation", "inspection", "accident",
    ),
}

GEOGRAPHY_KEYWORDS = {
    "france-mediterranee": ("france", "french", "méditerranée", "mediterranean", "corse"),
    "cote-divoire": ("côte d’ivoire", "côte d'ivoire", "ivory coast", "abidjan"),
    "afrique-ouest": ("afrique de l’ouest", "afrique de l'ouest", "west africa", "golfe de guinée", "gulf of guinea"),
}

FRENCH_MONTHS = {
    "janvier": 1, "février": 2, "fevrier": 2, "mars": 3, "avril": 4,
    "mai": 5, "juin": 6, "juillet": 7, "août": 8, "aout": 8,
    "septembre": 9, "octobre": 10, "novembre": 11, "décembre": 12, "decembre": 12,
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(node: ET.Element, names: tuple[str, ...]) -> str:
    for child in node.iter():
        if child is node:
            continue
        if local_name(child.tag) in names and (child.text or "").strip():
            return (child.text or "").strip()
    return ""


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def clean_text(value: str, limit: int = 230) -> str:
    value = re.sub(r"<(?:script|style)\b[^>]*>.*?</(?:script|style)>", " ", value or "", flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = normalize_space(html.unescape(value))
    if len(value) <= limit:
        return value
    shortened = value[: limit + 1].rsplit(" ", 1)[0].rstrip(" ,;:.-")
    return shortened + "…"


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def searchable(value: str) -> str:
    """Normalise le texte pour éviter les faux positifs de sous-chaînes."""
    return normalize_space(re.sub(r"[^a-z0-9]+", " ", fold(value)))


def term_pattern(term: str) -> re.Pattern[str]:
    words = [re.escape(word) for word in searchable(term).split()]
    return re.compile(r"\b" + r"\s+".join(words) + r"\b")


def relevance_analysis(title: str, excerpt: str) -> dict:
    """Calcule la pertinence BlueWave sans double compter les expressions imbriquées."""
    text = searchable(f"{title} {excerpt}")
    occupied = [False] * len(text)
    matches: dict[str, list[str]] = {tier: [] for tier in BLUEWAVE_RELEVANCE_KEYWORDS}
    points = {tier: 0 for tier in BLUEWAVE_RELEVANCE_KEYWORDS}
    terms = [
        (tier, term, RELEVANCE_WEIGHTS[tier])
        for tier, keywords in BLUEWAVE_RELEVANCE_KEYWORDS.items()
        for term in keywords
    ]
    terms.sort(key=lambda entry: (-entry[2], -len(searchable(entry[1])), entry[1]))
    for tier, term, weight in terms:
        for match in term_pattern(term).finditer(text):
            if any(occupied[match.start():match.end()]):
                continue
            if points[tier] + weight > RELEVANCE_CAPS[tier]:
                break
            occupied[match.start():match.end()] = [True] * (match.end() - match.start())
            points[tier] += weight
            matches[tier].append(term)

    direct_core = bool(matches["very_strong"] or matches["strong"])
    penalty = 0
    penalties = []
    if (
        re.search(r"\b(?:state aid|financial aid|grant|funding|aide financiere|subvention)\b", text)
        and re.search(r"\b(?:fisheries|fishery|aquaculture|peche)\b", text)
        and not direct_core
    ):
        penalty += 10
        penalties.append("sectoral-financial-aid")
    if re.search(r"\b(?:youth|jeunesse)\b", text) and not direct_core:
        penalty += 8
        penalties.append("generic-youth")
    if (
        re.search(r"\b(?:product|commercial|company|market launch|produit)\b", text)
        and re.search(r"\b(?:innovation|launch|vente|sales)\b", text)
        and not direct_core
    ):
        penalty += 8
        penalties.append("sectoral-commercial-or-product")

    score = max(0, min(SCORE_LIMITS["relevance"], sum(points.values()) - penalty))
    return {
        "score": score,
        "direct_core": direct_core,
        "eligible": direct_core and score >= FEATURED_RELEVANCE_MINIMUM,
        "matches": matches,
        "penalties": penalties,
    }


def canonical_url(raw: str) -> str:
    raw = html.unescape((raw or "").strip())
    parts = urlsplit(raw)
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        lower = key.casefold()
        if lower.startswith("utm_") or lower in TRACKING_KEYS:
            continue
        query.append((key, value))
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if path != "/":
        path = path.rstrip("/")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(sorted(query)), ""))


def parse_date(raw: str) -> datetime | None:
    raw = normalize_space(raw or "")
    if not raw:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        pass
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass
    match = re.search(r"\b(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\b", raw)
    if match:
        month = FRENCH_MONTHS.get(match.group(2).casefold())
        if month:
            try:
                return datetime(int(match.group(3)), month, int(match.group(1)), tzinfo=timezone.utc)
            except ValueError:
                return None
    return None


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_bytes(url: str, timeout: int = 25) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def load_feed(source: dict, fixture_dir: Path | None) -> list[dict]:
    if fixture_dir:
        content = (fixture_dir / f"{source['id']}.xml").read_bytes()
    else:
        content = fetch_bytes(source["feed_url"])
    root = ET.fromstring(content)
    entries = [node for node in root.iter() if local_name(node.tag) in {"item", "entry"}]
    items = []
    for entry in entries:
        title = clean_text(child_text(entry, ("title",)), 220)
        link = ""
        for child in entry.iter():
            if local_name(child.tag) != "link":
                continue
            href = (child.attrib.get("href") or child.text or "").strip()
            rel = (child.attrib.get("rel") or "alternate").lower()
            if href and rel in {"alternate", ""}:
                link = href
                break
        if not link:
            link = child_text(entry, ("link",))
        guid = child_text(entry, ("guid", "id"))
        description = child_text(entry, ("description", "summary", "encoded", "content"))
        published_raw = child_text(entry, ("pubdate", "published", "updated", "date"))
        published = parse_date(published_raw)
        url = canonical_url(link)
        if not title or not url or urlsplit(url).scheme not in {"http", "https"}:
            continue
        items.append({
            "title": title,
            "url": url,
            "guid": normalize_space(guid),
            "excerpt": clean_text(description),
            "published": published,
        })
    return items


def keyword_hits(text: str) -> dict[str, int]:
    normalized = fold(text)
    hits = {}
    for theme, keywords in THEME_KEYWORDS.items():
        count = sum(1 for keyword in keywords if fold(keyword) in normalized)
        if count:
            hits[theme] = count
    return hits


def classify(item: dict, source: dict) -> tuple[str, list[str], int, bool]:
    text = f"{item['title']} {item['excerpt']}"
    hits = keyword_hits(text)
    matched = bool(hits)
    declared = source.get("themes", [])
    for theme in declared:
        hits[theme] = hits.get(theme, 0) + 1
    theme = sorted(hits, key=lambda key: (-hits[key], key))[0] if hits else "gouvernance-maritime"
    geographies = []
    normalized = fold(text)
    for geography, keywords in GEOGRAPHY_KEYWORDS.items():
        if any(fold(keyword) in normalized for keyword in keywords):
            geographies.append(geography)
    geographies = sorted(set(geographies or source.get("geography", [])))
    return theme, geographies, sum(hits.values()), matched


def title_fingerprint(title: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", fold(title))
    return " ".join(normalized.split())


def item_id(url: str, guid: str, title: str) -> str:
    stable = url or guid or title_fingerprint(title)
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()[:20]


def prepare(raw: dict, source: dict, now: datetime, window_days: int) -> dict | None:
    published = raw["published"]
    if published is None or published > now + timedelta(days=1):
        return None
    age_days = max(0, (now - published).total_seconds() / 86400)
    if age_days > window_days:
        return None
    theme, geographies, _hits, matched = classify(raw, source)
    required_keywords = source.get("required_keywords", [])
    if required_keywords:
        normalized = fold(f"{raw['title']} {raw['excerpt']}")
        matched = any(fold(keyword) in normalized for keyword in required_keywords)
    if source.get("require_keyword_match") and not matched:
        return None
    freshness = max(0, min(SCORE_LIMITS["freshness"], round(SCORE_LIMITS["freshness"] * (1 - age_days / window_days))))
    relevance = relevance_analysis(raw["title"], raw["excerpt"])
    priority_geography = set(geographies) & {"france-mediterranee", "cote-divoire", "afrique-ouest"}
    geography = SCORE_LIMITS["geography"] if priority_geography else 5 if "europe-mediterranee" in geographies else 0
    return {
        "id": item_id(raw["url"], raw["guid"], raw["title"]),
        "title": raw["title"],
        "url": raw["url"],
        "source_id": source["id"],
        "source_name": source["name"],
        "published_at": iso_z(published),
        "fetched_at": iso_z(now),
        "theme": theme,
        "geographies": geographies,
        "excerpt": raw["excerpt"],
        "score": {
            "freshness": freshness,
            "relevance": relevance["score"],
            "authority": max(0, min(SCORE_LIMITS["authority"], int(source.get("weight", 0)))),
            "geography": geography,
            "diversity": 0,
            "total": 0,
        },
        "score_global": 0,
        "score_relevance_bluewave": relevance["score"],
        "eligible_featured": relevance["eligible"],
        "featured": False,
        "_guid": raw["guid"],
        "_fingerprint": title_fingerprint(raw["title"]),
        "_relevance_matches": relevance["matches"],
        "_relevance_penalties": relevance["penalties"],
    }


def deduplicate(items: list[dict]) -> list[dict]:
    chosen = []
    seen_urls, seen_guids, seen_titles = set(), set(), set()
    ordered = sorted(items, key=lambda item: (item["published_at"], item["id"]), reverse=True)
    for item in ordered:
        guid = item.get("_guid")
        title = item.get("_fingerprint")
        if item["url"] in seen_urls or (guid and guid in seen_guids) or (title and title in seen_titles):
            continue
        chosen.append(item)
        seen_urls.add(item["url"])
        if guid:
            seen_guids.add(guid)
        if title:
            seen_titles.add(title)
    return chosen


def add_diversity_scores(items: list[dict]) -> None:
    counts = Counter(item["source_id"] for item in items)
    total = max(1, len(items))
    for item in items:
        share = counts[item["source_id"]] / total
        diversity = 5 if share <= 1 / 3 else 3 if share <= 1 / 2 else 1
        item["score"]["diversity"] = diversity
        item["score"]["total"] = sum(item["score"][key] for key in ("freshness", "relevance", "authority", "geography", "diversity"))
        item["score_global"] = item["score"]["total"]


def add_relevance_scores(items: list[dict]) -> None:
    """Recalcule aussi les éléments conservés après une panne partielle de source."""
    for item in items:
        analysis = relevance_analysis(item.get("title", ""), item.get("excerpt", ""))
        item.setdefault("score", {})["relevance"] = analysis["score"]
        item["score_relevance_bluewave"] = analysis["score"]
        item["eligible_featured"] = analysis["eligible"]
        item["featured"] = False
        item["_relevance_matches"] = analysis["matches"]
        item["_relevance_penalties"] = analysis["penalties"]


def select_featured(items: list[dict], curation: dict) -> None:
    overrides = [canonical_url(url) for url in curation.get("featured_override", [])]
    pinned = {canonical_url(url) for url in curation.get("pinned_urls", [])}
    eligible = [item for item in items if item.get("eligible_featured")]
    by_url = {item["url"]: item for item in eligible}
    ordered = []
    for url in overrides:
        if url in by_url and by_url[url] not in ordered:
            ordered.append(by_url[url])
    ranked = sorted(
        eligible,
        key=lambda item: (
            item["url"] in pinned,
            item["published_at"],
            item["score_relevance_bluewave"],
            item["score_global"],
            item["id"],
        ),
        reverse=True,
    )
    ordered.extend(item for item in ranked if item not in ordered)
    selected = []
    source_counts = Counter()

    def append_if_allowed(item: dict) -> bool:
        if item in selected or source_counts[item["source_id"]] >= 2:
            return False
        selected.append(item)
        source_counts[item["source_id"]] += 1
        return True

    if ordered:
        append_if_allowed(ordered[0])
    if len({item["theme"] for item in ordered}) >= 2:
        for item in ordered[1:]:
            if item["theme"] != selected[0]["theme"] and append_if_allowed(item):
                break
    for item in ordered:
        if len(selected) >= 3:
            break
        append_if_allowed(item)
    for item in selected:
        item["featured"] = True


def public_item(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.startswith("_")}


def previous_items(path: Path, now: datetime, window_days: int) -> list[dict]:
    if not path.exists():
        return []
    try:
        payload = read_json(path)
        items = payload.get("items", [])
        valid = []
        for item in items:
            published = parse_date(item.get("published_at", ""))
            if published and now - published <= timedelta(days=window_days):
                copy = dict(item)
                copy["featured"] = False
                copy["_guid"] = ""
                copy["_fingerprint"] = title_fingerprint(copy.get("title", ""))
                valid.append(copy)
        return valid
    except (OSError, ValueError, TypeError):
        return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Collecter et valider sans écrire")
    parser.add_argument("--fixture-dir", type=Path, help="Lire <source_id>.xml localement")
    parser.add_argument("--output-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    config = read_json(SOURCES_PATH)
    curation = read_json(CURATION_PATH)
    now = datetime.now(timezone.utc)
    window_days = int(config.get("window_days", 90))
    max_items = int(config.get("max_items", 80))
    disabled = set(curation.get("disabled_sources", []))
    sources = [source for source in config.get("sources", []) if source.get("enabled", True) and source.get("id") not in disabled]
    excluded = {canonical_url(url) for url in curation.get("excluded_urls", [])}
    collected, errors, source_reports = [], [], []

    for source in sources:
        try:
            raw_items = load_feed(source, args.fixture_dir)
            prepared = [item for raw in raw_items if (item := prepare(raw, source, now, window_days))]
            collected.extend(prepared)
            source_reports.append({"source_id": source["id"], "status": "ok", "fetched": len(raw_items), "accepted": len(prepared)})
        except (OSError, ValueError, KeyError, ET.ParseError, HTTPError, URLError) as exc:
            message = f"{source.get('id', 'unknown')}: {type(exc).__name__}: {exc}"
            errors.append(message)
            source_reports.append({"source_id": source.get("id", "unknown"), "status": "error", "error": message})

    successful = sum(1 for report in source_reports if report["status"] == "ok")
    output_path = args.output_dir / "actualites.json"
    status_path = args.output_dir / "actualites-status.json"
    old_items = previous_items(OUTPUT_PATH, now, window_days)
    previous_generated_at = None
    if OUTPUT_PATH.exists():
        try:
            previous_generated_at = read_json(OUTPUT_PATH).get("generated_at")
        except (OSError, ValueError, TypeError):
            previous_generated_at = None

    if successful == 0:
        status = {
            "version": 1, "generated_at": iso_z(now), "state": "error",
            "configured_sources": len(sources), "reachable_sources": 0,
            "collected": 0, "after_deduplication": 0,
            "duplicates_removed": 0, "kept": len(old_items),
            "featured_eligible": sum(1 for item in old_items if item.get("eligible_featured")),
            "featured": sum(1 for item in old_items if item.get("featured")), "categories": {},
            "source_reports": source_reports, "errors": errors,
            "last_successful_at": previous_generated_at,
            "message": "Toutes les sources sont momentanément indisponibles ; le dernier jeu valide est conservé.",
        }
        if not args.dry_run:
            write_json(status_path, status)
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 1

    new_deduped = deduplicate([item for item in collected if item.get("url") not in excluded])
    successful_ids = {report["source_id"] for report in source_reports if report["status"] == "ok"}
    active_ids = {source["id"] for source in sources}
    retained_old = [item for item in old_items if item.get("source_id") in active_ids - successful_ids]
    merged = [item for item in new_deduped + retained_old if item.get("url") not in excluded]
    deduped = deduplicate(merged)
    add_relevance_scores(deduped)
    add_diversity_scores(deduped)
    deduped.sort(key=lambda item: (item["published_at"], item["score"]["total"], item["id"]), reverse=True)
    kept = deduped[:max_items]
    select_featured(kept, curation)
    payload = {
        "version": 1,
        "generated_at": iso_z(now),
        "window_days": window_days,
        "items": [public_item(item) for item in kept],
    }
    featured_count = sum(1 for item in kept if item["featured"])
    eligible_count = sum(1 for item in kept if item["eligible_featured"])
    status = {
        "version": 1,
        "generated_at": iso_z(now),
        "state": "ok" if not errors else "partial",
        "configured_sources": len(sources),
        "reachable_sources": successful,
        "collected": len(collected),
        "after_deduplication": len(deduped),
        "duplicates_removed": max(0, len(collected) - len(new_deduped)),
        "kept": len(kept),
        "featured_eligible": eligible_count,
        "featured": featured_count,
        "categories": dict(sorted(Counter(item["theme"] for item in kept).items())),
        "source_reports": source_reports,
        "errors": errors,
        "last_successful_at": iso_z(now),
        "message": "Veille actualisée." if not errors else "Veille actualisée avec certaines sources indisponibles.",
    }
    if not args.dry_run:
        write_json(output_path, payload)
        write_json(status_path, status)
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
