"""The crayZmundo Engine.

One service: it takes a long video and gives back finished vertical clips.
Base44 talks to it through engineClient and gets told about progress by signed
webhooks, so the app never has to sit and wait.
"""
from __future__ import annotations

import json
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import idle, worker
from .auth import check_key, check_rate, tier_for
from .config import settings
from .db import engine
from .errors import EngineError, engine_error_handler, error_body
from .routers import assets, clips, core

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("engine")

OPEN_PATHS = {"/v1/health", "/docs", "/openapi.json", "/redoc"}
MAX_BODY = 512 * 1024
# The file itself comes straight from the browser, which never holds the API
# key. The id is unguessable and only issued to an authenticated caller.
UPLOAD_BYTES = re.compile(r"/v1/uploads/[A-Za-z0-9_]+/bytes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    problems = settings().secret_problems()
    if problems:
        raise RuntimeError(" ".join(problems) + " Run `make keygen` for real values, or set ALLOW_DEV_SECRETS=1 locally.")
    engine()                      # create tables
    worker.recover_stuck()        # a deploy or a crash leaves work half done
    worker.start()
    sleep_after = settings().idle_shutdown_s
    log.info("engine ready: storage=%s transcribe=%s finder=%s sleep_after=%s",
             settings().storage_backend, settings().transcribe_provider, settings().resolve_finder(),
             f"{sleep_after:.0f}s" if sleep_after > 0 else "never")
    yield
    worker.stop()


app = FastAPI(title="crayZmundo Engine", version="0.1.0", lifespan=lifespan)
app.add_exception_handler(EngineError, engine_error_handler)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return JSONResponse(error_body("VALIDATION_ERROR", str(exc)[:300]), status_code=500)


@app.middleware("http")
async def gate(request: Request, call_next):
    path = request.url.path
    # Health checks must not count: Fly pings /v1/health every 30 seconds and
    # the machine would never be allowed to sleep.
    if idle.counts(path):
        idle.touch()
    if path.startswith("/media/") or path in OPEN_PATHS or (request.method == "PUT" and UPLOAD_BYTES.fullmatch(path)):
        return await call_next(request)
    try:
        key = check_key(request)
        tier = tier_for(path, request.method)
        # media never travels in a JSON body; the raw upload route is exempt
        if not path.endswith("/bytes"):
            length = int(request.headers.get("content-length") or 0)
            if length > MAX_BODY:
                raise EngineError("PAYLOAD_TOO_LARGE", "Send media through the upload endpoints, not in JSON.")
        limit, remaining, reset = check_rate(key, tier)
    except EngineError as e:
        return await engine_error_handler(request, e)

    response = await call_next(request)
    response.headers["RateLimit-Limit"] = str(limit)
    response.headers["RateLimit-Remaining"] = str(remaining)
    response.headers["RateLimit-Reset"] = str(reset)
    return response


app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["PUT"], allow_headers=["content-type"])

app.include_router(core.router)
app.include_router(assets.router)
app.include_router(clips.router)

# Local storage is served by this process so every media URL is public, exactly
# as the platforms need. With s3 the bucket serves them and this is unused.
settings().media_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(settings().media_root)), name="media")
