"""Who is speaking, from mouth movement and loudness together.

These build the two signals directly rather than decoding video, so the suite
stays fast and offline. The video path is exercised separately.
"""
import pytest

from app.pipeline import speaker as S


def track(tid: int, x: float, *, motion, span_ms: int = 8000, step_ms: int = 100) -> S.FaceTrack:
    """A person on screen for the clip, whose mouth moves as `motion(ms)` says."""
    t = S.FaceTrack(id=tid)
    for ms in range(0, span_ms, 500):
        t.boxes.append((ms, (x, 0.5, 0.1, 0.25)))
    for ms in range(0, span_ms, step_ms):
        t.motion.append((ms, motion(ms)))
    return t


def loud(*spans, span_ms: int = 8000, step_ms: int = 100):
    """Audio that is loud inside the given (start, end) spans and quiet elsewhere."""
    return [(ms, 2000.0 if any(a <= ms < b for a, b in spans) else 20.0)
            for ms in range(0, span_ms, step_ms)]


def talking(*spans):
    import math
    def f(ms):
        if any(a <= ms < b for a, b in spans):
            return 8.0 + 4.0 * abs(math.sin(ms / 120.0))
        return 0.1
    return f


def still(ms):
    return 0.1


def named(turns):
    """The (reason, track_id) of each turn, for comparing against intent."""
    return [(t.reason, t.track_id) for t in turns]


def test_the_mouth_that_moves_with_the_speech_is_the_speaker():
    host = track(1, 0.27, motion=talking((0, 3000)))
    guest = track(2, 0.73, motion=talking((4000, 7000)))
    out = S.turns([host, guest], loud((0, 3000), (4000, 7000)))
    spoke = [t.track_id for t in out if t.reason == "speaking"]
    assert spoke[0] == 1
    assert spoke[-1] == 2


def test_a_listener_is_not_promoted_to_speaker():
    host = track(1, 0.27, motion=talking((0, 3000)))
    listener = track(2, 0.73, motion=still)
    out = S.turns([host, listener], loud((0, 3000)))
    assert 2 not in [t.track_id for t in out]


def test_a_mouth_moving_in_silence_earns_nothing():
    """Chewing, laughing, nodding. Only motion during speech counts."""
    chewer = track(1, 0.27, motion=talking((3000, 4000)))     # moves while quiet
    speaker = track(2, 0.73, motion=talking((0, 3000)))        # moves while loud
    out = S.turns([chewer, speaker], loud((0, 3000)))
    spoke = {t.track_id for t in out if t.reason == "speaking"}
    assert spoke == {2}


def test_two_people_talking_at_once_is_reported_as_overlap():
    """The brief's requirement: do not force a single speaker on a scramble."""
    a = track(1, 0.27, motion=talking((0, 6000)))
    b = track(2, 0.73, motion=talking((0, 6000)))
    out = S.turns([a, b], loud((0, 6000)))
    assert all(t.track_id is None for t in out)
    assert "overlap" in {t.reason for t in out}


def test_speech_with_no_moving_mouth_is_unseen_not_guessed():
    """Both heads turned away. There is a speaker, but not on this screen."""
    a = track(1, 0.27, motion=still)
    b = track(2, 0.73, motion=still)
    out = S.turns([a, b], loud((0, 6000)))
    assert all(t.track_id is None for t in out)
    assert "unseen" in {t.reason for t in out}


def test_silence_is_its_own_answer():
    a = track(1, 0.27, motion=talking((0, 2000)))
    out = S.turns([a], loud((0, 2000)))
    assert out[-1].reason == "silence"


def test_a_flicker_does_not_become_a_cut():
    """A turn too short to cut to is given to its neighbour."""
    long_a = S.Turn(0, 4000, 1, 0.9)
    blip = S.Turn(4000, 4300, 2, 0.9)
    more_a = S.Turn(4300, 8000, 1, 0.9)
    merged = S._merge([long_a, blip, more_a], S.MIN_TURN_MS)
    assert len(merged) == 1
    assert merged[0].track_id == 1
    assert (merged[0].start_ms, merged[0].end_ms) == (0, 8000)


def test_a_real_turn_survives_merging():
    merged = S._merge([S.Turn(0, 4000, 1, 0.9), S.Turn(4000, 8000, 2, 0.9)], S.MIN_TURN_MS)
    assert [t.track_id for t in merged] == [1, 2]


def test_speech_mask_takes_its_threshold_from_the_clip():
    """A quiet room and a loud studio share no absolute level."""
    quiet = [(ms, 5.0 if ms < 3000 else 50.0) for ms in range(0, 6000, 100)]
    _, mask = S._speech_mask(quiet)
    assert not mask[:30].any() and mask[30:].all()
    studio = [(ms, 900.0 if ms < 3000 else 9000.0) for ms in range(0, 6000, 100)]
    _, mask2 = S._speech_mask(studio)
    assert not mask2[:30].any() and mask2[30:].all()


def test_a_clip_that_never_pauses_is_speech_throughout():
    """Someone talking without a breath. Splitting a level signal at a
    percentile would invent pauses that are not there — and the mouth
    measured "during the silence" would really be measured mid-sentence."""
    _, mask = S._speech_mask([(ms, 9000.0) for ms in range(0, 6000, 100)])
    assert mask.all()


def test_a_clip_that_is_only_room_tone_is_silence_throughout():
    _, mask = S._speech_mask([(ms, 8.0) for ms in range(0, 6000, 100)])
    assert not mask.any()


def test_a_continuous_talker_is_still_found():
    """Their quiet moments cannot supply a noise floor, because there are
    none; taking one from their own low percentile removes the signal."""
    nonstop = track(1, 0.3, motion=talking((0, 8000)))
    quiet_one = track(2, 0.7, motion=still)
    out = S.turns([nonstop, quiet_one], loud((0, 8000)))
    assert 1 in {t.track_id for t in out if t.reason == "speaking"}


