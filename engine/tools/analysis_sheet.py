"""Show what the engine thinks it is looking at, as one picture.

Every threshold in the framing and speaker code was set against video made
for the purpose — rectangles drawn on a photograph. That proves the logic is
sound and says nothing about whether the numbers suit real footage, where
faces are small, lit badly, turned away and compressed.

This renders the analysis over the frames it came from, so being wrong is
visible instead of theoretical: boxes on the faces it found, a marker on
whoever it believes is talking, the layout it would choose, and where it
thinks the camera cut.

    python -m tools.analysis_sheet clip.mp4 --out sheet.png [--in-ms 0 --out-ms 60000]
"""
from __future__ import annotations

import argparse
from pathlib import Path

GREEN = (90, 220, 120)
GREY = (150, 150, 150)
RED = (70, 70, 240)
WHITE = (255, 255, 255)


def sheet(video: Path, out: Path, in_ms: int, out_ms: int, columns: int = 5,
          shots: int = 15) -> dict:
    import cv2
    import numpy as np

    from app.pipeline import frame as framing
    from app.pipeline import speaker as sp

    track = framing.track(video, in_ms=in_ms, out_ms=out_ms)
    tracks, turns, cuts = framing.speech(video, in_ms=in_ms, out_ms=out_ms)
    chosen = framing.plan(track, tracks, turns, 1080, 1920)
    held = sp.panel_time(tracks, turns, track.seam) if track.seam is not None else {}

    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    stamps = [in_ms + i * (out_ms - in_ms) // shots for i in range(shots)]
    tiles = []
    for ms in stamps:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((ms / 1000) * fps))
        ok, bgr = cap.read()
        if not ok:
            continue
        tile = cv2.resize(bgr, (420, int(420 * bgr.shape[0] / bgr.shape[1])))
        th, tw = tile.shape[:2]
        turn = sp.speaker_at(turns, ms)
        for t in tracks:
            if not t.visible_at(ms, slack_ms=700):
                continue
            box = t.box_at(ms)
            if box is None:
                continue
            cx, cy, bw, bh = box
            x0, y0 = int((cx - bw / 2) * tw), int((cy - bh / 2) * th)
            x1, y1 = int((cx + bw / 2) * tw), int((cy + bh / 2) * th)
            talking = turn is not None and turn.track_id == t.id
            cv2.rectangle(tile, (x0, y0), (x1, y1), GREEN if talking else GREY,
                          3 if talking else 1)
            cv2.putText(tile, f"#{t.id}" + (" TALKING" if talking else ""), (x0, max(12, y0 - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, GREEN if talking else GREY, 1, cv2.LINE_AA)
        if track.seam is not None:
            x = int(track.seam * tw)
            cv2.line(tile, (x, 0), (x, th), (60, 180, 240), 1)
        near_cut = any(abs(c - ms) < 400 for c in cuts)
        label = f"{ms/1000:6.1f}s  {turn.reason if turn else 'n/a'}"
        cv2.rectangle(tile, (0, th - 22), (tw, th), (0, 0, 0), -1)
        cv2.putText(tile, label + ("   <<CUT" if near_cut else ""), (6, th - 7),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, RED if near_cut else WHITE, 1, cv2.LINE_AA)
        tiles.append(tile)

    cap.release()
    if not tiles:
        raise SystemExit("could not read any frames from that clip")

    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + columns - 1) // columns
    grid = np.full((rows * th + 90, columns * tw, 3), 28, np.uint8)
    for i, tile in enumerate(tiles):
        r, c = divmod(i, columns)
        grid[90 + r * th:90 + (r + 1) * th, c * tw:(c + 1) * tw] = tile

    spoken = {t.id: sum(x.end_ms - x.start_ms for x in turns if x.track_id == t.id)
              for t in tracks}
    reasons = {}
    for t in turns:
        reasons[t.reason] = reasons.get(t.reason, 0) + (t.end_ms - t.start_ms)
    total = sum(reasons.values()) or 1
    lines = [
        f"layout={chosen['layout']}   seam={track.seam}   strategy={track.strategy}"
        f"   cuts={len(cuts)}   people={len(tracks)}",
        "  ".join(f"#{k}:{v/1000:.1f}s" for k, v in spoken.items()) or "nobody named",
        "  ".join(f"{k} {v*100//total}%" for k, v in sorted(reasons.items())),
    ]
    for i, line in enumerate(lines):
        cv2.putText(grid, line, (10, 26 + i * 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
                    WHITE, 1, cv2.LINE_AA)
    cv2.imwrite(str(out), grid)
    return {"layout": chosen["layout"], "seam": track.seam, "cuts": cuts,
            "people": len(tracks), "spoken_ms": spoken, "reasons": reasons}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, default=Path("sheet.png"))
    ap.add_argument("--in-ms", type=int, default=0)
    ap.add_argument("--out-ms", type=int, default=60000)
    args = ap.parse_args()
    report = sheet(args.video, args.out, args.in_ms, args.out_ms)
    print(args.out)
    for k, v in report.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
