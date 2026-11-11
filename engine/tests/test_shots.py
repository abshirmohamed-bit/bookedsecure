"""The shot plan: what each stretch of a clip is composed as.

Everything here is arithmetic over synthetic faces, turns, cuts and detail
profiles, so the decisions are checked without a video. The pictures those
decisions make are checked on real footage by hand (tools/analysis_sheet.py).
"""
from __future__ import annotations

from app.pipeline import compose
from app.pipeline import shots as P
from app.pipeline.speaker import DETAIL_BINS, FaceTrack, Turn


def person(tid, x, y=0.45, w=0.09, h=0.2, start=0, end=10000, step=500):
    return FaceTrack(id=tid, boxes=[(ms, (x, y, w, h)) for ms in range(start, end, step)])


def inputs(**kw):
    base = dict(width=1920, height=1080, out_w=1080, out_h=1920, in_ms=0, out_ms=10000, layout="auto")
    base.update(kw)
    return P.Inputs(**base)


def flat_detail(start=0, end=10000, level=0.08):
    """Edges everywhere: a page of text or a slide."""
    return [(ms, [level] * DETAIL_BINS, 0.9) for ms in range(start, end, 500)]


def face_detail(start=0, end=10000, at=0.5):
    """Edges only where the person is: a talking head on a soft background."""
    prof = [0.0] * DETAIL_BINS
    i = int(at * DETAIL_BINS)
    for k in range(max(0, i - 5), min(DETAIL_BINS, i + 5)):
        prof[k] = 0.3
    return [(ms, prof, 0.6) for ms in range(start, end, 500)]


# --- one person ----------------------------------------------------------

def test_one_person_is_a_single_fill_on_them():
    plan = P.plan(inputs(tracks=[person(1, 0.7)]))
    assert [s.kind for s in plan] == ["fill"]
    win = plan[0].window
    assert win.w == 608 and win.h == 1080
    assert abs((win.x + win.w / 2) / 1920 - 0.7) < 0.03


def test_a_small_face_in_a_wide_shot_is_pushed_in():
    wide = P.plan(inputs(tracks=[person(1, 0.5, h=0.07, w=0.035)], zoom="auto"))
    assert wide[0].zoom > 1.1
    assert wide[0].window.w < 608 and wide[0].window.h < 1080
    off = P.plan(inputs(tracks=[person(1, 0.5, h=0.07, w=0.035)], zoom="off"))
    assert off[0].zoom == 1.0 and off[0].window.h == 1080


def test_a_pushed_in_crop_leaves_room_above_the_head():
    plan = P.plan(inputs(tracks=[person(1, 0.5, y=0.5, h=0.07, w=0.035)], zoom="auto"))
    win = plan[0].window
    face_top = (0.5 - 0.035) * 1080
    assert win.y < face_top, "the crop starts above the face"
    assert (0.5 * 1080 - win.y) / win.h < 0.5, "and the face sits in the upper half"


def test_a_close_up_is_not_pushed_in_further():
    plan = P.plan(inputs(tracks=[person(1, 0.5, h=0.35, w=0.18)], zoom="auto"))
    assert plan[0].zoom == 1.0


def test_a_sharp_source_may_be_pushed_in_further_than_a_soft_one():
    small = [person(1, 0.5, h=0.05, w=0.025)]
    hd = P.plan(inputs(tracks=small))[0].zoom
    uhd = P.plan(inputs(width=3840, height=2160, tracks=small))[0].zoom
    assert uhd > hd


# --- two people -----------------------------------------------------------

def test_two_people_who_fit_are_framed_together():
    plan = P.plan(inputs(tracks=[person(1, 0.44), person(2, 0.56)]))
    assert [s.kind for s in plan] == ["fill"]
    win = plan[0].window
    assert win.x < 0.44 * 1920 - 0.045 * 1920 and win.x + win.w > 0.56 * 1920 + 0.045 * 1920


def test_two_people_apart_with_one_talking_follow_the_talker():
    plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=[Turn(0, 10000, 2, 0.9)]))
    assert [s.kind for s in plan] == ["fill"]
    win = plan[0].window
    assert abs((win.x + win.w / 2) / 1920 - 0.8) < 0.05


def test_two_people_apart_who_both_talk_are_stacked():
    turns = [Turn(0, 5000, 1, 0.9), Turn(5000, 10000, 2, 0.9)]
    plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=turns))
    assert [s.kind for s in plan] == ["split"]
    cells = plan[0].cells
    assert len(cells) == 2
    assert cells[0].x < cells[1].x, "left-hand person on top"
    assert cells[0].x + cells[0].w <= 0.8 * 1920 - 0.045 * 1920, "nobody appears twice"


def test_two_people_apart_with_nobody_named_are_stacked():
    plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)]))
    assert [s.kind for s in plan] == ["split"]


def test_split_is_only_a_policy_when_people_share_the_shot():
    plan = P.plan(inputs(tracks=[person(1, 0.5)], layout="split"))
    assert [s.kind for s in plan] == ["fill"]


