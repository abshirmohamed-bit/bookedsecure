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

import threading
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
#: The on-screen card under a person takes at most this share of the height.
GRAPHIC_MAX = 0.38
#: Cinema bars: how dark the blurred bars are, and the vignette angle.
#: Podcast poster progress bar: height and lift from the bottom (share of height), colour.
PROGRESS_HEIGHT = 0.006
PROGRESS_LIFT = 0.025
PROGRESS_COLOUR = "white@0.9"
CINEMA_BRIGHTNESS = -0.2
VIGNETTE = "PI/5"


def spotlight_cards(w: int, h: int) -> list[tuple[int, int, int, int]]:
    """Three people, portrait: (x, y, w, h) of a big card on top for the
    speaker and two cards below for the others."""
    m, g = even(w * DUO_MARGIN), even(w * DUO_GAP)
    inner_w, inner_h = w - 2 * m, h - 2 * m - g
    top_h = even(inner_h * 0.56)
    bot_h = even(inner_h - top_h)
    half = even((inner_w - g) / 2)
    return [(m, m, even(inner_w), top_h), (m, m + top_h + g, half, bot_h), (m + half + g, m + top_h + g, half, bot_h)]


def graphic_cards(w: int, h: int, gw: int, gh: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Person on top, an on-screen card (gw x gh source px) whole below: (x, y, w, h) of each.

    The card keeps its shape at full inner width when it can, and never
    takes more than GRAPHIC_MAX of the height; the person gets the rest.
    """
    m, g = even(w * DUO_MARGIN), even(w * DUO_GAP)
    inner_w, inner_h = w - 2 * m, h - 2 * m - g
    cw = inner_w
    ch = cw * gh / max(1, gw)
    if ch > inner_h * GRAPHIC_MAX:
        ch = inner_h * GRAPHIC_MAX
        cw = ch * gw / max(1, gh)
    cw, ch = even(cw), even(ch)
    ph = even(inner_h - ch)
    return (m, m, even(inner_w), ph), (m + (even(inner_w) - cw) // 2, m + ph + g, cw, ch)


def quad_cards(w: int, h: int) -> list[tuple[int, int, int, int]]:
    """Four people: (x, y, w, h) of a 2 x 2 of cards with a gap."""
    m, g = even(w * DUO_MARGIN), even(w * DUO_GAP)
    cw, ch = even((w - 2 * m - g) / 2), even((h - 2 * m - g) / 2)
    return [(m + c * (cw + g), m + r * (ch + g), cw, ch) for r in range(2) for c in range(2)]


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


#: Stills each render asks for, by work folder: [(label, png, pixel format, frames)].
#:
#: Every card gets its own source, looped for its own shot only. Never one
#: source `split` to every card that uses it: split pushes each frame to all
#: of its outputs at once, while the shots are joined one after another, so
#: the frames meant for every later shot's card pile up in memory until that
#: shot starts. A 73 s, 25-shot clip with one shadow split 16 ways passed
#: 2.8 GB in 20 s and was killed on Fly's 4 GB machine; with a source per
#: card the same render peaked at 1.24 GB. A source is pulled only as fast as
#: its card is drawn, and a PNG costs next to nothing to read again.
_STILLS: dict[str, list[tuple[str, str, str, int | None]]] = {}
_STILLS_LOCK = threading.Lock()


def _still_label(workdir: Path, png: str, fmt: str, frames: int | None = None) -> str:
    with _STILLS_LOCK:
        want = _STILLS.setdefault(str(workdir), [])
        label = f"st{abs(hash(png)) % 100000}_{len(want)}"
        want.append((label, png, fmt, frames))
        return label


def emit_stills(workdir: Path, frames: int) -> list[str]:
    """The graph lines feeding every still asked for in this work folder, then forgets them.

    `frames` is the whole render's length, used for a still whose card did
    not say how long its shot runs.
    """
    with _STILLS_LOCK:
        want = _STILLS.pop(str(workdir), [])
    return [f"movie={png},format={fmt},loop=loop={max(0, (own or frames) - 1)}:size=1:start=0,"
            f"setpts=N/(30*TB)[{label}]"
            for label, png, fmt, own in want]


def ambient(label_in: str, label_out: str, w: int, h: int, brightness: float = AMBIENT_BRIGHTNESS) -> str:
    """The blurred, richer copy of the picture that fills the frame behind a card."""
    return (f"[{label_in}]scale={w // 4}:{h // 4}:force_original_aspect_ratio=increase,crop={w // 4}:{h // 4},"
            f"boxblur={max(2, AMBIENT_BLUR // 4)}:2,eq=saturation={AMBIENT_SATURATION}:brightness={brightness},"
            f"scale={w}:{h}:flags=bicubic,setsar=1[{label_out}]")


def card(lines: list[str], *, base: str, picture: str, out: str, x: int, y: int, w: int, h: int,
         out_w: int, workdir: Path, name: str, frames: int) -> None:
    """Lay `picture` (already w x h) over `base` as a rounded card with a soft shadow, into `out`."""
    # Named by size, so every card of one size shares one mask and one shadow.
    mask = card_mask(workdir, f"mask_{w}x{h}", w, h, out_w)
    shadow, pad = card_shadow(workdir, f"shadow_{w}x{h}", w, h, out_w)
    drop = int(out_w * SHADOW_DROP)
    m_in, s_in = _still_label(workdir, mask, "gray", frames), _still_label(workdir, shadow, "rgba", frames)
    lines.append(f"[{picture}]format=yuva420p[{name}p]")
    # Each still runs as long as this shot (a frame or two over); the card stops with its picture.
    lines.append(f"[{name}p][{m_in}]alphamerge=shortest=1[{name}c]")
    lines.append(f"[{base}][{s_in}]overlay={x - pad}:{y - pad + drop}:eof_action=pass:shortest=1[{name}b]")
    lines.append(f"[{name}b][{name}c]overlay={x}:{y}:eof_action=pass,format=yuv420p[{out}]")
