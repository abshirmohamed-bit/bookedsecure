"""Captions as ASS subtitles, burned into the render.

Word timings come from the transcript, so the text lands on the word being
spoken. Styles are data, not code, which is what lets the app offer presets and
a custom builder over the same renderer.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MAX_WORDS_PER_LINE = 4
MAX_LINE_MS = 1600


@dataclass
class Style:
    id: str
    name: str
    font: str = "Montserrat"
    weight: int = 800
    size: int = 64                 # at 1920 tall; scaled for other sizes
    fill: str = "FFFFFF"           # RRGGBB as authored
    outline: str = "000000"
    outline_w: float = 4.0
    shadow: float = 0.0
    box: bool = False
    box_opacity: float = 0.0
    upper: bool = False
    animation: str = "none"        # none | pop | karaoke | bounce | typewriter
    highlight: str = "FFD60A"
    position: str = "middle"       # top | middle | lower


STYLES: list[Style] = [
    Style("bold_white", "Bold white"),
    Style("yellow_pop", "Yellow pop", fill="FFD60A", animation="pop"),
    Style("outlined", "Outlined", outline_w=3.0),
    Style("boxed", "Boxed", box=True, box_opacity=0.7, outline_w=0.0),
    Style("neon", "Neon", fill="64D2FF", outline="003344", outline_w=5.0),
    Style("minimal", "Minimal", weight=600, size=52, outline_w=1.5),
    Style("karaoke_highlight", "Karaoke highlight", animation="karaoke"),
    Style("word_pop", "Word pop", animation="pop"),
    Style("two_color_speaker", "Two-colour speaker", fill="FFFFFF", highlight="FFD60A"),
    Style("lower_third", "Lower third", size=48, box=True, box_opacity=0.6, position="lower", outline_w=0.0),
    Style("uppercase_impact", "Uppercase impact", upper=True, outline_w=5.0),
    Style("handwritten", "Handwritten", font="Permanent Marker", weight=400),
    Style("bounce", "Bounce", animation="bounce"),
    Style("typewriter", "Typewriter", animation="typewriter", weight=700),
    Style("glow_box", "Glow box", box=True, box_opacity=0.5, outline_w=0.0),
    Style("highlighter", "Highlighter", fill="000000", box=True, box_opacity=0.9, highlight="FFD60A", outline_w=0.0),
    Style("comic", "Comic", fill="FFD60A", outline_w=5.0, upper=True),
    Style("serif_quote", "Serif quote", font="Playfair Display", weight=600, outline_w=2.0),
    Style("clean_caps", "Clean caps", font="Anton", weight=400, upper=True, outline_w=0.0, shadow=2.0),
    Style("podcast_bar", "Podcast bar", size=46, box=True, box_opacity=0.75, position="lower", outline_w=0.0),
]
BY_ID = {s.id: s for s in STYLES}


@dataclass
class Line:
    start_ms: int
    end_ms: int
    words: list[dict] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(w["text"].strip() for w in self.words).strip()


def group_lines(words: list[dict], max_words: int = MAX_WORDS_PER_LINE,
                max_ms: int = MAX_LINE_MS) -> list[Line]:
    """Short lines that change often read better on a phone than full sentences."""
    lines: list[Line] = []
    buf: list[dict] = []
    for w in words:
        if not buf:
            buf = [w]
            continue
        spans = w["end_ms"] - buf[0]["start_ms"]
        if len(buf) >= max_words or spans > max_ms:
            lines.append(Line(buf[0]["start_ms"], buf[-1]["end_ms"], buf))
            buf = [w]
        else:
            buf.append(w)
    if buf:
        lines.append(Line(buf[0]["start_ms"], buf[-1]["end_ms"], buf))
    return lines


def _ass_colour(rgb: str, alpha: int = 0) -> str:
    """ASS wants &HAABBGGRR."""
    rgb = rgb.lstrip("#")
    r, g, b = rgb[0:2], rgb[2:4], rgb[4:6]
    return f"&H{alpha:02X}{b}{g}{r}"


def _ts(ms: int) -> str:
    ms = max(0, ms)
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, cs = divmod(rem, 1000)
    return f"{h:d}:{m:02d}:{s:02d}.{cs // 10:02d}"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def build_ass(words: list[dict], style: Style, width: int, height: int, *,
              censored: list[str] | None = None, keyword_highlight: bool = False,
              max_words: int = MAX_WORDS_PER_LINE) -> str:
    """The whole subtitle file as a string, ready for ffmpeg's subtitles filter."""
    scale = height / 1920
    size = max(14, int(style.size * scale))
    outline = round(style.outline_w * scale, 1)
    margin_v = int((height * (0.08 if style.position == "lower" else 0.5 if style.position == "middle" else 0.78)))
    align = 2  # bottom-centre; MarginV positions it
    if style.position == "middle":
        margin_v = int(height * 0.42)
    elif style.position == "top":
        margin_v = int(height * 0.72)

    back = _ass_colour("000000", int(255 * (1 - style.box_opacity))) if style.box else _ass_colour("000000", 255)
    border_style = 3 if style.box else 1
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{style.font},{size},{_ass_colour(style.fill)},{_ass_colour(style.highlight)},{_ass_colour(style.outline)},{back},{1 if style.weight >= 700 else 0},0,0,0,100,100,0,0,{border_style},{outline},{style.shadow},{align},{int(width * 0.06)},{int(width * 0.06)},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    censored_set = {c.lower().strip() for c in (censored or []) if c.strip()}
    events: list[str] = []
    for line in group_lines(words, max_words=max_words):
        if not line.text:
            continue
        rendered = _render_line(line, style, censored_set, keyword_highlight)
        events.append(f"Dialogue: 0,{_ts(line.start_ms)},{_ts(line.end_ms)},Caption,,0,0,0,,{rendered}")
    return header + "\n".join(events) + "\n"


def _mask(word: str) -> str:
    bare = word.strip()
    return bare[0] + "*" * max(1, len(bare) - 1) if bare else bare


def _render_line(line: Line, style: Style, censored: set[str], keyword_highlight: bool) -> str:
    parts: list[str] = []
    for i, w in enumerate(line.words):
        text = w["text"].strip()
        if text.lower().strip(".,!?;:") in censored:
            text = _mask(text)
        if style.upper:
            text = text.upper()
        text = _escape(text)
        if style.animation == "karaoke":
            # \k is in centiseconds; the active word takes the secondary colour
            cs = max(1, (w["end_ms"] - w["start_ms"]) // 10)
            parts.append(f"{{\\kf{cs}}}{text}")
        elif style.animation in {"pop", "bounce"} and i == 0:
            parts.append(f"{{\\fscx92\\fscy92\\t(0,120,\\fscx100\\fscy100)}}{text}")
        else:
            parts.append(text)
    joined = " ".join(parts) if style.animation != "karaoke" else " ".join(parts)
    if keyword_highlight and len(line.words) > 2:
        pass  # the finder marks keywords; left plain when it has not
    return joined


def catalog() -> list[dict]:
    return [{"id": s.id, "name": s.name, "font": s.font,
             "defaults": {"size": s.size, "position": s.position, "animation": s.animation}}
            for s in STYLES]