def test_no_tracks_means_no_claims():
    assert S.turns([], loud((0, 3000))) == []
    assert S.turns([track(1, 0.3, motion=still)], []) == []


def test_speaker_at_finds_the_covering_turn():
    out = [S.Turn(0, 3000, 1, 0.9), S.Turn(3000, 6000, 2, 0.8)]
    assert S.speaker_at(out, 1500).track_id == 1
    assert S.speaker_at(out, 4000).track_id == 2
    assert S.speaker_at(out, 9000) is None


def test_a_track_reports_where_it_was_and_when_it_was_seen():
    t = track(1, 0.3, motion=still, span_ms=4000)
    assert t.box_at(1000)[0] == pytest.approx(0.3)
    assert t.visible_at(1000)
    assert not t.visible_at(99000)


def test_linking_keeps_one_person_as_one_track():
    tracks: list[S.FaceTrack] = []
    for ms in range(0, 3000, 500):                      # a face drifting slowly
        S._link(tracks, [(0.30 + ms / 60000, 0.5, 0.1, 0.25)], ms)
    assert len(tracks) == 1
    assert len(tracks[0].boxes) == 6


def test_linking_separates_two_people():
    tracks: list[S.FaceTrack] = []
    for ms in range(0, 3000, 500):
        S._link(tracks, [(0.25, 0.5, 0.1, 0.25), (0.75, 0.5, 0.1, 0.25)], ms)
    assert len(tracks) == 2
    assert sorted(t.boxes[0][1][0] for t in tracks) == [0.25, 0.75]


def test_a_head_turning_away_does_not_become_a_new_person():
    """Detection drops for a moment; the same person must come back as themselves."""
    tracks: list[S.FaceTrack] = []
    S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], 0)
    S._link(tracks, [], 500)                            # face lost
    S._link(tracks, [], 1000)
    S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], 1200)      # and found again
    assert len(tracks) == 1


# --- aiming the crop at the speaker -------------------------------------

def test_focus_aims_at_whoever_is_talking():
    left = track(1, 0.25, motion=still)
    right = track(2, 0.75, motion=still)
    turns_ = [S.Turn(0, 3000, 1, 0.9), S.Turn(3000, 6000, 2, 0.9)]
    aimed = dict(S.focus([left, right], turns_, fallback=[(0, 0.5)]))
    assert aimed[1000] == pytest.approx(0.25)
    assert aimed[4000] == pytest.approx(0.75)


def test_focus_holds_on_a_speaker_who_turns_away():
    """The face stops being detected; the person has not gone anywhere.

    This is the frame that started all of this: the crop must stay on the
    speaker rather than wander to whoever happens to be facing the camera.
    """
    speaking = S.FaceTrack(id=1)
    for ms in range(0, 1500, 500):                 # seen only at the start
        speaking.boxes.append((ms, (0.25, 0.5, 0.1, 0.25)))
    listener = track(2, 0.75, motion=still)        # visible throughout
    turns_ = [S.Turn(0, 6000, 1, 0.9)]             # but track 1 holds the floor
    aimed = dict(S.focus([speaking, listener], turns_, fallback=[(0, 0.75)]))
    assert aimed[5000] == pytest.approx(0.25)      # still on the speaker


def test_focus_falls_back_when_nobody_can_be_named():
    left = track(1, 0.25, motion=still)
    unclear = [S.Turn(0, 6000, None, 0.0, "overlap")]
    assert S.focus([left], unclear, fallback=[(0, 0.5)]) == [(0, 0.5)]
    assert S.focus([], [], fallback=[(0, 0.5)]) == [(0, 0.5)]


def test_panel_time_totals_each_side_of_the_join():
    left = track(1, 0.25, motion=still)
    right = track(2, 0.75, motion=still)
    turns_ = [S.Turn(0, 8000, 2, 0.9), S.Turn(8000, 10000, 1, 0.9)]
    held = S.panel_time([left, right], turns_, 0.5)
    assert held == {0: 2000, 1: 8000}


def test_one_feed_wins_when_it_carries_the_conversation():
    left = track(1, 0.25, motion=still)
    right = track(2, 0.75, motion=still)
    mostly_right = [S.Turn(0, 9000, 2, 0.9), S.Turn(9000, 10000, 1, 0.9)]
    assert S.dominant_panel([left, right], mostly_right, 0.5) == 1


def test_a_back_and_forth_needs_both_feeds():
    left = track(1, 0.25, motion=still)
    right = track(2, 0.75, motion=still)
    even = [S.Turn(0, 5000, 1, 0.9), S.Turn(5000, 10000, 2, 0.9)]
    assert S.dominant_panel([left, right], even, 0.5) is None


def test_no_named_speaker_means_no_dominant_feed():
    left = track(1, 0.25, motion=still)
    unclear = [S.Turn(0, 10000, None, 0.0, "unseen")]
    assert S.dominant_panel([left], unclear, 0.5) is None


# --- camera cuts ---------------------------------------------------------

def test_a_track_does_not_reach_across_a_cut():
    """The face standing in that spot after the cut is a different person."""
    tracks: list[S.FaceTrack] = []
    S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], 0)
    S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], 500)
    S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], 1000, since=1000)   # cut here
    assert len(tracks) == 2
    assert tracks[0].last_ms == 500
    assert tracks[1].first_ms == 1000


def test_linking_still_continues_a_track_when_there_was_no_cut():
    tracks: list[S.FaceTrack] = []
    for ms in (0, 500, 1000):
        S._link(tracks, [(0.3, 0.5, 0.1, 0.25)], ms, since=0)
    assert len(tracks) == 1