def test_split_layout_stacks_two_people_whatever_the_turns_say():
    plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=[Turn(0, 10000, 2, 0.9)], layout="split"))
    assert [s.kind for s in plan] == ["split"]


# --- shots ----------------------------------------------------------------

def test_a_cut_starts_a_new_shot_with_its_own_framing():
    tracks = [person(1, 0.25, end=5000), person(2, 0.75, start=5000)]
    plan = P.plan(inputs(tracks=tracks, cuts=[5000]))
    assert [(s.start_ms, s.end_ms, s.kind) for s in plan] == [(0, 5000, "fill"), (5000, 10000, "fill")]
    assert plan[0].window.x < plan[1].window.x


def test_a_shot_with_nobody_in_it_and_detail_everywhere_is_shown_whole():
    plan = P.plan(inputs(tracks=[person(1, 0.5, end=5000)], cuts=[5000], detail=flat_detail(5000, 10000)))
    assert [s.kind for s in plan] == ["fill", "fit"]


def test_a_shot_with_nobody_in_it_and_nothing_to_cut_off_is_centred_on_the_busy_part():
    plan = P.plan(inputs(tracks=[person(1, 0.5, end=5000)], cuts=[5000], detail=face_detail(5000, 10000, at=0.3)))
    assert [s.kind for s in plan] == ["fill", "fill"]
    win = plan[1].window
    assert abs((win.x + win.w / 2) / 1920 - 0.3) < 0.1


def test_a_small_face_in_a_corner_over_a_wide_picture_is_a_screen_share():
    plan = P.plan(inputs(tracks=[person(1, 0.9, y=0.85, w=0.06, h=0.08)], detail=flat_detail()))
    assert [s.kind for s in plan] == ["screen"]
    assert plan[0].main is not None


def test_a_small_face_in_the_middle_of_a_busy_studio_is_not_a_screen_share():
    busy = [(ms, [0.1] * DETAIL_BINS, 0.2) for ms in range(0, 10000, 500)]
    plan = P.plan(inputs(tracks=[person(1, 0.85, y=0.3, w=0.08, h=0.15)], detail=busy))
    assert [s.kind for s in plan] == ["fill"]


def test_a_busy_shot_with_nobody_in_it_is_cropped_not_fitted():
    busy = [(ms, [0.1] * DETAIL_BINS, 0.2) for ms in range(5000, 10000, 500)]
    plan = P.plan(inputs(tracks=[person(1, 0.5, end=5000)], cuts=[5000], detail=busy))
    assert [s.kind for s in plan] == ["fill", "fill"]


def test_a_group_of_three_is_a_grid_when_the_clip_is_about_everyone():
    tracks = [person(1, 0.15), person(2, 0.5), person(3, 0.85)]
    plan = P.plan(inputs(tracks=tracks, focus="everyone"))
    assert [s.kind for s in plan] == ["grid"]
    assert len(plan[0].cells) == 3


def test_grid_layout_frames_four_people_in_four_cells():
    tracks = [person(i + 1, x, w=0.06, h=0.13) for i, x in enumerate((0.12, 0.37, 0.63, 0.88))]
    plan = P.plan(inputs(tracks=tracks, layout="grid"))
    assert [s.kind for s in plan] == ["grid"]
    cells = plan[0].cells
    assert len(cells) == 4
    assert [c.x for c in cells] == sorted(c.x for c in cells)


def test_pip_puts_the_other_person_in_an_inset():
    plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)], turns=[Turn(0, 10000, 2, 0.9)], layout="pip"))
    assert [s.kind for s in plan] == ["pip"]
    s = plan[0]
    assert s.window is not None and s.inset is not None
    assert abs((s.window.x + s.window.w / 2) / 1920 - 0.8) < 0.05, "the main picture holds on the speaker"
    assert abs((s.inset.x + s.inset.w / 2) / 1920 - 0.2) < 0.05, "the inset is the other person"


def test_whole_picture_layouts_ignore_the_faces():
    for layout, kind in (("streamer", "fit"), ("black-box", "bars"), ("title-subtitles", "headline")):
        plan = P.plan(inputs(tracks=[person(1, 0.2), person(2, 0.8)], cuts=[3000, 6000], layout=layout))
        assert [s.kind for s in plan] == [kind], layout
        assert plan[0].start_ms == 0 and plan[0].end_ms == 10000


def test_the_plan_covers_the_clip_exactly():
    tracks = [person(1, 0.3, end=4000), person(2, 0.6, start=4000, end=7000)]
    plan = P.plan(inputs(in_ms=1000, out_ms=9000, tracks=tracks, cuts=[4000, 7000], detail=flat_detail(7000, 9000)))
    assert plan[0].start_ms == 1000 and plan[-1].end_ms == 9000
    for a, b in zip(plan, plan[1:]):
        assert a.end_ms == b.start_ms


# --- zoom-in moments -------------------------------------------------------

