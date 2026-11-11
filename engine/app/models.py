"""Tables. SQLite by default; the shapes mirror the API contract one-to-one."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Column, Text
from sqlmodel import JSON, Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Asset(SQLModel, table=True):
    __tablename__ = "assets"
    id: str = Field(primary_key=True)
    name: str = ""
    type: str = "video"           # video | audio | image | font | subtitles
    category: str = "asset"       # asset | clip | export | render | voiceover | music | sfx | broll | dub
    status: str = "importing"     # importing | ready | failed
    storage_key: str = ""
    mezzanine_key: str = ""
    thumb_key: str = ""
    length_s: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    size_bytes: int = 0
    source_url: str = ""
    rights_confirmed: bool = False
    quality_warning: bool = False
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = None


class ImportTask(SQLModel, table=True):
    __tablename__ = "import_tasks"
    asset_id: str = Field(primary_key=True)
    status: str = "queued"
    attempts: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class Upload(SQLModel, table=True):
    __tablename__ = "uploads"
    id: str = Field(primary_key=True)
    filename: str = ""
    content_type: str = ""
    size_bytes: int = 0
    storage_key: str = ""
    status: str = "pending"       # pending | completed | expired
    created_at: datetime = Field(default_factory=utcnow)


class Transcript(SQLModel, table=True):
    __tablename__ = "transcripts"
    id: str = Field(primary_key=True)
    asset_id: str = Field(index=True)
    status: str = "queued"        # queued | processing | ready | failed
    language: str = ""
    model: str = ""
    words: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    sentences: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    error: str = ""
    processing_s: float = 0.0
    created_at: datetime = Field(default_factory=utcnow)


class Job(SQLModel, table=True):
    """An AutoClip run."""
    __tablename__ = "autoclip_jobs"
    id: str = Field(primary_key=True)
    asset_id: str = Field(index=True)
    params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: str = "queued"        # queued | processing | awaiting_confirmation | completed | failed
    stage: str = ""               # transcribing | finding | cutting | framing | captioning | finalizing
    progress: int = 0
    suggested_count: Optional[int] = None
    skipped: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    error: str = ""
    processing_s: float = 0.0
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    """One clip, editable until it is exported."""
    __tablename__ = "projects"
    id: str = Field(primary_key=True)
    asset_id: str = Field(index=True)
    job_id: str = Field(default="", index=True)
    index: int = 0
    in_ms: int = 0
    out_ms: int = 0
    aspect: str = "9:16"
    layout: str = "full-video"
    title: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    framing: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    caption_style_id: str = "bold_white"
    caption_options: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    captions: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    watermark: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    edits: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    background: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    broll_asset_id: str = ""
    music_asset_id: str = ""
    score: float = 0.0
    grades: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    scene_analysis: str = Field(default="", sa_column=Column(Text))
    reason: str = Field(default="", sa_column=Column(Text))
    alternate_of: str = ""
    faces: list[Any] = Field(default_factory=list, sa_column=Column(JSON))
    preview_key: str = ""
    thumb_key: str = ""
    updated_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = None


class Export(SQLModel, table=True):
    __tablename__ = "exports"
    id: str = Field(primary_key=True)
    project_id: str = Field(index=True)
    status: str = "queued"        # queued | processing | completed | failed
    progress: int = 0
    resolution: str = "1080p"
    asset_id: str = ""
    error: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class WebhookEvent(SQLModel, table=True):
    __tablename__ = "webhook_events"
    id: str = Field(primary_key=True)
    event: str = ""
    data: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    attempts: int = 0
    delivered_at: Optional[datetime] = None
    last_status: str = ""
    next_attempt_at: datetime = Field(default_factory=utcnow)
    created_at: datetime = Field(default_factory=utcnow)
