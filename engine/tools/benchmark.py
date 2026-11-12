"""Benchmark the Engine's framing and rendering on fixed scenes, with automatic scores.

Renders every scene in every layout with the Engine's own code (the same
shot plan, camera and renderer as an export), then scores each render
against the pass criteria below, so a tuning loop can tell on its own
whether a change helped:

    python tools/benchmark.py source.mp4 --scenes "0:30-1:31, 3:04-4:06" --out bench/

Exit code 0 when every render passes. Writes bench/report.json and
bench/report.md (one row per scene and layout, with every score).

Run from engine/ so `app` imports; FACE_MODEL_PATH must name the YuNet model.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.pipeline import camera, compose  # noqa: E402

LAYOUTS = ["auto", "full-video", "split", "grid", "screen", "pip", "streamer", "black-box", "title-subtitles"]

#: Pass criteria. Each score must be within its limit for a render to pass.
CRITERIA = {
    # picture and sound end together (the 7.1 truncation bug failed this)
    "av_gap_s": 0.15,
    # seconds of black frames the source doesn't have
    "extra_black_s": 0.3,
    # seconds of frozen picture the source doesn't have
    "extra_freeze_s": 0.5,
    # share of sampled frames where a face is cut by the left/right edge
    "half_face_share": 0.08,
    # follow layouts: of the moments the source shows a face, the share the output keeps one
    "face_kept_share_min": 0.80,
    # biggest camera move in one frame away from a camera cut, as a share of the crop width
    "max_jump_share": 0.06,
    # render time over clip length (at the benchmark's preview size)
    "speed_ratio": 3.0,
}
#: Layouts that crop to a person, where losing the face is a failure.
FOLLOW = {"auto", "full-video"}


def parse_time(text: str) -> float:
    s = 0.0
    for p in text.strip().split(":"):
        s = s * 60 + float(p)
    return s


def probe_lengths(path: Path) -> tuple[float, float]:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json",
                          str(path)], capture_output=True, text=True, check=True).stdout
    v = a = 0.0
    for s in json.loads(out).get("streams", []):
        d = float(s.get("duration") or 0)
        if s.get("codec_type") == "video":
            v = d
        elif s.get("codec_type") == "audio":
            a = d
    return v, a


def detect_seconds(path: Path, flt: str, start: float | None = None, length: float | None = None) -> float:
    """Total seconds ffmpeg's blackdetect/freezedetect report."""
    cmd = ["ffmpeg", "-v", "info", "-hide_banner"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}", "-t", f"{length:.3f}"]
    cmd += ["-i", str(path), "-an", "-vf", f"scale=320:-2,{flt}", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    if flt.startswith("blackdetect"):
        return sum(float(m) for m in re.findall(r"black_duration:([\d.]+)", err))
    return sum(float(m) for m in re.findall(r"freeze_duration: ([\d.]+)", err))


def face_detector():
    import cv2

    model = os.environ.get("FACE_MODEL_PATH", "/models/face_detection_yunet.onnx")
    det = cv2.FaceDetectorYN.create(model, "", (320, 320), 0.7, 0.3, 5000)

    def faces(frame):
        h, w = frame.shape[:2]
        det.setInputSize((w, h))
        _, f = det.detect(frame)
        return [tuple(map(float, r[:4])) for r in (f if f is not None else [])]

    return faces


def frames_at(path: Path, times: list[float], start: float = 0.0, width: int = 480):
    """Decoded frames (BGR) at each time, read in one pass at 2 fps."""
    import cv2
    import numpy as np

    if not times:
        return []
    t0, t1 = start + times[0], start + times[-1] + 0.5
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", str(path), "-an",
           "-vf", f"fps=2,scale={width}:-2", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True).stdout
    sw, sh = (int(x) for x in probe.strip().split(",")[:2])
    h = int(round(sh * width / sw / 2) * 2)
    size = width * h * 3
    out = [np.frombuffer(raw[i:i + size], np.uint8).reshape(h, width, 3) for i in range(0, len(raw) - size + 1, size)]
    del cv2
    return out


def face_scores(src: Path, start: float, out: Path, length: float, faces) -> tuple[float, float]:
    """(share of output frames with a face cut by the side edge, share of source-face moments kept)."""
    times = [k * 0.5 for k in range(int(length * 2))]
    outs = frames_at(out, times)
    srcs = frames_at(src, times, start)
    n = min(len(outs), len(srcs))
    half = kept = with_face = 0
    for k in range(n):
        o = outs[k]
        w = o.shape[1]
        of = [f for f in faces(o) if f[2] > w * 0.06]
        if any(f[0] < 2 or f[0] + f[2] > w - 2 for f in of):
            half += 1
        # Faces a 9:16 crop can hold and is meant to: not specks in the background,
        # not close-ups wider than the crop itself (they can only be shown in part).
        sw = srcs[k].shape[1]
        sf = [f for f in faces(srcs[k]) if sw * 0.04 < f[2] < sw * 0.22]
        if sf:
            with_face += 1
            kept += bool(of)
    return (half / n if n else 0.0), (kept / with_face if with_face else 1.0)


