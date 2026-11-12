"""Pick Mr. HiSum videos for the highlight benchmark, checked live on YouTube.

Reads Mr. HiSum's labels (benchmarks/mrhisum/metadata.csv, mr_hisum.h5 and
YouTube-8M's vocabulary.csv, all gitignored) and picks videos that:

- run 5 to 8.3 minutes (YouTube-8M's longest),
- have a "Most replayed" curve with clear peaks (something to hit or miss),
- spread across categories (at most MAX_PER_CATEGORY from each),
- aren't music videos (nothing to clip from a song),
- still play on YouTube, checked with yt-dlp (metadata only, nothing downloaded).

    python tools/mrhisum_pick.py --count 10

Writes benchmarks/mrhisum/picked.json (ids, titles, categories, peaks) and
prints the links to paste into Co-Work.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "benchmarks" / "mrhisum"
MIN_S, MAX_S = 300, 500
MAX_PER_CATEGORY = 2
#: Verticals that rarely make a useful short clip.
SKIP_VERTICALS = {"Music"}
#: Categories we most want (people talking, showing, explaining), tried first.
PREFER = ["People & Society", "Jobs & Education", "Science", "News", "Beauty & Fitness", "Food & Drink",
          "Games", "Sports", "Autos & Vehicles", "Arts & Entertainment", "Hobbies & Leisure", "Pets & Animals",
          "Home & Garden", "Computers & Electronics", "Travel", "Shopping", "Business & Industrial"]


def load_vocabulary() -> dict[int, tuple[str, str]]:
    out = {}
    with open(ROOT / "vocabulary.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[int(row["Index"])] = (row["Name"], row["Vertical1"] or "Other")
    return out


def peakiness(score) -> float:
    """How much the curve's top stands out from its middle (0 flat .. 1 one sharp peak)."""
    s = sorted(float(x) for x in score)
    if not s:
        return 0.0
    med = s[len(s) // 2]
    top = s[int(len(s) * 0.97)]
    return top - med


#: Titles that say the video is a song, not something to clip.
SONG = re.compile(r"(song|songs|lyrics?|official (music )?video|audio|remix|bhajan|karaoke|mp3|ft\.|feat\.|album|instrumental|cover)", re.I)


def english_title(title: str) -> bool:
    letters = [ch for ch in title if ch.isalpha()]
    return bool(letters) and sum(ch.isascii() for ch in letters) / len(letters) > 0.95


def live(youtube_id: str) -> dict | None:
    """The video's title and length if it still plays, else None."""
    cmd = [sys.executable, "-m", "yt_dlp", "-J", "--skip-download", "--no-warnings", "--no-playlist",
           f"https://www.youtube.com/watch?v={youtube_id}"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return None
    if p.returncode != 0:
        return None
    info = json.loads(p.stdout)
    if info.get("availability") not in (None, "public", "unlisted") or info.get("age_limit", 0) >= 18:
        return None
    return {"title": info.get("title"), "duration": info.get("duration"), "channel": info.get("channel"),
            "language": info.get("language")}


def main() -> None:
    import h5py

    sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    vocab = load_vocabulary()
    h5 = h5py.File(ROOT / "mr_hisum.h5", "r")
    rows = []
    with open(ROOT / "metadata.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            d = int(row["duration"])
            if not MIN_S <= d <= MAX_S:
                continue
            labels = [int(x) for x in re.findall(r"\d+", row["labels"])]
            names = [vocab.get(i, ("?", "Other")) for i in labels]
            verticals = [v for _, v in names]
            if not names or any(v in SKIP_VERTICALS for v in verticals[:1]) or "Music video" in [n for n, _ in names]:
                continue
            peak = peakiness(h5[row["video_id"]]["gtscore"][()])
            if peak < 0.35:
                continue
            rows.append({**row, "duration": d, "category": verticals[0], "topic": names[0][0], "peakiness": round(peak, 3)})
    rng = random.Random(args.seed)
    rng.shuffle(rows)
    order = {c: i for i, c in enumerate(PREFER)}
    rows.sort(key=lambda r: order.get(r["category"], len(PREFER)))
    picked: list[dict] = []
    per: dict[str, int] = {}
    tried = 0
    # Round-robin over categories so the first picks are already varied.
    by_cat: dict[str, list[dict]] = {}
    for r in rows:
        by_cat.setdefault(r["category"], []).append(r)
    cats = sorted(by_cat, key=lambda c: order.get(c, len(PREFER)))
    while len(picked) < args.count and any(by_cat[c] for c in cats):
        for c in cats:
            if len(picked) >= args.count or not by_cat[c] or per.get(c, 0) >= MAX_PER_CATEGORY:
                continue
            r = by_cat[c].pop(0)
            tried += 1
            info = live(r["youtube_id"])
            if not info or not info.get("duration") or abs(info["duration"] - r["duration"]) > 5:
                print(f"  skip {r['youtube_id']} ({c}): gone or changed", flush=True)
                continue
            title = info.get("title") or ""
            if SONG.search(title) or not english_title(title) or (info.get("language") or "en")[:2] != "en":
                print(f"  skip {r['youtube_id']} ({c}): a song or not in English", flush=True)
                continue
            per[c] = per.get(c, 0) + 1
            picked.append({"video_id": r["video_id"], "youtube_id": r["youtube_id"], "url": f"https://www.youtube.com/watch?v={r['youtube_id']}",
                           "title": info["title"], "channel": info["channel"], "duration_s": r["duration"],
                           "category": c, "topic": r["topic"], "peakiness": r["peakiness"], "views": int(r["views"])})
            print(f"  ok   {r['youtube_id']} {c} / {r['topic']}: {info['title']}", flush=True)
        if all(per.get(c, 0) >= MAX_PER_CATEGORY or not by_cat[c] for c in cats):
            break
    (ROOT / "picked.json").write_text(json.dumps(picked, indent=2), encoding="utf-8")
    print(f"\n{len(picked)} videos picked ({tried} checked). Paste these into Co-Work:\n")
    for p in picked:
        print(f"{p['url']}  - {p['category']}: {p['title']} ({p['duration_s'] // 60}:{p['duration_s'] % 60:02d})")


if __name__ == "__main__":
    main()
