"""People, text and activity in the shot plan: the phase-1 framing rules.

Synthetic faces, bodies, text boxes and activity grids, so every rule is
checked without a video or a model file. The detectors themselves are
checked on real footage by hand (the review sheets); here they are absent,
which must leave the planner exactly as it was.
"""
from __future__ import annotations

from app.pipeline import graphics
from app.pipeline import shots as P
from app.pipeline import subjects
from app.pipeline.speaker import ACT_COLS, ACT_ROWS, DETAIL_BINS, FaceTrack

from test_shots import face_detail, inputs, person


def body(tid, x, y=0.55, w=0.2, h=0.7, start=0, end=10000, step=500):
    return FaceTrack(id=tid, boxes=[(ms, (x, y, w, h)) for ms in range(start, end, step)])


def activity(at: float, start=0, end=10000, level=12.0, shift=0.0):
    """Detail entries whose motion sits in one column band (share of the width)."""
    out = []
    for ms in range(start, end, 500):
        grid = [[0.0] * ACT_COLS for _ in range(ACT_ROWS)]
        col = min(ACT_COLS - 1, int(at * ACT_COLS))
        for row in grid:
            row[col] = 1.0
            if col + 1 < ACT_COLS:
                row[col + 1] = 0.6
        out.append((ms, [0.02] * DETAIL_BINS, 0.4, 0.1, 0.1, grid, shift, level))
    return out


# --- detectors absent -------------------------------------------------------

def test_without_model_files_the_detectors_return_nothing(monkeypatch):
    import numpy as np

    monkeypatch.setenv("OBJECT_MODEL_PATH", "/nowhere/nanodet.onnx")
    monkeypatch.setenv("TEXT_MODEL_PATH", "/nowhere/ppocr.onnx")
    monkeypatch.setattr(subjects, "_object_net", None)
    monkeypatch.setattr(subjects, "_text_net", None)
    monkeypatch.setattr(subjects, "_object_missing", False)
    monkeypatch.setattr(subjects, "_text_missing", False)
    frame = np.zeros((90, 160, 3), np.uint8)
    assert subjects.people(frame) == []
    assert subjects.detect_text(frame) == []
    assert not subjects.objects_available() and not subjects.text_available()


def test_a_small_face_with_no_body_is_dropped_only_when_people_were_looked_for():
    kettle = person(1, 0.3, w=0.02, h=0.04)
    real = person(2, 0.7, w=0.1, h=0.2)
    inp = inputs(tracks=[kettle, real], bodies=[body(1, 0.7)])
    faces = P._real_faces(P._faces([P.director.people_in(inp.tracks, 0, 10000)][0]), P._bodies_in(inp, 0, 10000), inp)
    assert [f.id for f in faces] == [2]
    blind = inputs(tracks=[kettle, real])          # no detector: nothing is doubted
    faces = P._real_faces(P._faces(P.director.people_in(blind.tracks, 0, 10000)), [], blind)
    assert sorted(f.id for f in faces) == [1, 2]


def test_a_face_picks_the_body_whose_top_it_sits_on():
    front = P._Face(1, 0.5, 0.6, 0.3, 0.8, 1.0)       # a person in front, box from 0.2 to 1.0
    behind = P._Face(2, 0.52, 0.35, 0.12, 0.5, 1.0)   # someone behind, box from 0.1 to 0.6
    face = P._Face(9, 0.52, 0.16, 0.05, 0.08, 1.0)    # a head at 0.16: the one behind
    assert P._body_of(face, [front, behind]).id == 2
    low = P._Face(9, 0.5, 0.3, 0.1, 0.16, 1.0)        # a head at 0.3: the front person's
    assert P._body_of(low, [front, behind]).id == 1


# --- faceless people and action ----------------------------------------------

def test_a_person_with_no_face_is_framed_on_their_body():
    inp = inputs(bodies=[body(1, 0.75, y=0.5, w=0.12, h=0.6)], detail=face_detail(at=0.75))
    plan = P.plan(inp)
    assert [s.kind for s in plan] == ["fill"]
    assert "body" in plan[0].why
    win = plan[0].window
    assert abs((win.x + win.w / 2) / 1920 - 0.75) < 0.04
    assert plan[0].zoom > 1.0, "a small figure is pushed in so the body reads"


