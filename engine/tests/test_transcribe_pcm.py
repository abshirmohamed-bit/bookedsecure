"""Exercise the production Whisper adapter without loading model weights."""
import sys
import wave
from types import SimpleNamespace

import numpy as np

from app.pipeline import transcribe as mod


def test_whisper_receives_normalized_pcm_instead_of_pyav_path(tmp_path, monkeypatch):
    audio = tmp_path / "speech.wav"
    with wave.open(str(audio), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(np.array([-32768, 0, 16384], dtype="<i2").tobytes())
    seen = {}

    class Model:
        def __init__(self, *args, **kwargs):
            pass
        def transcribe(self, samples, **kwargs):
            seen["samples"] = samples
            seen["language"] = kwargs["language"]
            word = SimpleNamespace(word="hello", start=0, end=0.1, probability=0.9)
            return [SimpleNamespace(words=[word])], SimpleNamespace(language="en")

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=Model))
    monkeypatch.setattr(mod, "_model_cache", {})
    from app.config import settings
    monkeypatch.setattr(settings(), "whisper_device", "cpu")
    result = mod._faster_whisper(audio, [], "en-US")
    assert seen["language"] == "en"
    np.testing.assert_array_equal(seen["samples"], np.array([-1.0, 0.0, 0.5], dtype=np.float32))
    assert result.words[0].text == "hello"
    assert result.words[0].end_ms == 100

def test_groq_is_used_when_a_key_is_set_and_words_come_back_with_timings(monkeypatch, tmp_path):
    """The hosted path: word timings arrive in the response, not from DTW."""
    import httpx

    from app import config
    from app.pipeline import transcribe as tr

    config.settings.cache_clear()
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("TRANSCRIBE_PROVIDER", "auto")
    assert config.settings().resolve_transcriber() == "groq"

    class Reply:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"language": "en", "words": [
                {"word": "hello", "start": 0.0, "end": 0.42},
                {"word": "there.", "start": 0.42, "end": 0.90},
            ]}

    seen = {}

    def fake_post(url, **kw):
        seen["url"] = url
        seen["data"] = kw.get("data")
        return Reply()

    monkeypatch.setattr(httpx, "post", fake_post)
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")

    out = tr.transcribe(audio, 1.0)
    assert out.model.startswith("groq/")
    assert [w.text for w in out.words] == ["hello", "there."]
    assert out.words[1].start_ms == 420 and out.words[1].end_ms == 900
    assert seen["data"]["timestamp_granularities[]"] == "word"
    config.settings.cache_clear()


def test_groq_failing_on_auto_falls_back_to_this_machine(monkeypatch, tmp_path):
    """A rate limit should slow a job down, never stop it."""
    import httpx

    from app import config
    from app.pipeline import transcribe as tr

    config.settings.cache_clear()
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("TRANSCRIBE_PROVIDER", "auto")

    def boom(url, **kw):
        raise httpx.ConnectError("groq is down")

    monkeypatch.setattr(httpx, "post", boom)
    called = {}

    def local(audio, vocabulary, language):
        called["yes"] = True
        return tr.Transcription("en", "faster-whisper/small", [], [])

    monkeypatch.setattr(tr, "_faster_whisper", local)
    tr.transcribe(tmp_path / "a.wav", 1.0)
    assert called.get("yes") is True
    config.settings.cache_clear()
