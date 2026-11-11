"""Render-level rules that are easy to get wrong and expensive to spot by eye."""
from __future__ import annotations

import pytest

from app.pipeline.caption import BY_ID, build_ass, group_lines
from pathlib import Path

from app.pipeline.compose import (
    ASPECTS,
    Render,
    Segment,
    _title_filter,
    remap_words,
    wrap_title,
)
from app.pipeline.frame import Track, crop_filter


def test_a_long_headline_wraps_instead_of_running_off_the_frame():
    lines = wrap_title("THE HONEST ANSWER IS THAT IT DEPENDS ON WHAT YOU MEASURE FIRST", 22)
    assert len(lines) == 2
    assert all(len(l) <= 23 for l in lines)
    assert not any(l.startswith(" ") for l in lines)


def test_title_shrinks_for_long_text():
    short = _title_filter({"text": "Short", "style": "bold_band"}, 1080, 1920)
    long = _title_filter({"text": "A headline with a great many words in it indeed", "style": "bold_band"}, 1080, 1920)
    size_of = lambda f: int(f.split("fontsize=")[1].split(":")[0])  # noqa: E731
    assert size_of(long) <= size_of(short)


@pytest.mark.parametrize("aspect,expected", list(ASPECTS.items()))
def test_every_aspect_has_even_dimensions(aspect, expected):
    r = Render(out=Path("out.mp4"), source=Path("in.mp4"), in_ms=0, out_ms=1000, aspect=aspect)
    w, h = r.size
    assert (w, h) == expected
    assert w % 2 == 0 and h % 2 == 0, "h264 needs even dimensions"


def test_crop_keeps_the_window_inside_a_landscape_source():
    track = Track("motion", 1920, 1080, [(0, 0.0), (1000, 1.0)], [])
    f, cmds = crop_filter(track, 1080, 1920, 2000)
    cw = int(f.split("=")[1].split(":")[0])
    xs = [float(line.split()[-1].rstrip(";")) for line in cmds.splitlines()]
    assert min(xs) >= 0
    assert max(xs) + cw <= 1920, "the crop never runs past the edge of the frame"


def test_captions_are_short_enough_to_read():
    words = [{"start_ms": i * 300, "end_ms": i * 300 + 280, "text": f"w{i}"} for i in range(20)]
    for line in group_lines(words):
        assert len(line.words) <= 4
        assert line.end_ms - line.start_ms <= 1800


def test_censored_words_are_masked_in_the_subtitle_file():
    words = [{"start_ms": 0, "end_ms": 500, "text": "damn"}, {"start_ms": 500, "end_ms": 900, "text": "fine"}]
    ass = build_ass(words, BY_ID["bold_white"], 1080, 1920, censored=["damn"])
    assert "d***" in ass and "damn" not in ass
    assert "fine" in ass


def test_a_clip_with_no_segments_is_rejected_rather_than_rendering_nothing():
    with pytest.raises(ValueError):
        Render(out=Path("out.mp4"), segments=[])
    with pytest.raises(ValueError):
        Render(out=Path("out.mp4"), source=Path("in.mp4"), in_ms=500, out_ms=500)


def test_segments_lay_end_to_end():
    r = Render(out=Path("out.mp4"), segments=[
        Segment(Path("a.mp4"), 1_000, 4_000),
        Segment(Path("b.mp4"), 10_000, 12_500),
    ])
    assert r.total_ms == 5_500


def test_captions_follow_their_segment_onto_the_stitched_timeline():
    a, b = Path("a.mp4"), Path("b.mp4")
    words = [
        {"start_ms": 0, "end_ms": 500, "text": "dropped", "source": str(a)},
        {"start_ms": 1_000, "end_ms": 1_400, "text": "first", "source": str(a)},
        {"start_ms": 10_200, "end_ms": 10_600, "text": "second", "source": str(b)},
        {"start_ms": 20_000, "end_ms": 20_400, "text": "also-dropped", "source": str(b)},
    ]
    out = remap_words(words, [Segment(a, 1_000, 4_000), Segment(b, 10_000, 12_500)])
    assert [w["text"] for w in out] == ["first", "second"], "words outside every segment are cut away"
    assert out[0]["start_ms"] == 0, "the first segment starts the clip"
    assert out[1]["start_ms"] == 3_200, "3000ms of segment one, then 200ms into segment two"


