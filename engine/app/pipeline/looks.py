"""The finishing looks: rounded cards, soft shadows, ambient backgrounds.

Plain crops and black bars read as "made by a tool". These pieces make the
same shots look designed: a picture becomes a card with rounded corners
and a soft shadow, floating over a blurred, slightly richer copy of
itself; two people become two cards with a gap; a picture-in-picture
becomes a rounded bubble. Everything is a fixed-size still (a mask or a
shadow PNG made once per render) composited by ffmpeg, so nothing changes
size mid-stream (see compose.camera_chain for why that matters).

The editor's live preview and the browser render draw the same shapes from
the same numbers (LOOK in lib/clip-looks.ts mirrors CARD below).
"""
from __future__ import annotations

from pathlib import Path

#: Corner radius, as a share of the output width.
RADIUS = 0.045
#: Shadow blur and opacity, and how far it drops below the card (share of width).
SHADOW_BLUR = 0.035
SHADOW_ALPHA = 0.55
SHADOW_DROP = 0.012
#: Ambient background: blur strength, colour and darkening.
AMBIENT_BLUR = 40
AMBIENT_SATURATION = 1.35
AMBIENT_BRIGHTNESS = -0.02
#: The card in a blurred-background shot fills this share of the width.
GLASS_WIDTH = 0.92
#: Duo cards: margin around and gap between the two cards (share of width).
DUO_MARGIN = 0.035
DUO_GAP = 0.025
#: Cinema bars: how dark the blurred bars are, and the vignette angle.
CINEMA_BRIGHTNESS = -0.32
VIGNETTE = "PI/5"


def even(v: float) -> int:
    i = int(round(v))
    return i - i % 2


def _rounded(w: int, h: int, r: int):
    import cv2
    import numpy as np

    m = np.zeros((h, w), np.uint8)
    r = max(1, min(r, w // 2, h // 2))
    cv2.rectangle(m, (r, 0), (w - r - 1, h - 1), 255, -1)
    cv2.rectangle(m, (0, r), (w - 1, h - r - 1), 255, -1)
    for cx, cy in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(m, (cx, cy), r, 255, -1, lineType=cv2.LINE_AA)
    return m


def card_mask(workdir: Path, name: str, w: int, h: int, out_w: int) -> str:
    """A grey PNG, white inside a rounded rectangle of w x h. Returns its bare file name."""
    import cv2

    path = workdir / f"{name}.png"
    if not path.exists():
        cv2.imwrite(str(path), _rounded(w, h, int(out_w * RADIUS)))
    return path.name


def card_shadow(workdir: Path, name: str, w: int, h: int, out_w: int) -> tuple[str, int]:
    """An RGBA PNG of the card's soft shadow, padded by `pad` on every side. Returns (name, pad)."""
    import cv2
    import numpy as np

    blur = max(3, int(out_w * SHADOW_BLUR))
    pad = blur * 2
    path = workdir / f"{name}.png"
    if not path.exists():
        alpha = np.zeros((h + 2 * pad, w + 2 * pad), np.uint8)
        alpha[pad:pad + h, pad:pad + w] = _rounded(w, h, int(out_w * RADIUS))
        k = blur * 2 + 1
        alpha = cv2.GaussianBlur(alpha, (k, k), blur / 2)
        rgba = np.zeros((h + 2 * pad, w + 2 * pad, 4), np.uint8)
        rgba[..., 3] = (alpha.astype(np.float32) * SHADOW_ALPHA).astype(np.uint8)
        cv2.imwrite(str(path), rgba)
    return path.name, pad


def still(name: str, frames: int) -> str:
    """A PNG as a stream of exactly `frames` frames at 30 fps, so every branch ends with its shot."""
    return f"movie={name},loop=loop={max(0, frames - 1)}:size=1:start=0,setpts=N/(30*TB)"


def ambient(label_in: str, label_out: str, w: int, h: int, brightness: float = AMBIENT_BRIGHTNESS) -> str:
    """The blurred, richer copy of the picture that fills the frame behind a card."""
    return (f"[{label_in}]scale={w // 4}:{h // 4}:force_original_aspect_ratio=increase,crop={w // 4}:{h // 4},"
            f"boxblur={max(2, AMBIENT_BLUR // 4)}:2,eq=saturation={AMBIENT_SATURATION}:brightness={brightness},"
            f"scale={w}:{h}:flags=bicubic,setsar=1[{label_out}]")


def card(lines: list[str], *, base: str, picture: str, out: str, x: int, y: int, w: int, h: int,
         out_w: int, workdir: Path, name: str, frames: int) -> None:
    """Lay `picture` (already w x h) over `base` as a rounded card with a soft shadow, into `out`."""
    mask = card_mask(workdir, f"{name}_mask", w, h, out_w)
    shadow, pad = card_shadow(workdir, f"{name}_shadow", w, h, out_w)
    drop = int(out_w * SHADOW_DROP)
    lines.append(f"{still(mask, frames)},format=gray[{name}m]")
    lines.append(f"{still(shadow, frames)},format=rgba[{name}s]")
    lines.append(f"[{picture}]format=yuva420p[{name}p]")
    lines.append(f"[{name}p][{name}m]alphamerge[{name}c]")
    lines.append(f"[{base}][{name}s]overlay={x - pad}:{y - pad + drop}:eof_action=pass[{name}b]")
    lines.append(f"[{name}b][{name}c]overlay={x}:{y}:eof_action=pass,format=yuv420p[{out}]")
