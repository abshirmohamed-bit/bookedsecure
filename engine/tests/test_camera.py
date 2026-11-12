"""The camera moves like a person operating it, and composition changes transition."""
from __future__ import annotations

import shutil
import subprocess

import pytest

from app.pipeline import camera
from app.pipeline.shots import Box, Inputs, Shot


def _inp(**kw) -> Inputs:
    base = dict(width=1920, height=1080, out_w=1080, out_h=1920, in_ms=0, out_ms=20_000)
    base.update(kw)
    return Inputs(**base)


def test_easing_starts_and_lands_softly():
    assert camera.ease_in_out(0) == 0 and camera.ease_in_out(1) == 1
    assert camera.ease_in_out(0.5) == pytest.approx(0.5)
    assert camera.ease_in_out(0.05) < 0.01          # slow off the mark
    assert camera.ease_in_out(0.95) > 0.99          # soft landing


def test_a_new_subject_mid_shot_is_glided_to_not_jumped():
    at = camera.centre_path([(0, 500.0), (4000, 800.0)], cuts=[], window_w=608)
    assert at(3999) == 500
    assert at(4000 + camera.REACT_MS) == 500                    # reacts a beat later
    mid = at(4000 + camera.REACT_MS + camera.GLIDE_MAX_MS / 2)
    assert 500 < mid < 800
    assert at(6000) == 800
    # no frame-to-frame step bigger than a smooth glide allows
    xs = [at(t) for t in range(3900, 5200, 33)]
    assert max(abs(b - a) for a, b in zip(xs, xs[1:])) < 120


def test_a_real_camera_cut_stays_a_cut():
    at = camera.centre_path([(0, 500.0), (4000, 1200.0)], cuts=[4020], window_w=608)
    assert at(3999) == 500 and at(4001) == 1200


def test_a_move_that_starts_before_the_last_landed_has_no_kink():
    at = camera.centre_path([(0, 0.0), (1000, 300.0), (1300, 50.0)], cuts=[], window_w=608)
    xs = [at(t) for t in range(900, 3000, 33)]
    assert max(abs(b - a) for a, b in zip(xs, xs[1:])) < 120
    assert at(3000) == 50


def test_long_shots_breathe_and_alternate_direction():
    push = [camera.zoom_at(t, (0, 8000), 0, [], hook=False) for t in (0, 4000, 8000)]
    pull = [camera.zoom_at(t, (0, 8000), 1, [], hook=False) for t in (0, 4000, 8000)]
    assert push[0] == 1 and 1.03 <= push[2] <= 1.06
    assert pull[0] > pull[2] == 1
    assert camera.zoom_at(1000, (0, 2000), 0, [], hook=False) == 1    # short shots hold


def test_a_punch_in_attacks_fast_and_releases_slowly():
    p = [camera.Punch(1000)]
    z = lambda t: camera.zoom_at(t, (0, 2000), 0, p, hook=False)
    assert z(999) == 1
    assert z(1000 + camera.PUNCH_ATTACK_MS) == pytest.approx(1 + camera.PUNCH_GAIN)
    assert z(1000 + camera.PUNCH_ATTACK_MS + camera.PUNCH_HOLD_MS + camera.PUNCH_RELEASE_MS + 1) == 1


def test_punches_land_on_loud_or_stressed_words_and_are_spaced_out():
    words = [{"text": w, "start_ms": i * 400, "end_ms": i * 400 + 300}
             for i, w in enumerate(("so this is the thing you never ever want to do and it is huge right now " * 3).split())]
    env = [100.0] * 250
    for k in range(42, 45):          # a shout around 4.2 s
        env[k] = 900.0
    chosen = camera.punch_moments(words, env, 25_000, [(0, 25_000)])
    assert chosen and len(chosen) <= 25_000 // camera.PUNCH_EVERY_MS
    assert any(abs(p.ms - 4200) < 500 for p in chosen) or any(
        words[[w["start_ms"] for w in words].index(p.ms)]["text"] in {"never", "huge", "now"} for p in chosen)
    gaps = [b.ms - a.ms for a, b in zip(chosen, chosen[1:])]
    assert all(g >= camera.PUNCH_GAP_MS for g in gaps)
    assert all(p.ms >= camera.PUNCH_CLEAR_START_MS for p in chosen)


