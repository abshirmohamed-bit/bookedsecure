from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlmodel import Session, SQLModel, create_engine

from .config import settings

_engine = None


def engine():
    global _engine
    if _engine is None:
        url = f"sqlite:///{settings().data_dir / 'engine.db'}"
        _engine = create_engine(url, connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(_engine)
    return _engine


@contextmanager
def session() -> Iterator[Session]:
    # expire_on_commit=False: rows stay readable after commit, so handlers can
    # build their response from the object they just saved.
    with Session(engine(), expire_on_commit=False) as s:
        yield s


def reset_engine() -> None:
    """Tests point DATA_DIR somewhere fresh and call this."""
    global _engine
    _engine = None