def test_a_word_straddling_a_cut_is_trimmed_to_the_cut():
    a = Path("a.mp4")
    out = remap_words([{"start_ms": 900, "end_ms": 1_500, "text": "straddles"}],
                      [Segment(a, 1_000, 2_000)])
    assert out[0]["start_ms"] == 0 and out[0]["end_ms"] == 500


def test_the_tracker_follows_a_moving_subject(tmp_path):
    """A silently empty track means every clip gets a centre crop. Catch that here."""
    import shutil
    import subprocess

    from app.pipeline.frame import track

    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    clip = tmp_path / "moving.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error",
        "-f", "lavfi", "-i", "color=c=0x101418:s=640x360:d=4:r=24",
        "-f", "lavfi", "-i", "color=c=0xE8E0D0:s=120x120:d=4:r=24",
        "-filter_complex", "[0:v][1:v]overlay=x='40+t*110':y=120",
        "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p", "-y", str(clip),
    ], check=True)

    t = track(clip, mode="auto")
    assert len(t.samples) >= 3, "the tracker found nothing on an obviously moving subject"
    xs = [x for _, x in t.samples]
    assert xs[-1] > xs[0] + 0.05, "the track should follow the subject left to right"

    selected = track(clip, mode="auto", in_ms=1000, out_ms=3000)
    assert (selected.width, selected.height) == (640, 360)
    assert selected.samples
    assert all(1000 <= ms < 3000 for ms, _ in selected.samples)


def test_a_title_with_an_apostrophe_renders(tmp_path):
    """A quote used to end the drawtext value early and break the whole graph.

    The failure was "No such filter: '30'" on a title reading
    "WHAT HAPPENS WHEN YOU'VE POSTED 20, 30". This renders it for real.
    """
    import subprocess

    from app.pipeline.compose import _escape_drawtext

    title = "WHAT HAPPENS WHEN YOU'VE POSTED 20, 30"
    out = tmp_path / "frame.png"
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x180:d=0.1",
         "-vf", f"drawtext=text='{_escape_drawtext(title)}':fontcolor=white:fontsize=18:x=4:y=4",
         "-frames:v", "1", "-y", str(out)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert out.exists() and out.stat().st_size > 0


def test_every_character_that_breaks_a_filter_graph_is_escaped():
    from app.pipeline.compose import _escape_drawtext

    assert _escape_drawtext("it's") == r"it'\''s"
    assert _escape_drawtext("a:b") == r"a\:b"
    assert _escape_drawtext("100%") == r"100\%"
    assert _escape_drawtext("a\\b") == r"a\\b"
    # A comma is literal inside the quotes and must not be mangled.
    assert "," in _escape_drawtext("20, 30")


def test_the_blurred_layout_follows_the_subject_instead_of_ignoring_it():
    """The streamer layout used to discard tracking and just letterbox."""
    import inspect

    from app.pipeline import compose

    source = inspect.getsource(compose._two_layer)
    assert "crop_filter" in source, "the blurred layout must use the tracked crop"
    assert "[fg]" in source


def test_two_faces_are_held_together_when_they_fit():
    from app.pipeline.frame import _aim

    # Two faces close together, well inside the window.
    out = _aim([(0, [(0.45, 0.08), (0.55, 0.08)])], [])
    assert out == [(0, 0.5)]


def test_the_nearer_face_wins_when_both_cannot_fit():
    from app.pipeline.frame import _aim

    # One small face at the far left, one large one at the right. Aiming at
    # the midpoint would frame the gap between them.
    out = _aim([(0, [(0.10, 0.05), (0.80, 0.20)])], [])
    assert out == [(0, 0.80)]