def test_a_walking_person_is_followed_by_their_body():
    track = FaceTrack(id=1, boxes=[(ms, (0.2 + 0.6 * ms / 10000, 0.5, 0.12, 0.6)) for ms in range(0, 10000, 250)])
    plan = P.plan(inputs(bodies=[track], detail=face_detail(at=0.5)))
    xs = [x for _, x in plan[0].pan]
    assert xs[-1] - xs[0] > 400, "the window travels with them"


def test_a_faceless_shot_is_framed_on_the_action_not_the_middle():
    plan = P.plan(inputs(detail=activity(0.8)))
    assert plan[0].kind == "fill" and "action" in plan[0].why
    assert (plan[0].window.x + plan[0].window.w / 2) / 1920 > 0.65


def test_a_faceless_shot_with_motion_everywhere_keeps_the_middle():
    rows = []
    for ms in range(0, 10000, 500):
        grid = [[1.0] * ACT_COLS for _ in range(ACT_ROWS)]
        rows.append((ms, [0.02] * DETAIL_BINS, 0.4, 0.1, 0.1, grid, 0.0, 12.0))
    plan = P.plan(inputs(detail=rows))
    assert "middle" in plan[0].why


def test_a_moving_flat_picture_is_not_a_still_screen():
    """A hand drawing on paper is flat, but it moves: a crop on the action, not a screen card."""
    rows = []
    for ms in range(0, 10000, 500):
        grid = [[0.0] * ACT_COLS for _ in range(ACT_ROWS)]
        for row in grid:
            row[ACT_COLS - 3] = 1.0
        rows.append((ms, [0.08] * DETAIL_BINS, 0.9, 0.1, 0.1, grid, 0.0, 15.0))
    plan = P.plan(inputs(detail=rows))
    assert plan[0].kind == "fill"
    still = P.plan(inputs(detail=[(ms, [0.08] * DETAIL_BINS, 0.9, 0.1, 0.1, [[0.0] * ACT_COLS for _ in range(ACT_ROWS)], 0.0, 0.3) for ms in range(0, 10000, 500)]))
    assert still[0].kind in {"screen", "fit"}


# --- text on screen ---------------------------------------------------------

def test_a_title_across_the_picture_is_shown_whole_and_a_corner_label_is_not():
    title = [(ms, [(0.2, 0.3, 0.6, 0.3)]) for ms in range(0, 10000, 500)]
    assert P.plan(inputs(tracks=[person(1, 0.5)], texts=title))[0].kind == "fit"
    label = [(ms, [(0.71, 0.8, 0.24, 0.12)]) for ms in range(0, 10000, 500)]
    assert P.plan(inputs(tracks=[person(1, 0.5)], texts=label))[0].kind == "fill"


def test_a_fill_window_never_slices_a_label():
    label = [(ms, [(0.60, 0.8, 0.14, 0.1)]) for ms in range(0, 10000, 500)]
    plan = P.plan(inputs(tracks=[person(1, 0.5)], texts=label))
    win = plan[0].window
    wl, wr = win.x / 1920, (win.x + win.w) / 1920
    assert wr <= 0.60 + 1e-6 or wl >= 0.74 - 1e-6 or (wl <= 0.60 and wr >= 0.74)


def test_text_spans_need_the_text_to_hold_still():
    seen = [(ms, [(0.1, 0.8, 0.2, 0.1)]) for ms in range(0, 3000, 500)] + [(3000, [(0.5, 0.5, 0.1, 0.05)])]
    spans = graphics.text_spans(seen, 0, 4000)
    assert len(spans) == 1 and abs(spans[0][0] - 0.1) < 1e-6


def test_a_card_must_carry_text_when_the_text_detector_ran():
    import pytest

    pytest.importorskip("cv2")
    from test_graphics import _frame

    frame = _frame()
    card = graphics._cards_in(frame)
    assert len(card) == 1
    x, y, w, h = card[0]
    assert graphics._cards_in(frame, [(x + w * 0.1, y + h * 0.2, w * 0.6, h * 0.2)])
    assert graphics._cards_in(frame, []) == []


