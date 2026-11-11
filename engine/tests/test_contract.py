"""The HTTP contract Base44 codes against."""
from __future__ import annotations


def test_health_is_open(api):
    r = api.get("/v1/health", headers={"authorization": ""})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_key_is_required(api):
    r = api.get("/v1/account", headers={"authorization": ""})
    assert r.status_code == 401
    assert r.json() == {"success": False, "error": {"code": "UNAUTHORIZED",
                                                    "message": "Send an Authorization: Bearer <key> header."}}


def test_rate_limit_headers_present(api):
    r = api.get("/v1/account")
    assert r.status_code == 200
    assert int(r.headers["RateLimit-Remaining"]) >= 0
    assert int(r.headers["RateLimit-Limit"]) > 0


def test_unknown_id_is_a_clean_404(api):
    body = api.get("/v1/assets/ast_missing").json()
    assert body["success"] is False and body["error"]["code"] == "NOT_FOUND"


def test_validation_names_the_field(api, uploaded_asset):
    r = api.post("/v1/autoclip", json={"asset_id": uploaded_asset, "coverage": "sideways"})
    assert r.status_code == 400
    assert "coverage" in r.json()["error"]["message"]


def test_subtitle_styles_catalog(api):
    styles = api.get("/v1/subtitle-styles").json()["styles"]
    assert len(styles) == 20
    assert {"id", "name", "font", "defaults"} <= set(styles[0])


def test_work_interrupted_by_a_deploy_goes_back_in_the_queue():
    """A machine can die mid-render; nothing should sit in "processing" forever."""
    from sqlmodel import select

    from app import worker
    from app.db import session
    from app.ids import new_id
    from app.models import Export, Job

    with session() as s:
        s.add(Job(id=new_id("job"), asset_id="ast_x", status="processing", progress=55))
        s.add(Export(id=new_id("exp"), project_id="prj_x", status="processing", progress=40))
        s.commit()

    assert worker.recover_stuck() >= 2

    with session() as s:
        assert not s.exec(select(Job).where(Job.status == "processing")).all()
        assert not s.exec(select(Export).where(Export.status == "processing")).all()


def test_a_bucket_in_the_environment_switches_storage_on_by_itself(monkeypatch):
    """`fly storage create` sets these names; the Engine should need no more wiring."""
    from app.config import Settings

    monkeypatch.setenv("BUCKET_NAME", "crayz-media")
    monkeypatch.setenv("AWS_ENDPOINT_URL_S3", "https://t3.storage.dev")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    s = Settings()
    s._adopt_fly_storage()
    assert s.storage_backend == "s3"
    assert (s.s3_bucket, s.s3_endpoint, s.s3_access_key) == (
        "crayz-media", "https://t3.storage.dev", "key")


def test_without_a_bucket_storage_stays_local(monkeypatch):
    from app.config import Settings

    for k in ("BUCKET_NAME", "AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(k, raising=False)
    s = Settings()
    s._adopt_fly_storage()
    assert s.storage_backend == "local"


def test_health_names_the_build_that_is_answering():
    """Which build is live had to be guessed from behaviour; a deploy that
    forgot to happen looks exactly like a change that did not work."""
    import os

    from app.routers.core import _build_id

    was = {k: os.environ.get(k) for k in ("GIT_SHA", "FLY_IMAGE_REF")}
    try:
        os.environ.pop("GIT_SHA", None)
        os.environ["FLY_IMAGE_REF"] = "registry.fly.io/app:deployment-01ABC"
        assert _build_id() == "deployment-01ABC"
        os.environ["GIT_SHA"] = "abcdef1234567890"
        assert _build_id() == "abcdef123456"        # a real commit wins
        os.environ.pop("GIT_SHA")
        os.environ.pop("FLY_IMAGE_REF")
        assert _build_id() == "unknown"             # and never blows up
    finally:
        for k, v in was.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
