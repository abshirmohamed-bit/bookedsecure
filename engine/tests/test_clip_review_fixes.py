"""Fixes from reviewing ten clips of a 24-minute interview series frame by frame.

Each test is one thing that went wrong there: the last third of the video
never clipped, the opening trailer clipped as a story, a question cut off the
front of its answer, the next guest's question left on the end, a one-man
clip split into a four-cell grid, a pull quote sliced at the crop's edge, a
headline running off both sides, captions on the speaker's chin.
"""
from __future__ import annotations

from app.pipeline import caption, compose, graphics
from app.pipeline import find as F
from app.pipeline import shots as P
from app.pipeline.speaker import FaceTrack


def s(start, end, text):
    return {"start_ms": start * 1000, "end_ms": end * 1000, "text": text}


# ---------------------------------------------------------------- the finder

def test_the_clip_count_is_shared_between_windows_by_length():
    w1 = [s(0, 1, "a"), s(1199, 1200, "b")]            # 0-20:00
    w2 = [s(1140, 1141, "c"), s(1478, 1479, "d")]      # 19:00-24:39
    shares = F.window_counts([w1, w2], 10)
    assert sum(shares) == 10 and shares[1] >= 2, shares


def test_overlapping_windows_never_pick_the_same_moment_twice():
    w1 = [s(0, 1, "a"), s(1199, 1200, "b")]
    w2 = [s(1140, 1141, "c"), s(1478, 1479, "d")]
    (a1, b1), (a2, b2) = F._owned_spans([w1, w2])
    assert a1 == 0 and b1 == a2 and 1140_000 < b1 < 1200_000 and b2 > 1478_000


def test_an_opening_trailer_cut_from_the_video_is_found():
    opening = [s(6, 9, "Islam shaped my marriage in a way where we just know the"),
               s(30, 34, "I became homeless after that and slept in the garage"),
               s(50, 54, "and I still feel it for eleven years now that hurts the most")]
    rest = [s(60 + i * 10, 68 + i * 10, f"filler sentence number {i} about something else entirely") for i in range(60)]
    later = [s(700, 704, "honestly Islam shaped my marriage in a way where we just know the rules"),
             s(900, 905, "so I became homeless after that and slept in the garage for weeks")]
    span = F.teaser_span(opening + rest + later)
    assert span == (6000, 34000)


def test_a_video_without_a_trailer_keeps_its_opening():
    sentences = [s(i * 10, i * 10 + 8, f"unique sentence number {i} with its own words") for i in range(70)]
    assert F.teaser_span(sentences) is None


def test_a_clip_starts_on_the_question_it_answers_and_stops_before_the_next():
    sentences = [
        s(236, 239, "Who has the most intimidating haka?"),
        s(244, 247, "The New Zealanders, man, I have to say."),
        s(248, 280, "Seeing the Tongan one in person was something else."),
        s(282, 288, "What was the hardest tradition you had to give up?"),
    ]
    m = F.Moment(244_000, 288_000, "haka", 80)
    out = F.frame_questions([m], sentences, 45_000)[0]
    assert out.start_ms == 236_000, "the question goes in"
    assert out.end_ms == 280_000, "the next guest's question stays out"


def test_a_rhetorical_question_mid_answer_is_left_alone():
    sentences = [s(0, 20, "So I asked myself, why would anyone do that?"), s(20, 40, "And then it clicked for me.")]
    m = F.Moment(0, 40_000, "x", 80)
    out = F.frame_questions([m], sentences, 40_000)[0]
    assert (out.start_ms, out.end_ms) == (0, 40_000)


def test_titles_never_guess_he_or_she_and_moments_carry_keywords():
    assert "never call a speaker he, she" in F.HOOK_RULES
    raw = '{"moments":[{"start":"00:10","end":"00:50","title":"x","score":90,"keywords":["homeless","Islam!","a","x y z","truth"]}]}'
    m = F.parse_moments(raw)[0]
    assert m.keywords == ["homeless", "Islam", "xyz"]


# ---------------------------------------------------------------- the picture

def track(tid, start, end, cx, w):
    t = FaceTrack(id=tid)
    for ms in range(start, end, 500):
        t.boxes.append((ms, (cx, 0.4, w, w * 1.3)))
    return t


def test_a_face_jumping_size_between_tracks_is_a_cut():
    wide = track(1, 0, 8000, 0.54, 0.11)
    close = track(2, 8500, 16000, 0.58, 0.18)
    from app.pipeline.speaker import handover_cuts
    assert handover_cuts([wide, close], []) == [8000]   # last box 7.5 s, next 8.5 s
    # A face lost and found again in the same place is not a cut.
    again = track(3, 8500, 16000, 0.54, 0.11)
    assert handover_cuts([wide, again], []) == []
    # Two people on screen together are not a cut either.
    other = track(4, 4000, 12000, 0.2, 0.18)
    assert handover_cuts([wide, other], []) == []


def test_a_dark_studio_on_one_side_is_not_a_bar():
    assert graphics.paired(0.0, 0.0, 0.0, 0.17) == (0.0, 0.0, 0.0, 0.0)
    assert graphics.paired(0.12, 0.12, 0.0, 0.0) == (0.12, 0.12, 0.0, 0.0)
    assert graphics.paired(0.037, 0.0, 0.125, 0.125) == (0.0, 0.0, 0.125, 0.125)


