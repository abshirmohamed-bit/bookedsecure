"""Media lives on local disk by default and on any S3-compatible bucket in production.

Everything the Engine returns is a public https URL, because Instagram, TikTok,
YouTube and X all fetch the file themselves.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .config import settings


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
