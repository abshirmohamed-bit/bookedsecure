"""Turn one long movie into 5-minute test videos for the clipping Engine.

Each video is 15-20 random clips (10-25 s each) taken from spread-out parts
of the movie, skipping the first 3 minutes and the last 5 (credits), joined
into exactly 300 seconds with picture and sound in sync.

Every clip is re-encoded on its own with an exact cut (stream copying can
only cut on keyframes, which drifts sound and picture apart at the joins),
all clips share the same frame rate, size, pixel format and audio format,
and the joined file is then stream-copied together, so the joins are clean.

    python make_test_videos.py                    # uses the settings below
    python make_test_videos.py other.mp4 --videos 3 --seed 7

Writes training_sample_1.mp4 ... and a .json beside each one listing exactly
which parts of the movie it used.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# ------------------------------------------------------------------ settings
MOVIE = "movie.mp4"
NUM_VIDEOS = 5
OUTPUT_DIR = "."
TARGET_SECONDS = 300          # each video's length
CLIPS_MIN, CLIPS_MAX = 15, 20  # clips per video
CLIP_MIN_S, CLIP_MAX_S = 10, 25
SKIP_START_S = 3 * 60         # opening credits
SKIP_END_S = 5 * 60           # closing credits
SHUFFLE_ORDER = True          # False keeps the clips in movie order
SEED = None                   # set a number to get the same videos again
# Output format (every clip is made identical so the joins are seamless).
FPS = 30
MAX_HEIGHT = 1080             # taller sources are scaled down; smaller ones kept
CRF = 20                      # quality: lower is better and bigger
PRESET = "veryfast"
AUDIO_RATE = 48000
# ------------------------------------------------------------------


def need(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        sys.exit(f"{tool} not found. Install FFmpeg first (see the top of this file's README lines).")
    return path


def probe(movie: Path) -> tuple[float, bool, int]:
    """(duration in seconds, has audio, height)."""
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-show_entries", "format=duration:stream=codec_type,height",
         "-of", "json", str(movie)], capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    duration = float(info["format"]["duration"])
    streams = info.get("streams", [])
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    height = next((int(s["height"]) for s in streams if s.get("codec_type") == "video" and s.get("height")), MAX_HEIGHT)
    return duration, has_audio, height


def clip_lengths(rng: random.Random) -> list[float]:
    """15-20 lengths of 10-25 s that add up to exactly TARGET_SECONDS."""
    lo = max(CLIPS_MIN, -(-TARGET_SECONDS // CLIP_MAX_S))
    hi = min(CLIPS_MAX, TARGET_SECONDS // CLIP_MIN_S)
    if lo > hi:
        sys.exit("The clip count and clip length settings can't add up to the target length.")
    count = rng.randint(lo, hi)
    lengths = [float(CLIP_MIN_S)] * count
    spare = TARGET_SECONDS - CLIP_MIN_S * count
    # Hand out the spare seconds in small random pieces, never past CLIP_MAX_S.
    while spare > 1e-9:
        i = rng.randrange(count)
        room = CLIP_MAX_S - lengths[i]
        if room <= 0:
            continue
        step = min(room, spare, rng.uniform(0.5, 4.0))
        lengths[i] += step
        spare -= step
    return [round(x, 3) for x in lengths]


def pick_starts(lengths: list[float], start: float, end: float, rng: random.Random) -> list[float]:
    """One start per clip, each in its own slice of the movie, so no two clips overlap."""
    span = end - start
    if span < sum(lengths) * 1.2:
        sys.exit(f"The movie has {span / 60:.1f} usable minutes, too little for a {TARGET_SECONDS / 60:.0f}-minute video.")
    order = list(range(len(lengths)))
    rng.shuffle(order)                       # which slice each clip goes in
    slice_len = span / len(lengths)
    starts = [0.0] * len(lengths)
    for slot, i in enumerate(order):
        a = start + slot * slice_len
        latest = a + slice_len - lengths[i]
        if latest < a:                       # a long clip in a short slice: let it run into the next
            latest = a
        starts[i] = round(rng.uniform(a, latest), 3)
    return starts


def cut(movie: Path, at: float, length: float, out: Path, has_audio: bool, height: int) -> None:
    """One clip, cut exactly and encoded to the shared format."""
    scale = f",scale=-2:{MAX_HEIGHT}" if height > MAX_HEIGHT else ""
    cmd = [need("ffmpeg"), "-v", "error", "-y", "-ss", f"{at:.3f}", "-i", str(movie)]
    if not has_audio:
        cmd += ["-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=stereo"]
    cmd += ["-t", f"{length:.3f}", "-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0",
            "-vf", f"fps={FPS}{scale},format=yuv420p,setsar=1",
            # Pad or trim the sound to exactly the clip's length so it never drifts at a join.
            "-af", f"aresample={AUDIO_RATE}:async=1:first_pts=0,apad,atrim=0:{length:.3f}",
            "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF), "-g", str(FPS * 2),
            "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", str(AUDIO_RATE),
            "-video_track_timescale", "90000", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)


def join(parts: list[Path], out: Path, work: Path) -> None:
    listing = work / "parts.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    subprocess.run([need("ffmpeg"), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c", "copy", "-movflags", "+faststart", str(out)], check=True)


def make_video(movie: Path, number: int, out_dir: Path, duration: float, has_audio: bool, height: int,
               rng: random.Random) -> Path:
    lengths = clip_lengths(rng)
    starts = pick_starts(lengths, SKIP_START_S, duration - SKIP_END_S, rng)
    clips = list(zip(starts, lengths))
    if not SHUFFLE_ORDER:
        clips.sort()
    out = out_dir / f"training_sample_{number}.mp4"
    with tempfile.TemporaryDirectory(prefix="clips-") as tmp:
        work = Path(tmp)
        parts = []
        for k, (at, length) in enumerate(clips, 1):
            part = work / f"part{k:02d}.mp4"
            print(f"  clip {k:2d}/{len(clips)}: {fmt(at)} for {length:.1f}s")
            cut(movie, at, length, part, has_audio, height)
            parts.append(part)
        join(parts, out, work)
    made, _, _ = probe(out)
    (out.with_suffix(".json")).write_text(json.dumps({
        "source": movie.name, "length_s": round(made, 3),
        "clips": [{"order": k, "source_start_s": at, "length_s": length, "source_start": fmt(at)}
                  for k, (at, length) in enumerate(clips, 1)],
    }, indent=2), encoding="utf-8")
    print(f"  -> {out} ({made:.2f}s, {len(clips)} clips)")
    return out


def fmt(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("movie", nargs="?", default=MOVIE)
    ap.add_argument("--videos", type=int, default=NUM_VIDEOS)
    ap.add_argument("--out", default=OUTPUT_DIR)
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()
    movie = Path(args.movie)
    if not movie.is_file():
        sys.exit(f"Can't find {movie}.")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    duration, has_audio, height = probe(movie)
    print(f"{movie.name}: {fmt(duration)} long; using {fmt(SKIP_START_S)} to {fmt(duration - SKIP_END_S)}")
    rng = random.Random(args.seed)
    for n in range(1, args.videos + 1):
        print(f"Video {n} of {args.videos}")
        make_video(movie, n, out_dir, duration, has_audio, height, rng)


if __name__ == "__main__":
    main()
