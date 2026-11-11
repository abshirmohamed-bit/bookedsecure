"""Every knob the Engine has, read from the environment once."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


#: How to reach a provider from the shape of its key, so pasting one key is
#: usually all it takes. Longest prefixes first: "sk-or-" is also "sk-".
KEY_SHAPES: tuple[tuple[str, str, str, str], ...] = (
    ("ci_live_", "https://api.cheaperinference.com/v1", "openai", "gpt-5.6-luna"),
    ("sk-ant-", "https://api.anthropic.com", "anthropic", "claude-sonnet-4-5"),
    ("sk-or-", "https://openrouter.ai/api/v1", "openai", "openai/gpt-4o-mini"),
    ("gsk_", "https://api.groq.com/openai/v1", "openai", "openai/gpt-oss-20b"),
    ("sk-", "https://api.openai.com/v1", "openai", "gpt-4o-mini"),
)


# The defaults below and the placeholders in .env.example are public.
WELL_KNOWN_SECRETS = {"dev-key", "dev-secret", "change-me-to-a-long-random-string", "change-me-too"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # auth: comma separated so keys can be rotated without downtime
    engine_api_keys: str = "dev-key"

    # webhooks
    webhook_url: str = ""
    webhook_secret: str = "dev-secret"

    # storage
    storage_backend: str = "local"  # local | s3
    data_dir: Path = Path("./data")
    public_base_url: str = "http://localhost:8080"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_public_base_url: str = ""
    # Fly's `fly storage create` sets these names; read them so Tigris needs no
    # extra wiring, and so the same image works on any S3-compatible host.
    bucket_name: str = ""
    aws_endpoint_url_s3: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # Stop the machine once it has been this many seconds without a request
    # and has nothing in flight; Fly starts it again on the next one, so an
    # Engine used an hour a day is billed for an hour a day.
    #
    # Off by default so `uvicorn app.main:app` in development never walks out
    # mid-session. fly.toml turns it on, because that is where paying for a
    # machine is decided. Keep it well above how long a page sits open idle.
    idle_shutdown_s: float = 0.0

    # How long to let an in-flight render finish when asked to shut down.
    # Fly sends SIGTERM then SIGKILL after kill_timeout; keep this under it.
    shutdown_grace_s: float = 120.0
    # 0 means "use every core this machine has". A fixed number here caps the
    # work no matter how large the machine is, so scaling up buys nothing.
    processing_threads: int = 0

    def worker_threads(self) -> int:
        """How many threads the heavy work may use: ffmpeg, OpenCV, Whisper."""
        import os

        cores = os.cpu_count() or 2
        return max(1, min(cores, self.processing_threads or cores))

    # transcription
    #   auto           — Groq when a key is set, this machine otherwise
    #   groq           — always Groq, and fail loudly if it is unreachable
    #   faster-whisper — always this machine
    #   fake           — deterministic, for the test suite
    transcribe_provider: str = "auto"
    whisper_model: str = "small"
    whisper_device: str = "auto"
    # Groq runs Whisper on their hardware at a couple of hundred times real
    # time. Without a key nothing changes and the local model is used.
    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3-turbo"
    groq_timeout_s: float = 180.0

    def resolve_transcriber(self) -> str:
        """The provider actually used, once the key situation is known."""
        if self.transcribe_provider != "auto":
            return self.transcribe_provider
        return "groq" if self.groq_api_key else "faster-whisper"

    # moment finding
    # Moment finding. "rules" needs no key and no network; anything else uses
    # whatever AI key is set. One key is enough — the host and a sensible model
    # are worked out from the key's shape, so most providers need nothing else.
    finder_provider: str = "ai"  # ai | rules
    ai_api_key: str = ""
    ai_base_url: str = ""   # only needed for a provider we cannot recognise
    ai_model: str = ""      # only needed to override the default for that host
    # The original Anthropic-only settings still work.
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-4-5"

    # limits
    max_upload_bytes: int = 4 * 1024**3
    # 0 means "no quota"; the app shows a bar only when a limit is set.
    storage_limit_bytes: int = 0
    # "ytdlp" reads real links; "fake" keeps tests offline.
    analyze_provider: str = "ytdlp"
    min_source_seconds: int = 10
    max_source_seconds: int = 10800
    concurrent_jobs: int = 3
    # Workers per queue, sized for a 2-CPU machine. Imports mostly wait on the
    # network; job stages mostly wait on Groq and the AI finder; renders are
    # the CPU-heavy part, and two at once keep one long export from holding
    # up everyone else's without thrashing two cores.
    # Off only in tests, which drive the queues themselves with worker.tick().
    worker_enabled: bool = True
    import_workers: int = 2
    job_workers: int = 2
    concurrent_renders: int = 2
    # ffmpeg processes at once, across every worker. Each one already uses
    # all the threads it is allowed (PROCESSING_THREADS).
    ffmpeg_slots: int = 2
    retention_days: int = 30
    # With object storage, the volume is only a cache: older local copies are
    # removed and fetched again if a later render needs them.
    local_cache_days: float = 2.0

    # test/dev
    engine_mock: bool = False
    # Local development only: start even with the well-known default secrets.
    allow_dev_secrets: bool = False

    def secret_problems(self) -> list[str]:
        """Why this configuration must not start. Empty when it is safe to."""
        if self.allow_dev_secrets:
            return []
        problems = []
        if not self.keys or self.keys & WELL_KNOWN_SECRETS:
            problems.append("ENGINE_API_KEYS is missing or still a well-known default.")
        if self.webhook_url and self.webhook_secret in WELL_KNOWN_SECRETS:
            problems.append("WEBHOOK_SECRET is still a well-known default.")
        return problems

    @property
    def keys(self) -> set[str]:
        return {k.strip() for k in self.engine_api_keys.split(",") if k.strip()}

    @property
    def media_root(self) -> Path:
        return self.data_dir / "media"

    def ai_target(self) -> tuple[str, str, str, str]:
        """(kind, base_url, model, key) for the finder. Empty kind means none.

        `kind` is "openai" for the chat-completions shape that nearly every
        provider speaks, or "anthropic" for its own messages API.
        """
        key = (self.ai_api_key or self.anthropic_api_key or "").strip()
        if not key:
            return ("", "", "", "")
        base = self.ai_base_url.strip().rstrip("/")
        model = self.ai_model.strip()
        kind = ""
        for prefix, host, shape, default_model in KEY_SHAPES:
            if key.startswith(prefix):
                kind, base, model = shape, base or host, model or default_model
                break
        if not kind:
            # Unrecognised key: assume the common shape, but we need an address.
            if not base:
                return ("", "", "", "")
            kind, model = "openai", model or "gpt-4o-mini"
        return (kind, base, model, key)

    def resolve_finder(self) -> str:
        """Without a key there is nothing to call, so fall back rather than fail."""
        if self.finder_provider == "rules":
            return "rules"
        return "ai" if self.ai_target()[0] else "rules"


    def _adopt_fly_storage(self) -> None:
        """A bucket in the environment means object storage, with no other config."""
        if not self.s3_bucket and self.bucket_name:
            self.s3_bucket = self.bucket_name
        if not self.s3_endpoint and self.aws_endpoint_url_s3:
            self.s3_endpoint = self.aws_endpoint_url_s3
        if not self.s3_access_key and self.aws_access_key_id:
            self.s3_access_key = self.aws_access_key_id
        if not self.s3_secret_key and self.aws_secret_access_key:
            self.s3_secret_key = self.aws_secret_access_key
        if self.s3_bucket and self.s3_access_key and self.storage_backend == "local":
            self.storage_backend = "s3"


@lru_cache
def settings() -> Settings:
    s = Settings()
    s._adopt_fly_storage()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.media_root.mkdir(parents=True, exist_ok=True)
    return s