def test_composition_changes_get_a_transition_but_camera_cuts_do_not():
    win = Box(600, 0, 608, 1080)
    shots = [Shot(0, 5000, "fill", window=win, pan=[(0, 600)]),
             Shot(5000, 9000, "split", cells=[Box(0, 0, 960, 540), Box(960, 0, 960, 540)]),
             Shot(9000, 14000, "fill", window=win, pan=[(9000, 600)]),
             Shot(14000, 20000, "fill", window=Box(100, 0, 608, 1080), pan=[(14000, 100)])]
    camera.apply(shots, _inp(cuts=[14000]))
    assert shots[0].transition is None
    assert shots[1].transition == "smoothup"
    assert shots[2].transition == "zoomin"
    assert shots[3].transition is None              # the camera cut there itself


def test_fill_motion_stays_inside_the_source_and_even():
    shot = Shot(0, 9000, "fill", window=Box(1300, 0, 608, 1080), pan=[(0, 1300), (4000, 0)])
    camera.apply([shot], _inp(out_ms=9000))
    assert shot.motion
    for _ms, x, y, w, h in shot.motion:
        assert 0 <= x <= 1920 - w + 0.01 and 0 <= y <= 1080 - h + 0.01
    # opens on the hook (a little tight) then settles
    assert shot.motion[3][3] < 608 and shot.motion[60][3] > shot.motion[3][3]


def test_zoom_off_holds_the_size():
    shot = Shot(0, 9000, "fill", window=Box(600, 0, 608, 1080), pan=[(0, 600)])
    camera.apply([shot], _inp(out_ms=9000, zoom="off"))
    assert {m[3] for m in shot.motion} == {608.0}


def test_transitions_keep_the_clip_exactly_as_long():
    from app.pipeline.compose import join_shots
    win = Box(600, 0, 608, 1080)
    plan = [Shot(0, 3000, "fill", window=win), Shot(3000, 6000, "split"), Shot(6000, 8000, "fill", window=win),
            Shot(8000, 10000, "fill", window=win)]
    plan[1].transition, plan[2].transition = "smoothup", "zoomin"
    lines = join_shots(plan)
    xf = [l for l in lines if "xfade" in l]
    assert len(xf) == 2
    # first join: shot 0 ran 100 ms long, so the fade starts 100 ms before the planned change
    assert "offset=2.900" in xf[0]
    assert "offset=5.900" in xf[1]
    assert lines[-1].endswith("[base]")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_a_render_with_moves_and_transitions_has_the_planned_length(tmp_path):
    from app.pipeline import compose
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6",
                    "-f", "lavfi", "-i", "sine=f=440:duration=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(src)], check=True)
    win = Box(400, 0, 404, 720)
    plan = [Shot(0, 3000, "fill", window=win, pan=[(0, 400), (1500, 100)]),
            Shot(3000, 6000, "split", cells=[Box(0, 0, 640, 720), Box(640, 0, 640, 720)])]
    inp = Inputs(width=1280, height=720, out_w=540, out_h=960, in_ms=0, out_ms=6000)
    camera.apply(plan, inp)
    assert plan[1].transition
    chain = ["[0:v]fps=30,split=2[s0][s1]"]
    for i, shot in enumerate(plan):
        lines, _ = compose._shot_graph(shot, i, inp, 540, 960, tmp_path,
                                       50 if i == 1 else 0, 100 if i == 0 else 0)
        chain += lines
    chain += compose.join_shots(plan)
    from app.pipeline import looks
    chain[1:1] = looks.emit_stills(tmp_path, 190)
    out = tmp_path / "out.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex", ";".join(chain),
                    "-map", "[base]", "-c:v", "libx264", "-preset", "ultrafast", str(out)],
                   check=True, cwd=tmp_path)
    probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                            "stream=nb_read_frames,width,height", "-of", "csv=p=0", str(out)],
                           capture_output=True, text=True, check=True).stdout.strip()
    w, h, frames = (int(v) for v in probe.split(","))
    assert (w, h) == (540, 960)
    assert abs(frames - 180) <= 2