def max_jump(plan, cuts: list[int]) -> float:
    """Largest frame-to-frame move of the camera's centre away from camera cuts, as a share of the crop width."""
    worst = 0.0
    for shot in plan:
        m = shot.motion
        for a, b in zip(m, m[1:]):
            if any(abs(b[0] - c) <= camera.CUT_SNAP_MS + 40 for c in cuts):
                continue
            d = abs((b[1] + b[3] / 2) - (a[1] + a[3] / 2)) / max(1.0, a[3])
            if d >= camera.CUT_OVER_SHARE * 0.9:
                continue                      # a deliberate cut between people, not a jitter
            worst = max(worst, d)
    return worst


def run_one(src: Path, a: float, b: float, layout: str, out_dir: Path, faces) -> dict:
    name = f"{int(a)}-{int(b)}_{layout}"
    out = out_dir / f"{name}.mp4"
    r = compose.Render(out=out, source=src, in_ms=int(a * 1000), out_ms=int(b * 1000), layout=layout,
                       preview=True, loudnorm=False, captions_enabled=False)
    row: dict = {"scene": f"{a:.0f}-{b:.0f}", "layout": layout}
    t = time.time()
    try:
        plan, inputs = compose.plan_for(r)
        compose.run(r, out_dir / f"work_{name}")
    except Exception as e:  # noqa: BLE001
        row["error"] = str(e)[:300]
        row["pass"] = False
        return row
    took = time.time() - t
    length = b - a
    v, au = probe_lengths(out)
    row["shots"] = len(plan)
    row["kinds"] = sorted({s.kind for s in plan})
    row["transitions"] = sum(1 for s in plan if s.transition)
    row["av_gap_s"] = round(abs(v - au), 3)
    # Letterboxed layouts are mostly bars by design: a frame is black only if
    # nearly all of it is, picture included.
    pic = ":pic_th=0.995" if layout in {"streamer", "black-box", "title-subtitles"} else ""
    row["extra_black_s"] = round(max(0.0, detect_seconds(out, f"blackdetect=d=0.2:pix_th=0.08{pic}")
                                     - detect_seconds(src, "blackdetect=d=0.2:pix_th=0.08", a, length)), 2)
    # In whole-picture layouts the moving picture is a card over a soft blur, so the
    # frame as a whole changes less; judge freezes on the picture, not the frame.
    n = 0.0006 if layout in {"streamer", "black-box", "title-subtitles"} else 0.002
    row["extra_freeze_s"] = round(max(0.0, detect_seconds(out, f"freezedetect=n={n}:d=0.6")
                                      - detect_seconds(src, "freezedetect=n=0.002:d=0.6", a, length)), 2)
    half, kept = face_scores(src, a, out, length, faces)
    row["half_face_share"] = round(half, 3)
    row["face_kept_share"] = round(kept, 3)
    row["max_jump_share"] = round(max_jump(plan, list(inputs.cuts)), 3)
    row["speed_ratio"] = round(took / length, 2)
    fails = [k for k, lim in CRITERIA.items() if k != "face_kept_share_min" and row.get(k, 0) > lim]
    if layout in FOLLOW and kept < CRITERIA["face_kept_share_min"]:
        fails.append("face_kept_share")
    row["fails"] = fails
    row["pass"] = not fails
    return row


def report(rows: list[dict], out_dir: Path) -> None:
    (out_dir / "report.json").write_text(json.dumps({"criteria": CRITERIA, "rows": rows}, indent=2), encoding="utf-8")
    cols = ["scene", "layout", "pass", "shots", "transitions", "av_gap_s", "extra_black_s", "extra_freeze_s",
            "half_face_share", "face_kept_share", "max_jump_share", "speed_ratio", "fails"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(c, r.get("error", "") if c == "fails" else "")) for c in cols) + " |")
    passed = sum(r["pass"] for r in rows)
    lines.append(f"\n{passed} of {len(rows)} renders pass.")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--scenes", required=True)
    ap.add_argument("--layouts", default=",".join(LAYOUTS))
    ap.add_argument("--out", default="bench")
    args = ap.parse_args()
    src = Path(args.source).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    scenes = []
    for item in args.scenes.split(","):
        a, _, b = item.partition("-")
        scenes.append((parse_time(a), parse_time(b)))
    faces = face_detector()
    rows = []
    for a, b in scenes:
        for layout in [x.strip() for x in args.layouts.split(",") if x.strip()]:
            row = run_one(src, a, b, layout, out_dir, faces)
            print(json.dumps(row), flush=True)
            rows.append(row)
    report(rows, out_dir)
    sys.exit(0 if all(r["pass"] for r in rows) else 1)


if __name__ == "__main__":
    main()