def test_a_single_face_is_simply_followed():
    from app.pipeline.frame import _aim

    assert _aim([(0, [(0.33, 0.1)]), (500, [(0.66, 0.1)])], []) == [(0, 0.33), (500, 0.66)]


def test_without_any_detection_the_motion_samples_still_drive_the_crop():
    from app.pipeline.frame import _aim

    fallback = [(0, 0.4), (500, 0.6)]
    assert _aim([], fallback) == fallback


def test_a_title_drops_the_filler_a_speaker_opens_with():
    from app.pipeline.find import _title_from

    assert _title_from("So basically, you know, the universe is mostly empty") \
        .lower().startswith("the universe")


def test_a_title_keeps_the_question_because_that_is_the_hook():
    from app.pipeline.find import _title_from

    out = _title_from("And I was thinking about it. How do we actually find aliens?")
    assert out.endswith("?")
    assert "aliens" in out.lower()


def test_a_title_stops_on_a_thought_not_mid_phrase():
    from app.pipeline.find import _title_from

    out = _title_from("Um, the thing nobody tells you, is that it takes years of work")
    assert not out.endswith(",")
    assert len(out) <= 60


def test_a_title_is_never_empty():
    from app.pipeline.find import _title_from

    assert _title_from("") == "Clip"
    assert _title_from("so  and  but") != ""


# --- face-driven layout -------------------------------------------------

def _track(*faces, width=1920, height=1080):
    from app.pipeline import frame as F
    return F.Track("yunet", width, height, [(0, 0.5)],
                   [F.Face(i + 1, x, y, w, 0.2, share) for i, (x, y, w, share) in enumerate(faces)])


def test_suggest_layout_stacks_two_people_sitting_apart():
    from app.pipeline import frame as F
    t = _track((0.27, 0.45, 0.10, 0.5), (0.73, 0.45, 0.10, 0.5))
    assert F.suggest_layout(t) == "split"


def test_suggest_layout_keeps_one_crop_when_a_single_window_holds_both():
    """Faces closer than the window is wide already fit; stacking them there
    would zoom into two halves of the same shot."""
    from app.pipeline import frame as F
    t = _track((0.45, 0.45, 0.10, 0.5), (0.58, 0.45, 0.10, 0.5))
    assert F.suggest_layout(t) == "full-video"


def test_suggest_layout_ignores_a_fleeting_face():
    from app.pipeline import frame as F
    t = _track((0.30, 0.45, 0.10, 0.94), (0.80, 0.45, 0.10, 0.06))
    assert F.suggest_layout(t) == "full-video"


def test_suggest_layout_without_faces():
    from app.pipeline import frame as F
    assert F.suggest_layout(None) == "full-video"
    assert F.suggest_layout(_track()) == "full-video"


def test_cell_crops_frame_each_face_and_exclude_the_other():
    from app.pipeline import frame as F
    t = _track((0.27, 0.45, 0.10, 0.5), (0.73, 0.45, 0.10, 0.5))
    cells = F.cell_crops(t, 1080, 1920, 2)
    assert len(cells) == 2
    boxes = [tuple(int(v) for v in c.removeprefix("crop=").split(":")) for c in cells]
    (w0, h0, x0, y0), (w1, h1, x1, y1) = boxes
    for w, h, x, y in boxes:
        assert w % 2 == 0 and h % 2 == 0
        assert 0 <= x and x + w <= t.width
        assert 0 <= y and y + h <= t.height
        assert abs(w / h - 1080 / 960) < 0.02       # the shape of its cell
    # top cell is the left-hand speaker, and neither cell holds the other face
    assert x0 < x1
    assert x0 + w0 < 0.73 * t.width
    assert x1 > 0.27 * t.width


def test_cell_crops_need_one_face_per_cell():
    from app.pipeline import frame as F
    assert F.cell_crops(_track((0.3, 0.45, 0.1, 1.0)), 1080, 1920, 2) == []


