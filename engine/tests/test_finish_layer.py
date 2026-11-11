from pathlib import Path
from app.pipeline.compose import Render, build, _overlays

ASS = "[Script Info]\nPlayResX: 1080\nPlayResY: 1920\n[Events]\n"

def test_complete_finish_layer_replaces_old_overlays(tmp_path):
    r = Render(out=tmp_path / "out.mp4", source=Path("in.mp4"), out_ms=2000,
               framing_mode="center", words=[{"text": "old", "start_ms": 0, "end_ms": 1000}],
               title={"text": "Old title"}, watermark={"text": "Old handle"}, finish_ass=ASS)
    args, _ = build(r, tmp_path / "work")
    graph = args[args.index("-vf") + 1]
    assert "finish.ass" in graph
    assert "drawtext" not in graph
    assert "captions.ass" not in graph
    assert (tmp_path / "work" / "finish.ass").read_text() == ASS

def test_complex_layout_uses_same_finish_layer(tmp_path):
    r = Render(out=tmp_path / "out.mp4", source=Path("in.mp4"), out_ms=2000, finish_ass=ASS)
    chain = []
    assert _overlays(r, tmp_path, chain, 1080, 1920) == "finish"
    assert len(chain) == 1 and "finish.ass" in chain[0]

def test_old_projects_retain_native_overlay_path(tmp_path):
    r = Render(out=tmp_path / "out.mp4", source=Path("in.mp4"), out_ms=2000,
               framing_mode="center", title={"text": "Existing title"})
    args, _ = build(r, tmp_path / "work")
    assert "drawtext" in args[args.index("-vf") + 1]