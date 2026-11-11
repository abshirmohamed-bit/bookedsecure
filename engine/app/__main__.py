"""Run the Engine: `python -m app`.

Not `uvicorn app.main:app`, for one reason. uvicorn's signal handler re-raises
the signal it caught on the way out, so the process reports "killed by
SIGTERM" and exits 143. That is right when Fly sent the signal. It is wrong
when the Engine decided to sleep: Fly reads a non-zero exit as a crash and
restarts the machine within seconds, so the machine would never actually
sleep and the bill would never change.

Owning the Server object here lets the idle watchdog ask for the same graceful
shutdown and exit 0, which Fly reads as "stopped on purpose".
"""
from __future__ import annotations

import os

import uvicorn

from . import idle
from .config import settings


def serve() -> None:
    server = uvicorn.Server(
        uvicorn.Config(
            "app.main:app",
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
            # Must outlast the worker's drain, which must outlast a render.
            timeout_graceful_shutdown=int(settings().shutdown_grace_s) + 30,
        )
    )
    idle.use_server(server)
    server.run()


if __name__ == "__main__":
    serve()