def test_split_falls_back_when_the_faces_cannot_support_it(tmp_path, monkeypatch):
    """A split with nothing to split must not stack a crop on top of itself."""
    from app.pipeline import compose, frame as F
    monkeypatch.setattr(compose.framing, "track",
                        lambda *a, **k: _track((0.3, 0.45, 0.1, 1.0)))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                       in_ms=0, out_ms=2000, layout="split")
    args, _ = compose.build(r, tmp_path / "w")
    assert "vstack" not in " ".join(args)


def test_auto_layout_builds_a_stack_for_two_people(tmp_path, monkeypatch):
    from app.pipeline import compose
    monkeypatch.setattr(compose.framing, "track",
                        lambda *a, **k: _track((0.27, 0.45, 0.10, 0.5), (0.73, 0.45, 0.10, 0.5)))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                       in_ms=0, out_ms=2000, layout="auto")
    args, _ = compose.build(r, tmp_path / "w")
    graph = " ".join(args)
    assert "vstack=inputs=2" in graph
    assert graph.count("crop=") >= 2


# --- composite sources --------------------------------------------------

def _seamed(seam, *faces, width=1920, height=1080):
    from app.pipeline import frame as F
    return F.Track("yunet", width, height, [(0, 0.5)],
                   [F.Face(i + 1, x, y, w, 0.2, share) for i, (x, y, w, share) in enumerate(faces)],
                   seam)


def test_a_composite_splits_even_with_nobody_facing_the_camera():
    """The case the face rule cannot reach: two feeds, both heads turned away."""
    from app.pipeline import frame as F
    t = _seamed(0.5)
    assert t.faces == []
    assert F.suggest_layout(t) == "split"
    assert len(F.cell_crops(t, 1080, 1920, 2)) == 2


def test_a_line_with_everyone_on_one_side_is_scenery_not_a_join():
    from app.pipeline import frame as F
    t = _seamed(0.45, (0.30, 0.45, 0.10, 1.0))
    assert F.seam_of(t) is None
    assert F.suggest_layout(t) == "full-video"


def test_a_join_with_a_face_each_side_is_trusted():
    from app.pipeline import frame as F
    t = _seamed(0.5, (0.25, 0.45, 0.09, 0.5), (0.75, 0.45, 0.09, 0.5))
    assert F.seam_of(t) == 0.5
    assert F.suggest_layout(t) == "split"


def test_seam_cells_cut_at_the_join():
    from app.pipeline import frame as F
    cells = F.cell_crops(_seamed(0.5), 1080, 1920, 2)
    boxes = [tuple(int(v) for v in c.removeprefix("crop=").split(":")) for c in cells]
    (w0, _, x0, _), (w1, _, x1, _) = boxes
    assert x0 + w0 <= 960            # the top cell stays in the left feed
    assert x1 >= 960                 # the bottom cell stays in the right feed


def test_an_off_centre_join_is_respected():
    from app.pipeline import frame as F
    cells = F.cell_crops(_seamed(0.62), 1080, 1920, 2)
    boxes = [tuple(int(v) for v in c.removeprefix("crop=").split(":")) for c in cells]
    assert boxes[0][2] + boxes[0][0] <= int(0.62 * 1920)
    assert boxes[1][2] >= int(0.62 * 1920)


def test_seam_from_ignores_a_flat_or_tiny_profile():
    from app.pipeline import frame as F
    import numpy as np
    assert F._seam_from(None, 10) is None
    assert F._seam_from(np.zeros(200), 2) is None        # too few frames
    assert F._seam_from(np.zeros(200), 10) is None       # nothing stands out


def test_seam_from_finds_a_lone_full_height_edge():
    from app.pipeline import frame as F
    import numpy as np
    g = np.zeros(400)
    g[199] = 10.0                                        # full coverage over 10 frames
    assert F._seam_from(g, 10) == 0.5


# --- one feed of a composite --------------------------------------------

