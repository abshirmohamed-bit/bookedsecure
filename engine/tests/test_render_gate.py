"""How many exports render at once: as many as the machine has memory for."""
from __future__ import annotations

import threading
import time

from app.pipeline import render_gate as G


def test_a_4gb_machine_renders_one_at_a_time_and_8gb_two():
    assert G.capacity(3900) == 1
    assert G.capacity(7900) == 2
    assert G.capacity(1000) == 1                         # tiny: still one


def test_the_first_render_always_starts():
    assert G.room_for(1, used=0, cap=1, available_mb=10)
    assert G.room_for(2, used=0, cap=1, available_mb=None)


def test_a_further_render_needs_capacity_and_free_memory():
    assert not G.room_for(1, used=1, cap=1, available_mb=9000)    # 4 GB machine: one at a time
    assert G.room_for(1, used=1, cap=2, available_mb=2100)        # 1500 + 500 headroom
    assert not G.room_for(1, used=1, cap=2, available_mb=1800)    # something else is using it
    assert not G.room_for(1, used=1, cap=2, available_mb=None)    # can't tell: wait
    assert not G.room_for(2, used=1, cap=2, available_mb=9000)    # a 4K render weighs two


def test_the_gate_waits_and_lets_the_next_one_in(monkeypatch):
    monkeypatch.setattr(G, "capacity", lambda total_mb=None: 1)
    monkeypatch.setattr(G, "WAIT_S", 0.05)
    gate = G.Gate()
    gate.acquire()
    started = []

    def second():
        gate.acquire()
        started.append(time.monotonic())
        gate.release()

    t = threading.Thread(target=second)
    t.start()
    time.sleep(0.2)
    assert not started
    gate.release()
    t.join(2)
    assert started and gate.running == 0