def test_a_moving_camera_never_changes_the_picture_size_mid_stream():
    """ffmpeg 7's scale filter drops the rest of a stream when its input size keeps changing."""
    from app.pipeline import compose
    shot = Shot(0, 6000, "fill", window=Box(600, 0, 608, 1080), pan=[(0, 600), (3000, 1100)])
    camera.apply([shot], _inp(out_ms=6000))
    chain = compose.camera_chain(shot, 0, 6000, 1920, 1080)
    assert "sendcmd" not in chain and chain.startswith("crop=")
    assert "perspective=" in chain and "eval=frame" in chain


def test_the_camera_ramp_follows_the_path_within_a_third_of_a_pixel():
    from app.pipeline.compose import _ramp
    import math as m
    values = [300 + 200 * camera.ease_in_out(k / 40) for k in range(41)] + [500.0] * 20
    expr = _ramp(values, 1)
    def ev(n):
        return eval(expr.replace("in", str(n)).replace("clip", "_clip"), {"_clip": lambda v, a, b: max(a, min(b, v))})
    assert max(abs(ev(k + 1) - v) for k, v in enumerate(values)) < 0.35
    assert expr.count("clip") < 30


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_every_look_renders_its_full_length(tmp_path):
    """Cards, duo cards, cinema bars and the bubble use stills; each must end with its shot."""
    from app.pipeline import compose
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)], check=True)
    inp = Inputs(width=1280, height=720, out_w=540, out_h=960, in_ms=0, out_ms=3000)
    for shot in (Shot(0, 3000, "fit"), Shot(0, 3000, "bars"),
                 Shot(0, 3000, "split", cells=[Box(0, 0, 640, 720), Box(640, 0, 640, 720)]),
                 Shot(0, 3000, "pip", window=Box(400, 0, 404, 720), inset=Box(900, 100, 200, 260))):
        wd = tmp_path / shot.kind
        wd.mkdir()
        lines, _ = compose._shot_graph(shot, 0, inp, 540, 960, wd)
        from app.pipeline import looks
        graph = ";".join(["[0:v]fps=30,split=1[s0]", *looks.emit_stills(wd, 92), *lines]).replace("[v0]", "[base]")
        out = wd / "o.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex", graph, "-map", "[base]",
                        "-c:v", "libx264", "-preset", "ultrafast", str(out)], check=True, cwd=wd, timeout=120)
        frames = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                                     "stream=nb_read_frames", "-of", "csv=p=0", str(out)],
                                    capture_output=True, text=True, check=True).stdout.strip())
        assert abs(frames - 90) <= 2, (shot.kind, frames)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_a_huge_graph_goes_to_ffmpeg_as_a_file(tmp_path):
    """A long clip with many moving shots can't fit on a command line."""
    from app.pipeline import compose
    big = "[0:v]" + ",".join(["null"] * 3000) + "[base]"
    args = compose._graph_args(big, tmp_path)
    assert args[0] == "-/filter_complex"
    assert compose.graph_of(args) == big
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=1",
                    "-c:v", "libx264", str(src)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), *args, "-map", "[base]", "-f", "null", "-"],
                   check=True, timeout=120)


def test_a_long_re_aim_between_people_is_a_cut_like_an_editor_would_make():
    at = camera.centre_path([(0, 300.0), (4000, 1300.0)], cuts=[], window_w=608)
    assert at(3999) == 300 and at(4001) == 1300          # 1000 px > 0.6 x 608: cut
    near = camera.centre_path([(0, 300.0), (4000, 500.0)], cuts=[], window_w=608)
    assert 300 < near(4000 + camera.REACT_MS + 200) < 500  # 200 px: glide