def test_feed_crop_stays_inside_the_feed_it_chose():
    from app.pipeline import frame as F
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)],
                [F.Face(1, 0.25, 0.45, 0.09, 0.2, 0.5),
                 F.Face(2, 0.75, 0.45, 0.09, 0.2, 0.5)], 0.5)
    left = F.feed_crop(t, 1080, 1920, 0)
    right = F.feed_crop(t, 1080, 1920, 1)
    lw, lh, lx, ly = (int(v) for v in left.removeprefix("crop=").split(":"))
    rw, rh, rx, ry = (int(v) for v in right.removeprefix("crop=").split(":"))
    assert lx + lw <= 960 and rx >= 960          # neither crosses the join
    assert abs(lw / lh - 1080 / 1920) < 0.02     # and both are 9:16
    assert abs(rw / rh - 1080 / 1920) < 0.02


def test_a_composite_carried_by_one_speaker_renders_as_one_feed(tmp_path, monkeypatch):
    from app.pipeline import compose, frame as F, speaker as S
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)],
                [F.Face(1, 0.25, 0.45, 0.09, 0.2, 0.5),
                 F.Face(2, 0.75, 0.45, 0.09, 0.2, 0.5)], 0.5)
    tracks = [S.FaceTrack(id=1, boxes=[(0, (0.25, 0.45, 0.09, 0.2))]),
              S.FaceTrack(id=2, boxes=[(0, (0.75, 0.45, 0.09, 0.2))])]
    turns = [S.Turn(0, 9000, 2, 0.9), S.Turn(9000, 10000, 1, 0.9)]
    monkeypatch.setattr(compose.framing, "track", lambda *a, **k: t)
    monkeypatch.setattr(compose.framing, "speech", lambda *a, **k: (tracks, turns, []))
    monkeypatch.setattr(compose.framing, "follow_speaker", lambda tr, *a, **k: tr)
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                       in_ms=0, out_ms=10000, layout="auto")
    graph = " ".join(compose.build(r, tmp_path / "w")[0])
    assert "vstack" not in graph                 # not two half-height cells
    assert "crop=" in graph


def test_a_composite_with_a_back_and_forth_stays_split(tmp_path, monkeypatch):
    from app.pipeline import compose, frame as F, speaker as S
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)],
                [F.Face(1, 0.25, 0.45, 0.09, 0.2, 0.5),
                 F.Face(2, 0.75, 0.45, 0.09, 0.2, 0.5)], 0.5)
    tracks = [S.FaceTrack(id=1, boxes=[(0, (0.25, 0.45, 0.09, 0.2))]),
              S.FaceTrack(id=2, boxes=[(0, (0.75, 0.45, 0.09, 0.2))])]
    turns = [S.Turn(0, 5000, 1, 0.9), S.Turn(5000, 10000, 2, 0.9)]
    monkeypatch.setattr(compose.framing, "track", lambda *a, **k: t)
    monkeypatch.setattr(compose.framing, "speech", lambda *a, **k: (tracks, turns, []))
    monkeypatch.setattr(compose.framing, "follow_speaker", lambda tr, *a, **k: tr)
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                       in_ms=0, out_ms=10000, layout="auto")
    assert "vstack=inputs=2" in " ".join(compose.build(r, tmp_path / "w")[0])


# --- what the clip was chosen for -----------------------------------------

def _two_feeds_one_talker():
    """A composite where one side holds the floor: the case that collapses."""
    from app.pipeline import frame as F, speaker as S
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)],
                [F.Face(1, 0.25, 0.45, 0.09, 0.2, 0.5),
                 F.Face(2, 0.75, 0.45, 0.09, 0.2, 0.5)], 0.5)
    tracks = [S.FaceTrack(id=1, boxes=[(0, (0.25, 0.45, 0.09, 0.2))]),
              S.FaceTrack(id=2, boxes=[(0, (0.75, 0.45, 0.09, 0.2))])]
    turns = [S.Turn(0, 9000, 2, 0.9), S.Turn(9000, 10000, 1, 0.9)]
    return t, tracks, turns


def test_a_reaction_keeps_both_people_on_screen():
    """Ask for "every time they react to each other" and the one composition
    that ruins it is a tight shot of whoever was talking."""
    from app.pipeline import frame as F
    t, tracks, turns = _two_feeds_one_talker()
    assert F.plan(t, tracks, turns, 1080, 1920, "speaker")["layout"] == "one-feed"
    assert F.plan(t, tracks, turns, 1080, 1920, "reaction")["layout"] == "split"
    assert F.plan(t, tracks, turns, 1080, 1920, "everyone")["layout"] == "split"


