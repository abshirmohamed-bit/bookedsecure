"""One response shape for the whole Engine.

Every success carries `success: true` with the payload's own fields beside it,
never nested under a wrapper key — the app reads `r.data.url`, not
`r.data.asset.url`. Failures come back as {success: false, error: {code, message}}
from app.errors. Collections keep their plural key ("assets": [...]) because the
list itself is the field.
"""
from __future__ import annotations

from typing import Any


def ok(payload: dict[str, Any] | None = None, **extra: Any) -> dict[str, Any]:
    """{"success": True} merged with the payload's fields."""
    out: dict[str, Any] = {"success": True}
    if payload:
        out.update(payload)
    out.update(extra)
    return out
