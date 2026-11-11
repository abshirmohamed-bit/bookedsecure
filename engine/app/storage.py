"""Media lives on local disk by default and on any S3-compatible bucket in production.

Everything the Engine returns is a public https URL, because Instagram, TikTok,
YouTube and X all fetch the file themselves.
"""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from .config import settings

log = logging.getLogger("engine.storage")
SWEEP_EVERY_S = 3600.0
_last_sweep: float | None = None


def _local_path(key: str) -> Path:
    p = settings().media_root / key
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def put_file(src: Path, key: str, content_type: str = "application/octet-stream") -> str:
    s = settings()
    if s.storage_backend == "s3":
        import boto3  # imported lazily so local installs need no AWS deps

        client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint or None,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
        )
        client.upload_file(str(src), s.s3_bucket, key, ExtraArgs={"ContentType": content_type})
    else:
        dest = _local_path(key)
        if Path(src).resolve() != dest.resolve():
            shutil.copy2(src, dest)
    return public_url(key)


def open_write(key: str) -> Path:
    """A local path to stream bytes into; call put_file afterwards for s3."""
    return _local_path(key)


def local_path(key: str) -> Path:
    """Where a key is on disk. For s3 the file is pulled down on first use."""
    s = settings()
    p = settings().media_root / key
    if s.storage_backend == "s3" and not p.exists():
        import boto3

        p.parent.mkdir(parents=True, exist_ok=True)
        client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint or None,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
        )
        client.download_file(s.s3_bucket, key, str(p))
    return p


def public_url(key: str) -> str:
    s = settings()
    if s.storage_backend == "s3":
        base = (s.s3_public_base_url or f"{s.s3_endpoint}/{s.s3_bucket}").rstrip("/")
        return f"{base}/{key}"
    return f"{s.public_base_url.rstrip('/')}/media/{key}"


def delete(key: str) -> None:
    s = settings()
    if s.storage_backend == "s3":
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint or None,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
        )
        client.delete_object(Bucket=s.s3_bucket, Key=key)
    p = settings().media_root / key
    if p.exists():
        p.unlink()


def usage_bytes() -> int:
    root = settings().media_root
    return sum(f.stat().st_size for f in root.rglob("*") if f.is_file())


def sweep_local(now: float | None = None) -> int:
    """Free the volume: leftover render folders, and cached media once it is in the bucket."""
    s = settings()
    cutoff = (now if now is not None else time.time()) - s.local_cache_days * 86400
    removed = 0
    work = s.data_dir / "work"
    if work.is_dir():
        for folder in work.iterdir():
            if folder.is_dir() and folder.stat().st_mtime < cutoff:
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
    if s.storage_backend == "s3" and s.media_root.is_dir():
        for path in s.media_root.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
    return removed


def sweep_if_due() -> int:
    """At most hourly. Called between worker steps, so no render is ever underneath it."""
    global _last_sweep
    if _last_sweep is not None and time.monotonic() - _last_sweep < SWEEP_EVERY_S:
        return 0
    _last_sweep = time.monotonic()
    removed = sweep_local()
    if removed:
        log.info("cleared %d old local item(s)", removed)
    return removed