def test_without_a_stated_focus_the_faces_still_decide():
    from app.pipeline import frame as F
    t, tracks, turns = _two_feeds_one_talker()
    assert F.plan(t, tracks, turns, 1080, 1920, "auto")["layout"] == "one-feed"


def test_a_reaction_clip_renders_as_a_stack(tmp_path, monkeypatch):
    from app.pipeline import compose
    t, tracks, turns = _two_feeds_one_talker()
    monkeypatch.setattr(compose.framing, "track", lambda *a, **k: t)
    monkeypatch.setattr(compose.framing, "speech", lambda *a, **k: (tracks, turns, []))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                       in_ms=0, out_ms=10000, layout="auto", focus="reaction")
    assert "vstack=inputs=2" in " ".join(compose.build(r, tmp_path / "w")[0])


def test_a_reaction_clip_does_not_chase_the_talker(tmp_path, monkeypatch):
    """Following the speaker is how you miss the face the clip is about."""
    from app.pipeline import compose
    t, tracks, turns = _two_feeds_one_talker()
    called = []
    monkeypatch.setattr(compose.framing, "track", lambda *a, **k: t)
    monkeypatch.setattr(compose.framing, "speech", lambda *a, **k: (tracks, turns, []))
    monkeypatch.setattr(compose.framing, "follow_speaker",
                        lambda tr, *a, **k: called.append(1) or tr)
    compose.build(compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4",
                                 in_ms=0, out_ms=10000, layout="auto", focus="reaction"),
                  tmp_path / "w")
    assert called == []
    compose.build(compose.Render(out=tmp_path / "o2.mp4", source=tmp_path / "in.mp4",
                                 in_ms=0, out_ms=10000, layout="auto", focus="speaker"),
                  tmp_path / "w2")
    assert called == [1]


# --- holding still --------------------------------------------------------

def test_the_window_ignores_a_subject_who_has_not_really_moved():
    """Reported from real clips: the picture would not sit still, as if it
    kept trying to centre someone who was already centred. The detector's
    own jitter is indistinguishable from a small movement, and the window
    was answering every bit of it."""
    from app.pipeline import frame as F
    jitter = [(ms, 0.50 + (0.004 if ms % 1000 else -0.004)) for ms in range(0, 8000, 500)]
    out = [x for _, x in F._smooth(jitter)]
    assert len(set(out)) == 1          # never moves at all


def test_the_window_still_follows_someone_who_walks():
    from app.pipeline import frame as F
    walking = [(ms, 0.30 + ms / 20000) for ms in range(0, 8000, 500)]
    out = [x for _, x in F._smooth(walking)]
    assert out[-1] > out[0] + 0.15     # it kept up
    assert out[-1] <= walking[-1][1]   # without overshooting them


def test_a_different_person_is_a_cut_not_a_crawl():
    """Easing across the frame takes seconds of visible travel and looks like
    a camera being swung around the room."""
    from app.pipeline import frame as F
    swap = [(0, 0.25), (500, 0.25), (1000, 0.75), (1500, 0.75), (2000, 0.75)]
    out = [x for _, x in F._smooth(swap)]
    assert out[1] == pytest.approx(0.25)
    assert out[2] == pytest.approx(0.75)     # arrives in one step
    assert out[4] == pytest.approx(0.75)


def test_following_settles_instead_of_chattering_on_the_boundary():
    """Stopping the moment the subject re-enters the margin leaves the window
    starting and stopping every other frame."""
    from app.pipeline import frame as F
    drift = [(ms, 0.50 + 0.09) for ms in range(0, 6000, 500)]
    out = [x for _, x in F._smooth([(0, 0.50)] + drift)]
    tail = out[-4:]
    assert max(tail) - min(tail) < 0.01      # it arrived and stopped