def test_a_moving_crop_is_held_off_text_it_left_out():
    shot = P.Shot(0, 1000, "fill", window=P.Box(830, 0, 600, 1080))
    shot.motion = [(0, 760.0, 0.0, 600.0, 1080.0)]     # drifted left over the quote's end
    P.keep_text_whole(shot, [(0.12, 0.26, 0.30, 0.08)], 1920)
    assert shot.motion[0][1] / 1920 >= 0.42 + P.TEXT_CLEAR - 1e-6


# ---------------------------------------------------------------- words on the clip

def test_a_headline_breaks_at_a_dash_and_capitals_are_sized_wider():
    lines = compose.wrap_title("HE BOUGHT HIS MUM A HOUSE—THEN STILL FELT EMPTY", 26, 3)
    assert lines[0].endswith("—") or all(len(l) <= 26 for l in lines)
    caps, _ = compose.title_lines("HE BOUGHT HIS MUM A HOUSE—THEN STILL FELT EMPTY", 1080, 1920)
    assert all(len(l) * 0.62 * 65 <= 1080 * 0.84 * 1.05 for l in caps)


def test_key_words_are_coloured_in_the_captions():
    style = next(st for st in caption.STYLES if st.id == "bold_white")
    words = [{"text": t, "start_ms": i * 300, "end_ms": i * 300 + 280} for i, t in enumerate("I became homeless after that".split())]
    ass = caption.build_ass(words, style, 1080, 1920, emphasis=["homeless"])
    assert "\\1c&H0AD6FF&}homeless" in ass
    assert caption.emphasised("Homelessness,", {"homeless"}) and not caption.emphasised("home", {"homeless"})


def test_captions_move_under_the_chin_in_a_close_up():
    face = FaceTrack(id=1, boxes=[(0, (0.5, 0.42, 0.18, 0.4)), (900, (0.5, 0.42, 0.18, 0.4))])
    inp = P.Inputs(width=1920, height=1080, out_w=1080, out_h=1920, in_ms=0, out_ms=1000, tracks=[face])
    shot = P.Shot(0, 1000, "fill", window=P.Box(656, 0, 608, 1080))
    P.place_captions([shot], inp)
    assert shot.caption_at is not None and shot.caption_at > 0.62
    assert P.caption_y(shot, inp) == shot.caption_at


# ---------------------------------------------------------------- question cards, insets, gestures

def test_a_question_asked_earlier_is_kept_only_when_it_was_really_said():
    sentences = [s(790, 794, "How did your family react to you taking your Shahadah?"),
                 s(800, 830, "My mum cried."), s(934, 940, "When I took my Shahadah I kept it quiet.")]
    m = F.Moment(934_000, 994_000, "x", 80, question="how did your family react to you taking your shahadah")
    assert F.verify_questions([m], sentences)[0].question == "How did your family react to you taking your Shahadah?"
    made_up = F.Moment(934_000, 994_000, "x", 80, question="What did your brother say about the mosque?")
    assert F.verify_questions([made_up], sentences)[0].question == ""


def test_the_question_card_opens_the_clip_and_the_headline_waits():
    r = compose.Render(source=__import__("pathlib").Path("x.mp4"), out=__import__("pathlib").Path("y.mp4"),
                       in_ms=0, out_ms=60_000, question="How did your family react to you taking your Shahadah?",
                       title={"text": "Her family rejected her", "enabled": True, "position": "auto"})
    q = compose.question_plan(r)
    assert q and 2500 <= q["until_ms"] <= 6000
    plan = compose.headline_plan(r, [], None)
    assert plan["from_ms"] == q["until_ms"]


def test_a_framed_picture_beside_the_speaker_is_found():
    import numpy as np
    frame = np.full((360, 640, 3), 10, np.uint8)
    frame[54:184, 73:212] = 255                                   # white border
    rng = np.random.default_rng(1)
    frame[58:180, 77:208] = rng.integers(0, 120, (122, 131, 3), dtype=np.uint8)   # footage inside
    found = graphics._framed_in(frame)
    assert len(found) == 1 and abs(found[0][0] - 73 / 640) < 0.01
    blank = np.full((360, 640, 3), 10, np.uint8)
    blank[54:184, 73:212] = 255
    blank[58:180, 77:208] = 30                                    # an empty panel is not a picture
    assert graphics._framed_in(blank) == []


def test_a_spread_gesture_eases_out_to_the_whole_picture_once():
    face = FaceTrack(id=1, boxes=[(ms, (0.6, 0.35, 0.1, 0.14)) for ms in range(0, 20_000, 500)])
    body = FaceTrack(id=2, boxes=[(ms, (0.6, 0.6, 0.55 if 8000 <= ms < 10_500 else 0.38, 0.7)) for ms in range(0, 20_000, 500)])
    inp = P.Inputs(width=1920, height=1080, out_w=1080, out_h=1920, in_ms=0, out_ms=20_000, tracks=[face], bodies=[body])
    shot = P.Shot(0, 20_000, "fill", window=P.Box(850, 0, 608, 1080))
    out = P.widen_for_gestures([shot], inp, "full-video")
    assert [x.kind for x in out] == ["fill", "fit", "fill"]
    assert out[1].start_ms <= 8000 and out[1].end_ms >= 10_000
    # Owner-chosen looks other than follow-the-speaker are left alone.
    assert P.widen_for_gestures([shot], inp, "split") == [shot]
