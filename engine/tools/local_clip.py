"""Clip a local video end to end with the Engine's own code, no server needed.

For checking the Engine on this machine: the transcript comes from the
video's own YouTube captions (no Groq), moments from the rules finder plus
the "Most replayed" signal (no AI key), then every clip renders exactly as
an export does (shot plan, camera, looks, captions, headline).

    python tools/local_clip.py video.mp4 --link https://www.youtube.com/watch?v=... --clips 3 --out out/

Writes out/clip_N.mp4, a contact sheet per clip and out/report.json.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def words_from_lines(lines: list[dict]) -> list[dict]:
    """Caption lines -> evenly spaced words (YouTube's json3 lines have no word timings here)."""
    out = []
    for ln in lines:
        toks = [t for t in str(ln["text"]).split() if t]
        if not toks:
            continue
        a, b = int(ln["start_ms"]), int(ln["end_ms"])
        step = max(1, (b - a) // len(toks))
        for i, t in enumerate(toks):
            out.append({"text": t, "start_ms": a + i * step, "end_ms": min(b, a + (i + 1) * step)})
    return out


def transcribe_local(video: Path, out: Path) -> tuple[list[dict], list[dict]]:
    """(sentences, words) from faster-whisper on this machine, cached next to the output."""
    cache = out / "transcript.json"
    if cache.exists():
        d = json.loads(cache.read_text(encoding="utf-8"))
        return d["sentences"], d["words"]
    from faster_whisper import WhisperModel

    import numpy as np

    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, dtype=np.float32)
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, word_timestamps=True, vad_filter=True)
    sentences, words = [], []
    for seg in segments:
        sentences.append({"start_ms": int(seg.start * 1000), "end_ms": int(seg.end * 1000), "text": seg.text.strip()})
        for w in seg.words or []:
            words.append({"text": w.word.strip(), "start_ms": int(w.start * 1000), "end_ms": int(w.end * 1000)})
    cache.write_text(json.dumps({"sentences": sentences, "words": words}), encoding="utf-8")
    return sentences, words


def main() -> None:
    from app.config import settings
    from app.pipeline import analyze, compose, find, replay

    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--link", required=True)
    ap.add_argument("--clips", type=int, default=3)
    ap.add_argument("--target", type=int, default=45, help="clip length, seconds")
    ap.add_argument("--layout", default="auto")
    ap.add_argument("--out", default="local_clips")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    info = analyze._ytdlp(args.link, want_transcript=False)
    sentences, words = transcribe_local(Path(args.video), out)
    curve = replay.Curve.from_heatmap([{"start_time": a / 1000, "end_time": b / 1000, "value": v} for a, b, v in info.heatmap],
                                      info.duration_ms)
    type(settings()).resolve_finder = lambda self: "rules"
    moments = find.find(sentences, count=args.clips, target_ms=args.target * 1000, replay_curve=curve)
    report = {"title": info.title, "replay_peaks": curve.peaks() if curve else [], "clips": []}
    for k, m in enumerate(sorted(moments, key=lambda m: -m.score), 1):
        clip_words = [{**w, "start_ms": w["start_ms"] - m.start_ms, "end_ms": w["end_ms"] - m.start_ms}
                      for w in words if m.start_ms <= w["start_ms"] < m.end_ms]
        dest = out / f"clip_{k}.mp4"
        r = compose.Render(out=dest, source=Path(args.video).resolve(), in_ms=m.start_ms, out_ms=m.end_ms,
                           layout=args.layout, words=clip_words, title={"text": m.title, "enabled": True})
        t = time.time()
        compose.run(r, out / f"work_{k}")
        took = time.time() - t
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                                           "-of", "json", str(dest)], capture_output=True, text=True).stdout)
        lens = {s["codec_type"]: float(s.get("duration") or 0) for s in probe["streams"]}
        plan, _ = compose.plan_for(r)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(dest), "-vf", "fps=1/3,scale=216:-2,tile=8x2",
                        "-frames:v", "1", str(out / f"clip_{k}_sheet.png")])
        row = {"clip": k, "title": m.title, "from": replay.mmss(m.start_ms), "to": replay.mmss(m.end_ms),
               "score": m.score, "reason": m.reason, "render_s": round(took, 1),
               "video_s": round(lens.get("video", 0), 2), "audio_s": round(lens.get("audio", 0), 2),
               "shots": [f"{s.kind}{'+' + s.transition if s.transition else ''}" for s in plan]}
        report["clips"].append(row)
        print(json.dumps(row), flush=True)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
