"""Score clip picks against Mr. HiSum's ground truth (YouTube "Most replayed").

    python tools/mrhisum_score.py                       # the live Engine's picks
    python tools/mrhisum_score.py --local               # also the finder run locally: rules vs rules + replay

For each video (first 300 s, which is all Mr. HiSum labels):
- f1: per-second overlap with gtsummary (the knapsack highlight summary),
- peak_hit: share of the 3 strongest gtscore peaks (opening excluded) inside a clip,
- top_hit: whether the single most-replayed moment is inside a clip,
- lift: mean gtscore inside the clips over the video's mean (1.0 = no better than random),
- coverage: share of the 300 s the clips cover (high coverage makes f1 easy).

Mr. HiSum's labels were crawled in 2023; `--local` reads today's curve with
yt-dlp for the replay-aware run, so that run is partly scored on the data it
used. Read its lift as an upper bound, and the rules column as the honest baseline.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[2] / "benchmarks" / "mrhisum"
INTRO_S = 20


def mmss(t: str) -> int:
    m, s = t.split(":")
    return int(m) * 60 + int(s)


def labels(h5, video_id: str):
    g = h5[video_id]
    return [float(x) for x in g["gtscore"][()]], [int(x) for x in g["gt_summary"][()]]


def peaks(score: list[float], k: int = 3, gap: int = 15) -> list[int]:
    idx = sorted(range(INTRO_S, len(score)), key=lambda i: -score[i])
    out: list[int] = []
    for i in idx:
        if all(abs(i - o) >= gap for o in out):
            out.append(i)
        if len(out) >= k:
            break
    return out


def score_picks(picks: list[tuple[int, int]], score: list[float], summary: list[int]) -> dict:
    n = len(score)
    chosen = [0] * n
    for a, b in picks:
        for t in range(max(0, a), min(n, b)):
            chosen[t] = 1
    tp = sum(1 for t in range(n) if chosen[t] and summary[t])
    prec = tp / max(1, sum(chosen))
    rec = tp / max(1, sum(summary))
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    pk = peaks(score)
    hit = sum(chosen[p] for p in pk) / max(1, len(pk))
    inside = [score[t] for t in range(INTRO_S, n) if chosen[t]]
    body = score[INTRO_S:]
    lift = (sum(inside) / len(inside)) / (sum(body) / len(body)) if inside and sum(body) else 0.0
    return {"f1": round(f1, 3), "peak_hit": round(hit, 2), "top_hit": bool(pk and chosen[pk[0]]),
            "lift": round(lift, 2), "coverage": round(sum(chosen) / n, 2)}


def local_runs(youtube_id: str, score_len: int) -> dict:
    """The finder run here on the video's own captions: rules, and rules with today's replay curve."""
    from app.config import settings
    from app.pipeline import analyze, find, replay

    cache = ROOT / "cache" / f"{youtube_id}.json"
    if cache.exists():
        d = json.loads(cache.read_text(encoding="utf-8"))
    else:
        info = analyze._ytdlp(f"https://www.youtube.com/watch?v={youtube_id}", want_transcript=True)
        d = {"transcript": info.transcript, "heatmap": info.heatmap, "duration_ms": info.duration_ms}
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(d), encoding="utf-8")
    lines = d["transcript"]
    if not lines:
        return {}
    sentences = [{"start_ms": int(x["start_ms"]), "end_ms": int(x["end_ms"]), "text": x["text"]} for x in lines]
    type(settings()).resolve_finder = lambda self: "rules"
    target = 45_000
    out = {}
    curve = replay.Curve.from_heatmap([{"start_time": a / 1000, "end_time": b / 1000, "value": v} for a, b, v in d["heatmap"]],
                                      d["duration_ms"])
    for name, c in (("rules", None), ("rules+replay", curve)):
        ms = find.find(sentences, count=3, target_ms=target, replay_curve=c)
        out[name] = [(m.start_ms // 1000, m.end_ms // 1000) for m in ms if m.start_ms // 1000 < score_len]
        # the single best pick by the finder's own score, for top-1 scoring
        best = max(ms, key=lambda m: m.score) if ms else None
        out[name + ":best"] = [(best.start_ms // 1000, best.end_ms // 1000)] if best else []
    return out


def main() -> None:
    import h5py

    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    args = ap.parse_args()
    picked = {p["youtube_id"]: p for p in json.loads((ROOT / "picked.json").read_text(encoding="utf-8"))}
    engine = json.loads((ROOT / "engine_picks.json").read_text(encoding="utf-8"))["picks"]
    h5 = h5py.File(ROOT / "mr_hisum.h5", "r")
    rows = []
    for yid, meta in picked.items():
        score, summary = labels(h5, meta["video_id"])
        row = {"video": meta["title"][:40], "id": yid}
        if yid in engine:
            row["engine"] = score_picks([(mmss(a), mmss(b)) for a, b in engine[yid]], score, summary)
        if args.local:
            try:
                for name, picks in local_runs(yid, len(score)).items():
                    row[name] = score_picks(picks, score, summary)
            except Exception as e:  # noqa: BLE001
                row["local_error"] = str(e)[:120]
        rows.append(row)
        print(json.dumps(row), flush=True)
    (ROOT / "score_report.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    def avg(key, metric):
        vals = [r[key][metric] for r in rows if key in r]
        return round(sum(vals) / len(vals), 3) if vals else None

    print("\nAverages:")
    for key in ("engine", "rules", "rules+replay", "rules:best", "rules+replay:best"):
        if any(key in r for r in rows):
            print(f"  {key:20s} n={sum(key in r for r in rows)}  f1={avg(key, 'f1')}  peak_hit={avg(key, 'peak_hit')}  "
                  f"top_hit={avg(key, 'top_hit')}  lift={avg(key, 'lift')}  coverage={avg(key, 'coverage')}")


if __name__ == "__main__":
    main()
