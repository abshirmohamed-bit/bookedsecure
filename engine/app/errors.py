"""The contract's error envelope: { success:false, error:{ code, message } }."""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

CODES: dict[str, int] = {
    "INVALID_JSON": 400,
    "VALIDATION_ERROR": 400,
    "RIGHTS_REQUIRED": 400,
    "UNAUTHORIZED": 401,
    "NOT_FOUND": 404,
    "PAYLOAD_TOO_LARGE": 413,
    "FILE_TOO_LARGE": 413,
    "UNSUPPORTED_MEDIA_TYPE": 415,
    "STORAGE_LIMIT_EXCEEDED": 402,
    "RATE_LIMITED": 429,
    "JOB_LIMIT_REACHED": 429,
    "EXPORT_LIMIT_REACHED": 429,
    "CONCURRENT_REQUEST": 429,
    "ENGINE_BUSY": 503,
    "NOT_CONFIGURED": 503,
}


class EngineError(Exception):
    def __init__(self, code: str, message: str, retry_after: int | None = None):
        self.code = code
        self.message = message
        self.status = CODES.get(code, 400)
        self.retry_after = retry_after
        super().__init__(message)


def error_body(code: str, message: str) -> dict:
    return {"success": False, "error": {"code": code, "message": message}}


async def engine_error_handler(_: Request, exc: EngineError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status, headers=headers)
