"""On-screen cards (a tweet, a comment) are found and shown whole under the person."""
import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from app.pipeline import graphics, looks, shots  # noqa: E402
from app.pipeline import director  # noqa: E402


def _frame(card: bool = True, wall: bool = False):
    f = np.full((360, 640, 3), (60, 40, 30), np.uint8)
    if card:
        cv2.rectangle(f, (20, 210), (330, 320), (250, 250, 250), -1)
        for i, y in enumerate((240, 262, 284)):
            cv2.putText(f, "Does the air smell different" if i else "Mary R Kowal", (34, y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (20, 20, 20), 1, cv2.LINE_AA)
    if wall:
        cv2.rectangle(f, (380, 40), (620, 160), (245, 245, 245), -1)   # bright, but no text
    return f


def test_a_text_card_is_found():
    found = graphics._cards_in(_frame())
    assert len(found) == 1
    x, y, w, h = found[0]
    assert abs(x - 20 / 640) < 0.02 and abs(y - 210 / 360) < 0.03 and abs(w - 310 / 640) < 0.03


def test_a_blank_bright_panel_is_not_a_card():
    assert graphics._cards_in(_frame(card=False, wall=True)) == []


def test_spans_need_the_card_to_hold_still():
    box = (0.03, 0.58, 0.48, 0.3)
    seen = [(1000 + i * 500, [box] if 4 <= i < 12 else []) for i in range(20)]
    (a, b, got), = graphics.spans(seen, 1000, 11000)
    assert a == 2750 and b == 6750 and got == pytest.approx(box)
    # A flash shorter than the minimum is ignored.
    assert graphics.spans([(1000, [box]), (1500, [])], 1000, 3000) == []


def test_graphic_cards_keep_the_card_whole_and_the_person_above():
    person, card = looks.graphic_cards(1080, 1920, 900, 380)
    px, py, pw, ph = person
    gx, gy, gw, gh = card
    assert py + ph < gy                              # person above, a gap between
    assert abs(gw / gh - 900 / 380) < 0.02           # the card keeps its shape
    assert gh <= (1920 - 2 * looks.even(1080 * looks.DUO_MARGIN)) * looks.GRAPHIC_MAX + 2


def _inputs(cards):
    face = director.Person(1, [], 1.0)
    track = type("T", (), {})()
    track.id = 1
    track.boxes = [(ms, (0.6, 0.35, 0.12, 0.3)) for ms in range(0, 10000, 200)]
    del face
    return shots.Inputs(width=1920, height=1080, out_w=1080, out_h=1920, in_ms=0, out_ms=10000,
                        tracks=[track], cuts=[], detail=[], cards=cards)


def test_a_shot_with_a_card_becomes_person_over_card():
    box = (0.02, 0.6, 0.45, 0.25)
    seen = [(ms, [box] if 3000 <= ms < 8000 else []) for ms in range(0, 10000, 500)]
    plan = shots.plan(_inputs(seen))
    kinds = [(s.kind, s.start_ms, s.end_ms) for s in plan]
    graphic = [s for s in plan if s.kind == "graphic"]
    assert len(graphic) == 1, kinds
    g = graphic[0]
    assert 2500 <= g.start_ms <= 3000 and 7500 <= g.end_ms <= 8000
    # The person's crop stays off the card, which is drawn whole below.
    m, c = g.main, g.inset
    assert not (m.x < c.x + c.w and c.x < m.x + m.w and m.y < c.y + c.h and c.y < m.y + m.h)
    assert c.x <= 0.02 * 1920 and c.x + c.w >= 0.47 * 1920


def test_no_cards_no_graphic():
    assert all(s.kind != "graphic" for s in shots.plan(_inputs([])))
