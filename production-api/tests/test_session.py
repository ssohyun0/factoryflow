# ------------------------------------------------------------
# tests/test_session.py
# 역할 : 공유 세션 조회(app/session.py)와 GET /api/production/session 단위 테스트.
#        실제 Redis 대신 메모리 가짜 저장소(tests/conftest.py 의 FakeRedis)를 쓴다.
# 실행 : docker exec erp-production-api-1 pytest -q
# 검사 : PHP 직렬화 해석(한글 바이트 길이 포함), 쿠키 없음 401, 만료·로그아웃 401,
#        빈 세션 401, 정상 세션 200 + TTL 연장, 역할 검사 403
# ------------------------------------------------------------
import pytest
from fastapi import Depends

from app.config import SESSION_NAME, SESSION_TTL
from app.main import app
from app.responses import ok
from app.session import PhpSessionDecodeError, SessionUser, decode_php_session, require_role
from tests.conftest import SANTA_RAW, SID


# 테스트 전용 경로: ADMIN 만 허용 (require_role 검사용)
@app.get("/api/production/_test/admin-only")
def _admin_only(user: SessionUser = Depends(require_role("ADMIN"))):
    return ok({"username": user.username})


# ---------- PHP 직렬화 해석 ----------

def test_decode_php_session_parses_int_and_korean_string():
    data = decode_php_session(SANTA_RAW)
    assert data == {
        "userId": 1,
        "username": "santa",
        "displayName": "산타",
        "role": "ADMIN",
        "loginAt": "2026-11-19 10:00:00",
    }


def test_decode_php_session_supports_bool_float_null():
    assert decode_php_session(b"a|b:1;b|d:1.5;c|N;") == {"a": True, "b": 1.5, "c": None}


def test_decode_php_session_empty_is_empty_dict():
    assert decode_php_session(b"") == {}


@pytest.mark.parametrize(
    "raw",
    [
        b'username|s:9:"santa";',   # 길이가 실제와 다름
        b"userId|i:abc;",           # 정수 아님
        b'list|a:1:{i:0;i:1;}',     # 배열은 지원하지 않음
        b"noBar",                   # | 없음
    ],
)
def test_decode_php_session_rejects_broken_input(raw):
    with pytest.raises(PhpSessionDecodeError):
        decode_php_session(raw)


# ---------- GET /api/production/session ----------

def test_session_without_cookie_is_401(store, client):
    res = client.get("/api/production/session")
    assert res.status_code == 401
    body = res.json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNAUTHORIZED"
    assert "servedBy" in body


def test_session_expired_or_logged_out_is_401(store, client):
    # Redis 에 키가 없음 = TTL 만료 또는 PHP 로그아웃으로 삭제됨
    client.cookies.set(SESSION_NAME, SID)
    res = client.get("/api/production/session")
    assert res.status_code == 401


def test_session_without_login_data_is_401(store, client):
    store.data["session:" + SID] = b'foo|s:3:"bar";'   # 로그인 정보가 없는 세션
    client.cookies.set(SESSION_NAME, SID)
    assert client.get("/api/production/session").status_code == 401


def test_session_with_invalid_cookie_format_is_401(store, client):
    client.cookies.set(SESSION_NAME, "../../etc*")
    assert client.get("/api/production/session").status_code == 401


def test_session_valid_returns_user_and_extends_ttl(store, client):
    store.data["session:" + SID] = SANTA_RAW
    client.cookies.set(SESSION_NAME, SID)
    res = client.get("/api/production/session")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["sessionId"] == SID
    assert body["data"]["username"] == "santa"
    assert body["data"]["displayName"] == "산타"
    assert body["data"]["role"] == "ADMIN"
    assert body["data"]["server"].startswith("Python")
    assert body["servedBy"]                              # 컨테이너 hostname
    assert store.ttl["session:" + SID] == SESSION_TTL     # 슬라이딩 만료


def test_require_role_forbids_other_role(store, client):
    reindeer_raw = SANTA_RAW.replace(b'role|s:5:"ADMIN"', b'role|s:6:"WORKER"')
    store.data["session:" + SID] = reindeer_raw
    client.cookies.set(SESSION_NAME, SID)
    res = client.get("/api/production/_test/admin-only")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_unknown_path_is_404_common_format(store, client):
    res = client.get("/api/production/nope")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"