# --- push-in rails ----------------------------------------------------------

def test_the_zoom_cap_does_not_depend_on_the_render_size():
    full = inputs(tracks=[person(1, 0.5, h=0.06, w=0.03)])
    preview = inputs(tracks=[person(1, 0.5, h=0.06, w=0.03)], out_w=540, out_h=960)
    assert P.plan(full)[0].zoom == P.plan(preview)[0].zoom


def test_a_push_in_keeps_the_subjects_body_in_the_window():
    inp = inputs(tracks=[person(1, 0.5, w=0.03, h=0.06)], bodies=[body(1, 0.5, w=0.26, h=0.9)])
    plan = P.plan(inp)
    assert plan[0].window.w / 1920 * (1 - P.director.EDGE_MARGIN) >= 0.26 - 1e-6


def test_a_speck_of_a_face_with_no_body_is_barely_pushed():
    inp = inputs(tracks=[person(1, 0.5, w=0.02, h=0.04)], bodies=[body(7, 0.9, w=0.1, h=0.3)])
    assert P.plan(inp)[0].zoom <= P.TINY_FACE_ZOOM + 1e-6


# --- cuts -------------------------------------------------------------------

def test_a_cut_is_a_spike_and_a_sweep_is_not(tmp_path):
    """A hard cut is found; a fast sweep across the frame (sustained change) is not a run of cuts."""
    import pytest

    pytest.importorskip("cv2")
    import subprocess

    from app.pipeline import frame as F
    from app.pipeline import speaker as sp

    if F._detector()[1] is None:
        pytest.skip("cuts are read in the face pass, which needs the face model")
    clip = tmp_path / "cut.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=0x202060:s=640x360:r=25:d=2",
        "-f", "lavfi", "-i", "color=c=0xC08020:s=640x360:r=25:d=3",
        "-f", "lavfi", "-i", "color=c=0xF0F0F0:s=160x360:r=25:d=3",
        "-filter_complex", "[1:v][2:v]overlay=x='-160+t*300':y=0[sweep];[0:v][sweep]concat=n=2:v=1:a=0",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", str(clip),
    ], check=True)
    _tracks, cuts = sp.face_tracks(clip, out_ms=5000, detect_people=False)
    assert any(1800 <= c <= 2300 for c in cuts), cuts
    assert sum(1 for c in cuts if c > 2400) == 0, f"the sweep registered as cuts: {cuts}"


# --- phase 2: groups, splits, screen, pip, scan, headline -------------------

def _crowd(xs, w=0.02, h=0.04):
    return [person(i + 1, x, w=w, h=h) for i, x in enumerate(xs)]


def test_a_wide_group_bunched_on_one_side_is_framed_there_not_shown_whole():
    xs = [0.12, 0.62, 0.66, 0.70, 0.74, 0.78]            # one person off to the left, the rest together
    faces = _crowd(xs)
    bods = [body(i + 1, x, w=0.04, h=0.3) for i, x in enumerate(xs)]
    plan = P.plan(inputs(tracks=faces, bodies=bods))
    assert plan[0].kind == "fill" and "group" in plan[0].why
    assert (plan[0].window.x + plan[0].window.w / 2) / 1920 > 0.6


def test_a_wide_group_spread_across_the_picture_is_shown_whole():
    xs = [0.06, 0.24, 0.42, 0.6, 0.78, 0.94]
    plan = P.plan(inputs(tracks=_crowd(xs), bodies=[body(i + 1, x, w=0.05, h=0.3) for i, x in enumerate(xs)]))
    assert plan[0].kind == "fit"


def test_a_close_up_beside_a_speck_is_not_split():
    big, speck = person(1, 0.3, w=0.2, h=0.35), person(2, 0.85, w=0.03, h=0.06)
    plan = P.plan(inputs(tracks=[big, speck], layout="split"))
    assert plan[0].kind == "fill"
    two = P.plan(inputs(tracks=[person(1, 0.25, w=0.09), person(2, 0.75, w=0.08)], layout="split"))
    assert two[0].kind == "split"


