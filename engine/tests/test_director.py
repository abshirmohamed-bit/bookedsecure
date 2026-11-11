"""The virtual camera operator: shot by shot, the speaker always in frame."""
from __future__ import annotations

import numpy as np

from app.pipeline import director as d
from app.pipeline import frame as F
from app.pipeline.speaker import FaceTrack, Turn, refine_cuts

#: 9:16 out of 16:9.
W = d.window_share(1920, 1080, 1080, 1920)


def face(tid, x, w, start, end, step=500, wobble=0.0, y=0.4):
    boxes = [(ms, (x + (wobble if (ms // step) % 2 else -wobble), y, w, w * 1.6))
             for ms in range(start, end, step)]
    return FaceTrack(id=tid, boxes=boxes)


def centre_at(samples, ms):
    c = samples[0][1]
    for t, x in samples:
        if t <= ms:
            c = x
    return c


def inside(samples, ms, x, w, window=W):
    c = centre_at(samples, ms)
    return c - window / 2 <= x - w / 2 and x + w / 2 <= c + window / 2


# --- the bug from the real clips ---------------------------------------------

def test_a_wide_shot_after_a_close_up_is_not_framed_where_the_close_up_was():
    """Reported: clips framed on the flag between host and guest. A close-up
    put the guest at 0.47; the wide shot after the cut has the host at 0.21
    and the guest at 0.77, nobody could be named as talking there, and the
    old crop held 0.47 — empty backdrop — for the whole shot."""
    tracks = [face(1, 0.47, 0.15, 0, 5000),                 # close-up
              face(2, 0.77, 0.056, 5300, 16000),            # wide: guest
              face(3, 0.21, 0.042, 5300, 16000)]            # wide: host
    turns = [Turn(0, 5000, 1, 1.0), Turn(5000, 16000, None, 1.0, "unseen")]
    samples = d.plan_camera(tracks, turns, [5300], 0, 16000, W)
    for ms in range(5300, 16000, 250):
        c = centre_at(samples, ms)
        assert abs(c - 0.77) < 0.1 or abs(c - 0.21) < 0.1, (ms, c)
    # The larger face is the one the wide shot is about.
    assert abs(centre_at(samples, 8000) - 0.77) < 0.05
    assert d.misses(samples, tracks, turns, [5300], 0, 16000, W) == []


def test_the_frame_changes_on_the_cut_itself():
    tracks = [face(1, 0.77, 0.06, 0, 5000), face(2, 0.47, 0.15, 5300, 9000)]
    samples = d.plan_camera(tracks, [], [5300], 0, 9000, W)
    # One frame before the cut is still the old shot; the command lands
    # just ahead of the cut frame so it applies to that frame.
    assert any(5300 - d.CUT_LEAD_MS <= ms <= 5300 and abs(c - 0.47) < 0.05 for ms, c in samples)
    assert abs(centre_at(samples, 5280) - 0.77) < 0.05


def test_nothing_is_carried_across_a_cut_even_for_a_named_speaker():
    tracks = [face(1, 0.30, 0.15, 0, 4000),
              face(2, 0.80, 0.06, 4000, 8000), face(3, 0.15, 0.04, 4000, 8000)]
    # Speaker named in the first shot only.
    turns = [Turn(0, 4000, 1, 1.0), Turn(4000, 8000, None, 1.0, "unseen")]
    samples = d.plan_camera(tracks, turns, [4000], 0, 8000, W)
    assert abs(centre_at(samples, 6000) - 0.30) > 0.2


# --- composition --------------------------------------------------------------

def test_people_who_fit_together_are_framed_together():
    tracks = [face(1, 0.44, 0.05, 0, 6000), face(2, 0.56, 0.05, 0, 6000)]
    turns = [Turn(0, 3000, 1, 1.0), Turn(3000, 6000, 2, 1.0)]
    samples = d.plan_camera(tracks, turns, [], 0, 6000, W)
    assert len(samples) == 1                       # a locked-off two-shot
    assert abs(samples[0][1] - 0.5) < 0.02
    for t in tracks:
        for ms, (x, _y, w, _h) in t.boxes:
            assert inside(samples, ms, x, w)


def test_a_wide_two_shot_cuts_between_speakers_at_their_turns():
    host, guest = face(1, 0.2, 0.05, 0, 12000), face(2, 0.8, 0.05, 0, 12000)
    turns = [Turn(0, 4000, 1, 1.0), Turn(4000, 12000, 2, 1.0)]
    samples = d.plan_camera([host, guest], turns, [], 0, 12000, W)
    assert abs(centre_at(samples, 2000) - 0.2) < 0.05
    assert abs(centre_at(samples, 8000) - 0.8) < 0.05
    assert d.misses(samples, [host, guest], turns, [], 0, 12000, W) == []


def test_an_interjection_is_not_cut_to():
    host, guest = face(1, 0.2, 0.05, 0, 12000), face(2, 0.8, 0.05, 0, 12000)
    turns = [Turn(0, 5000, 2, 1.0), Turn(5000, 5600, 1, 1.0), Turn(5600, 12000, 2, 1.0)]
    samples = d.plan_camera([host, guest], turns, [], 0, 12000, W)
    assert all(abs(c - 0.8) < 0.05 for _ms, c in samples)


def test_a_shot_holds_still_through_detector_jitter():
    t = face(1, 0.5, 0.15, 0, 10000, wobble=0.01)
    samples = d.plan_camera([t], [], [], 0, 10000, W)
    assert len(samples) == 1


def test_someone_who_moves_is_followed_and_never_leaves_the_frame():
    boxes = [(ms, (0.2 + 0.6 * ms / 10000, 0.4, 0.12, 0.2)) for ms in range(0, 10000, 500)]
    t = FaceTrack(id=1, boxes=boxes)
    samples = d.plan_camera([t], [], [], 0, 10000, W)
    assert len(samples) > 5
    for ms, (x, _y, w, _h) in boxes:
        assert inside(samples, ms, x, w), ms
    steps = [abs(b[1] - a[1]) for a, b in zip(samples, samples[1:])]
    assert max(steps) < 0.05                       # glides, no jumps


def test_nobody_is_left_half_in_frame():
    # Subject at 0.5; someone else's face straddles where the right edge
    # would fall if the window were simply centred on the subject.
    subject = face(1, 0.50, 0.10, 0, 6000)
    other = face(2, 0.67, 0.05, 0, 6000)
    turns = [Turn(0, 6000, 1, 1.0)]
    samples = d.plan_camera([subject, other], turns, [], 0, 6000, W)
    c = samples[0][1]
    left, right = c - W / 2, c + W / 2
    ol, orr = 0.67 - 0.025, 0.67 + 0.025
    assert orr <= right or ol >= right            # wholly in, or wholly out
    assert inside(samples, 0, 0.5, 0.10)


def test_a_shot_with_nobody_in_it_is_centred():
    t = face(1, 0.2, 0.1, 0, 3000)
    samples = d.plan_camera([t], [], [3000], 0, 6000, W)
    assert centre_at(samples, 4500) == 0.5


def test_a_reaction_clip_ignores_who_is_talking():
    host, guest = face(1, 0.2, 0.07, 0, 8000), face(2, 0.8, 0.04, 0, 8000)
    turns = [Turn(0, 8000, 2, 1.0)]
    talker = d.plan_camera([host, guest], turns, [], 0, 8000, W)
    reaction = d.plan_camera([host, guest], turns, [], 0, 8000, W, use_turns=False)
    assert abs(talker[0][1] - 0.8) < 0.05
    assert abs(reaction[0][1] - 0.2) < 0.05       # the most prominent face


def test_the_window_stays_inside_the_source():
    t = face(1, 0.03, 0.05, 0, 4000)
    samples = d.plan_camera([t], [], [], 0, 4000, W)
    assert samples[0][1] >= W / 2 - 1e-4


def test_window_share_follows_the_output_shape():
    assert abs(d.window_share(1920, 1080, 1080, 1920) - 0.316) < 0.001
    assert abs(d.window_share(1920, 1080, 1080, 1080) - 0.5625) < 0.001
    assert d.window_share(1080, 1920, 1080, 1920) == 1.0


# --- layout --------------------------------------------------------------------

def test_two_shots_of_one_person_are_not_stacked_as_two_people():
    """A close-up at one side and a wide shot at the other look, clip-wide,
    like two people sitting apart. Stacking them shows one person twice."""
    track = F.Track("yunet", 1920, 1080, [(0, 0.3)], [
        F.Face(1, 0.25, 0.4, 0.15, 0.25, share=0.5), F.Face(2, 0.80, 0.4, 0.05, 0.1, share=0.5)])
    assert F.suggest_layout(track) == "split"      # what the clusters alone say
    tracks = [face(1, 0.25, 0.15, 0, 5000), face(2, 0.80, 0.05, 5000, 10000)]
    chosen = F.plan(track, tracks, [], 1080, 1920, "auto", [5000])
    assert chosen["layout"] == "full-video"


def test_two_people_who_share_the_screen_can_still_be_split():
    track = F.Track("yunet", 1920, 1080, [(0, 0.5)], [
        F.Face(1, 0.2, 0.4, 0.06, 0.1, share=0.5), F.Face(2, 0.8, 0.4, 0.06, 0.1, share=0.5)])
    tracks = [face(1, 0.2, 0.06, 0, 10000), face(2, 0.8, 0.06, 0, 10000)]
    chosen = F.plan(track, tracks, [], 1080, 1920, "auto", [])
    assert chosen["layout"] == "split"


# --- exact cuts -------------------------------------------------------------------

def test_a_cut_is_pinned_to_its_exact_frame(tmp_path):
    from app.pipeline.speaker import RAW_H, RAW_W

    fps = 30.0
    frames = np.zeros((90, RAW_H, RAW_W), dtype=np.uint8)
    frames[47:] = 200                               # the new shot starts on frame 47
    raw = tmp_path / "cuts.gray"
    frames.tofile(raw)
    # The 10 fps proxy saw it at its frame 16 (1600 ms).
    out = refine_cuts([1600], raw, fps, 0, step_ms=100)
    assert out == [round(47 * 1000 / fps)]


def test_refining_falls_back_without_the_copy(tmp_path):
    assert refine_cuts([1600], tmp_path / "missing.gray", 30.0, 0, step_ms=100) == [1600]
