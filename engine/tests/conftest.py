import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Deterministic providers: the pipeline is proven without model weights or an API key.
os.environ.setdefault("TRANSCRIBE_PROVIDER", "fake")
os.environ.setdefault("FINDER_PROVIDER", "rules")
os.environ.setdefault("ENGINE_API_KEYS", "test-key")
os.environ.setdefault("MIN_SOURCE_SECONDS", "5")
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="engine-test-")


@pytest.fixture(scope="session")
def api():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        client.headers.update({"authorization": "Bearer test-key"})
        yield client


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """A 20s 1280x720 clip with a subject that moves, so tracking has real work."""
    out = tmp_path_factory.mktemp("media") / "talk.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=0x101014:s=1280x720:r=30:d=20",
        "-f", "lavfi", "-i", "color=c=0xE8E0D0:s=220x260:r=30:d=20",
        "-f", "lavfi", "-i", "sine=frequency=220:duration=20",
        "-filter_complex", "[0:v][1:v]overlay=x='60+50*t':y=200:shortest=1[v]",
        "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-t", "20", str(out),
    ], check=True)
    return out


@pytest.fixture(scope="session")
def uploaded_asset(api, sample_video) -> str:
    """Push the sample through the real upload flow and return its asset id."""
    start = api.post("/v1/uploads", json={
        "filename": sample_video.name, "content_type": "video/mp4",
        "size_bytes": sample_video.stat().st_size,
    }).json()
    api.put(f"/v1/uploads/{start['id']}/bytes", content=sample_video.read_bytes(),
            headers={"content-type": "video/mp4"})
    asset = api.post(f"/v1/uploads/{start['id']}/complete").json()
    return asset["id"]
