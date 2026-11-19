# ------------------------------------------------------------
# tests/conftest.py — pytest 공통 준비물(fixture)
# 역할 : 실제 Redis 대신 메모리 가짜 저장소(FakeRedis)를 앱에 주입하고,
#        santa(ADMIN) / reindeer(WORKER) 로그인 상태를 흉내 내는 함수를 제공한다.
# 사용 : 테스트 함수의 매개변수에 store, client, login 을 적으면 pytest 가 넣어 준다.
# ------------------------------------------------------------
import pytest
from fastapi.testclient import TestClient

from app.config import SESSION_NAME
from app.main import app
from app.session import get_redis

# PHP 가 로그인 후 Redis 에 저장하는 값과 같은 형식 (한글은 UTF-8 바이트 길이: "산타" = 6)
SANTA_RAW = (
    'userId|i:1;username|s:5:"santa";displayName|s:6:"산타";'
    'role|s:5:"ADMIN";loginAt|s:19:"2026-11-19 10:00:00";'
).encode("utf-8")
REINDEER_RAW = (
    'userId|i:2;username|s:8:"reindeer";displayName|s:9:"루돌프";'
    'role|s:6:"WORKER";loginAt|s:19:"2026-11-19 10:00:00";'
).encode("utf-8")
SID = "abc123def456"


class FakeRedis:
    """테스트용 메모리 Redis. get / expire 만 흉내 내고, expire 호출을 기록한다."""

    def __init__(self):
        self.data: dict[str, bytes] = {}
        self.ttl: dict[str, int] = {}

    def get(self, key):
        return self.data.get(key)

    def expire(self, key, seconds):
        self.ttl[key] = seconds
        return key in self.data


@pytest.fixture
def store():
    """가짜 저장소를 앱에 주입하고, 테스트가 끝나면 원래대로 돌린다."""
    fake = FakeRedis()
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def login(store, client):
    """login("santa") 처럼 호출하면 해당 사용자의 세션을 만들고 쿠키를 붙인다."""

    def _login(who: str):
        store.data["session:" + SID] = SANTA_RAW if who == "santa" else REINDEER_RAW
        client.cookies.set(SESSION_NAME, SID)

    return _login