def test_zoom_moments_punch_in_on_every_other_line():
    words = []
    t = 0
    for i in range(12):
        words.append({"text": "word" + ("." if i % 3 == 2 else ""), "start_ms": t, "end_ms": t + 700})
        t += 800
    plan = P.plan(inputs(tracks=[person(1, 0.5, h=0.3)], zoom="moments", words=words))
    assert len(plan) >= 3
    zooms = [s.zoom for s in plan]
    assert zooms[0] == 1.0 and zooms[1] > 1.0 and zooms[2] == 1.0


def test_zoom_moments_leave_a_short_shot_alone():
    words = [{"text": "yes.", "start_ms": 0, "end_ms": 500}, {"text": "no.", "start_ms": 600, "end_ms": 1200}]
    plan = P.plan(inputs(out_ms=3000, tracks=[person(1, 0.5, end=3000)], zoom="moments", words=words))
    assert len(plan) == 1


# --- the graph --------------------------------------------------------------

def test_the_graph_cuts_the_clip_into_its_shots_and_joins_them(tmp_path, monkeypatch):
    from app.pipeline import frame as F

    tracks = [person(1, 0.25, end=5000), person(2, 0.75, start=5000)]
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)], [])
    monkeypatch.setattr(compose.framing, "analyse", lambda *a, **k: (t, tracks, [], [5000], []))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4", in_ms=0, out_ms=10000, layout="auto")
    args, _ = compose.build(r, tmp_path / "w")
    graph = compose.graph_of(args)
    assert "split=2[s0][s1]" in graph
    assert "trim=start=0.000:end=5.000" in graph and "trim=start=5.000:end=10.000" in graph
    assert "concat=n=2:v=1:a=0[base]" in graph
    assert graph.count("crop@c") == 2


def test_a_fit_shot_is_the_picture_over_a_blur_of_itself(tmp_path, monkeypatch):
    from app.pipeline import frame as F

    t = F.Track("yunet", 1920, 1080, [(0, 0.5)], [])
    monkeypatch.setattr(compose.framing, "analyse", lambda *a, **k: (t, [], [], [], flat_detail()))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4", in_ms=0, out_ms=10000, layout="auto")
    graph = compose.graph_of(compose.build(r, tmp_path / "w")[0])
    assert "boxblur" in graph and "overlay=(W-w)/2:(H-h)/2" in graph


def test_a_pan_is_written_in_shot_time(tmp_path, monkeypatch):
    from app.pipeline import frame as F

    mover = FaceTrack(id=1, boxes=[(ms, (0.2 + 0.6 * (ms - 20000) / 10000, 0.45, 0.09, 0.2)) for ms in range(20000, 30000, 250)])
    t = F.Track("yunet", 1920, 1080, [(0, 0.5)], [])
    monkeypatch.setattr(compose.framing, "analyse", lambda *a, **k: (t, [mover], [], [], []))
    r = compose.Render(out=tmp_path / "o.mp4", source=tmp_path / "in.mp4", in_ms=20000, out_ms=30000, layout="auto")
    args, _ = compose.build(r, tmp_path / "w")
    cmd = (tmp_path / "w" / "crop_c0.cmd").read_text()
    first = cmd.splitlines()[0]
    assert first.startswith("0.000 crop@c0 x "), first
    assert "sendcmd=f=crop_c0.cmd" in compose.graph_of(args)


def test_caption_position_and_size_are_honoured(tmp_path):
    from app.pipeline.caption import BY_ID, build_ass

    words = [{"text": "hello", "start_ms": 0, "end_ms": 500}]
    low = build_ass(words, BY_ID["bold_white"], 1080, 1920, position="lower")
    top = build_ass(words, BY_ID["bold_white"], 1080, 1920, position="top")
    big = build_ass(words, BY_ID["bold_white"], 1080, 1920, size_scale=1.5)
    style = lambda ass: ass.split("Style: Caption,")[1].split("\n")[0].split(",")
    assert int(style(low)[20]) < int(style(top)[20]), "lower means a smaller bottom margin"
    assert int(style(big)[1]) > int(style(low)[1])


def test_the_headline_moves_off_a_head_only_onto_a_calm_bottom():
    assert compose.title_place({}, 0.3) == "top"
    assert compose.title_place({}, 0.08, top_busy=0.02, bottom_busy=0.01) == "bottom"
    assert compose.title_place({}, 0.08, top_busy=0.05, bottom_busy=0.2) == "top", "a lower-third is busier"
    assert compose.title_place({"position": "bottom"}, 0.5) == "bottom"
    assert compose.title_place({"position": "top"}, 0.05, 0.0, 0.0) == "top"


def test_the_catalog_lists_every_layout_and_zoom(api):
    body = api.get("/v1/catalog").json()
    assert {l["id"] for l in body["layouts"]} == set(P.LAYOUTS)
    assert {z["id"] for z in body["zoom"]} == set(P.ZOOMS)
    assert body["caption_styles"] and body["caption_positions"] and body["title_styles"]
    assert {a["id"] for a in body["aspects"]} == set(compose.ASPECTS)
