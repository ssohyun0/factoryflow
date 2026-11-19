# ------------------------------------------------------------
# tests/test_db.py
# 역할 : DB 접속 준비 상태 단위 테스트 (MySQL 없이 실행).
# 실행 : docker exec erp-production-api-1 pytest -q
# 검사 : MySQL 8 로그인에 필요한 cryptography 패키지 설치 여부,
#        접속 실패가 500 이 아니라 503 DB_UNAVAILABLE 로 바뀌는지
# 배경 : T9 첫 실행에서 cryptography 가 없어 모든 DB 요청이 500(RuntimeError)으로 실패했다.
# ------------------------------------------------------------
import importlib.util

import pytest

from app import db
from app.responses import ApiError


def test_cryptography_is_installed_for_mysql8_auth():
    # MySQL 8 기본 로그인 방식(caching_sha2_password)은 비밀번호를 RSA 로 암호화해 보낸다
    assert importlib.util.find_spec("cryptography") is not None


@pytest.mark.parametrize("error", [RuntimeError("'cryptography' package is required"),
                                   db.pymysql.err.OperationalError(2003, "Can't connect")])
def test_connect_failure_becomes_503(monkeypatch, error):
    def fail(**kwargs):
        raise error
    monkeypatch.setattr(db.pymysql, "connect", fail)
    with pytest.raises(ApiError) as e:
        db.connect()
    assert e.value.status == 503 and e.value.code == "DB_UNAVAILABLE"