def test_the_screen_layout_follows_a_close_up_instead_of_showing_the_face_twice():
    plan = P.plan(inputs(tracks=[person(1, 0.5, w=0.2, h=0.35)], layout="screen"))
    assert plan[0].kind == "fill"


def test_a_corner_webcam_gets_the_screen_without_its_corner_on_top():
    cam = person(1, 0.9, y=0.88, w=0.06, h=0.1)
    plan = P.plan(inputs(tracks=[cam], layout="screen"))
    assert plan[0].kind == "screen" and plan[0].cells
    region = plan[0].cells[0]
    assert region.x == 0 and (region.x + region.w) / 1920 <= 0.86, "the webcam's corner is left out"


def test_the_pip_bubble_sits_away_from_the_speakers_face():
    a, b = person(1, 0.15, w=0.08), person(2, 0.85, w=0.08)
    plan = P.plan(inputs(tracks=[a, b], layout="pip"))
    assert plan[0].kind == "pip" and plan[0].side in {"left", "right"}
    tiny = P.plan(inputs(tracks=[person(1, 0.15, w=0.08), person(2, 0.85, w=0.015, h=0.03)], layout="pip"))
    assert tiny[0].kind == "fill"


def test_a_long_faceless_shot_drifts_and_a_short_one_holds():
    long = P.plan(inputs(detail=face_detail(at=0.5)))[0]
    xs = [x for _, x in long.pan]
    assert max(xs) - min(xs) > 24 and "drifting" in long.why
    short = P.plan(inputs(out_ms=2000, detail=face_detail(end=2000, at=0.5)))[0]
    assert len({x for _, x in short.pan}) == 1


def test_the_headline_moves_off_a_label_at_the_top_of_the_crop():
    from app.pipeline import compose

    assert compose.title_place({}, None, top_text=0.8, bottom_text=0.0) == "bottom"
    assert compose.title_place({}, None, top_text=0.0, bottom_text=0.8) == "top"
    assert compose.title_place({"position": "top"}, None, top_text=0.9) == "top"


def test_black_bars_are_found_and_every_crop_stays_inside_the_picture(tmp_path):
    import subprocess

    import pytest

    pytest.importorskip("cv2")
    clip = tmp_path / "lb.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "testsrc2=s=1920x800:r=25:d=3", "-vf", "pad=1920:1080:0:140:black",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip)], check=True)
    active = graphics.letterbox(clip, 0, 3000)
    assert active is not None and abs(active[1] - 140 / 1080) < 0.02 and abs(active[3] - 940 / 1080) < 0.02
    plan = P.plan(inputs(out_ms=3000, active=active, tracks=[person(1, 0.5, y=0.5, end=3000)]))
    win = plan[0].window
    assert win.y >= 140 - 2 and win.y + win.h <= 940 + 2, "no bar in the crop"


def test_a_frame_without_bars_has_no_letterbox(tmp_path):
    import subprocess

    import pytest

    pytest.importorskip("cv2")
    clip = tmp_path / "full.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "testsrc2=s=1280x720:r=25:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip)], check=True)
    assert graphics.letterbox(clip, 0, 2000) is None


def test_a_small_corner_face_in_a_busy_room_is_not_a_screen_share():
    """White walls are flat like a screen; a room where people move is not a webcam over a screen."""
    cam = person(1, 0.9, y=0.88, w=0.06, h=0.1)
    flat_moving = activity(0.5, level=12.0)
    flat_moving = [(e[0], [0.08] * DETAIL_BINS, 0.9, 0.1, 0.1, e[5], 0.0, 12.0, 160.0) for e in flat_moving]
    plan = P.plan(inputs(tracks=[cam], detail=flat_moving))
    assert plan[0].kind != "screen"
    flat_still = [(e[0], [0.08] * DETAIL_BINS, 0.9, 0.1, 0.1, e[5], 0.0, 0.5, 160.0) for e in activity(0.5)]
    still = P.plan(inputs(tracks=[cam], detail=flat_still))
    assert still[0].kind == "screen", "a webcam over a still screen keeps the screen layout"
