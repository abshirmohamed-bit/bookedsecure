"""Prefixed, sortable ids so a row's kind is obvious in a log line."""
from __future__ import annotations

import secrets
import time

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"


def new_id(prefix: str) -> str:
    ms = int(time.time() * 1000)
    stamp = ""
    for _ in range(10):
        ms, rem = divmod(ms, 32)
        stamp = _ALPHABET[rem] + stamp
    rand = "".join(secrets.choice(_ALPHABET) for _ in range(12))
    return f"{prefix}_{stamp}{rand}"
