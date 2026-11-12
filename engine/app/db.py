from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import settings

_engine = None


def engine():
    global _engine
    if _engine is None:
        url = f"sqlite:///{settings().data_dir / 'engine.db'}"
        # timeout: wait up to 30s for another writer instead of failing at once.
        _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
        event.listen(_engine, "connect", _pragmas)
        SQLModel.metadata.create_all(_engine)
        _add_missing_columns(_engine)
    return _engine


#: Columns added after a table first shipped. create_all makes new tables
#: only, so an existing database gains these on boot.
_ADDED_COLUMNS = {
    "assets": {"lean": "BOOLEAN NOT NULL DEFAULT 0",
               "parent_id": "VARCHAR NOT NULL DEFAULT ''",
               "offset_ms": "INTEGER NOT NULL DEFAULT 0"},
}


def _add_missing_columns(eng) -> None:
    with eng.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            have = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, ddl in columns.items():
                if name not in have:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def _pragmas(conn, _record) -> None:
    """Imports, jobs, exports and requests write from their own threads.

    WAL lets readers carry on while one of them writes, and the busy timeout
    makes a second writer wait its turn rather than raise "database is locked".
    """
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


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
