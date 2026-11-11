"""A browser sends a file straight to the Engine without ever holding the API key."""
from fastapi.testclient import TestClient

from app.main import app


def anonymous() -> TestClient:
    return TestClient(app)


def reserve(api) -> str:
    return api.post("/v1/uploads", json={"filename": "a.mp4", "content_type": "video/mp4", "size_bytes": 3}).json()["id"]


def test_a_reserved_upload_accepts_bytes_without_the_key(api):
    upload_id = reserve(api)
    r = anonymous().put(f"/v1/uploads/{upload_id}/bytes", content=b"abc", headers={"content-type": "video/mp4"})
    assert r.status_code == 200
    assert r.json()["bytes"] == 3


def test_an_unknown_upload_is_refused(api):
    assert anonymous().put("/v1/uploads/upl_nope/bytes", content=b"abc").status_code == 404


def test_every_other_upload_route_still_needs_the_key(api):
    upload_id = reserve(api)
    client = anonymous()
    assert client.post("/v1/uploads", json={"filename": "a", "content_type": "video/mp4", "size_bytes": 1}).status_code == 401
    assert client.post(f"/v1/uploads/{upload_id}/complete").status_code == 401
    assert client.get(f"/v1/uploads/{upload_id}").status_code == 401


def test_a_finished_upload_cannot_be_overwritten(api):
    from app.db import session
    from app.models import Upload

    upload_id = reserve(api)
    with session() as s:
        row = s.get(Upload, upload_id)
        row.status = "completed"
        s.add(row)
        s.commit()
    assert anonymous().put(f"/v1/uploads/{upload_id}/bytes", content=b"abc").status_code == 400


def test_a_browser_may_send_the_preflight(api):
    r = anonymous().options("/v1/uploads/upl_x/bytes", headers={
        "origin": "https://bookedsecure.com", "access-control-request-method": "PUT", "access-control-request-headers": "content-type",
    })
    assert r.status_code == 200
    assert "PUT" in r.headers["access-control-allow-methods"]


def test_asking_about_an_upload_finds_nothing_before_it_completes(api):
    assert api.get(f"/v1/uploads/{reserve(api)}").json()["asset"] is None
