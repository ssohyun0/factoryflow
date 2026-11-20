# ------------------------------------------------------------
# app/session.py
# 역할 : 브라우저 쿠키(FFSESSID)로 Redis 에 저장된 공유 세션을 조회한다.
#        세션은 PHP(erp-inventory-api)가 로그인할 때 만든다. FastAPI 는 같은 Redis 키
#        (session:<세션ID>)를 읽고 PHP 기본 직렬화 문자열을 직접 해석한다.
#        그래서 PHP 에서 한 번 로그인하면 생산 서버 3개 모두 같은 사용자를 안다(이기종 세션 공유).
#
# PHP 세션 직렬화 형식 (session.serialize_handler = php)
#   이름|값이름|값...   예) userId|i:1;username|s:5:"santa";displayName|s:6:"산타";
#   i:<정수>;  s:<바이트 길이>:"<문자열>";  b:0|1;  d:<실수>;  N;
#   ※ s: 의 길이는 글자 수가 아니라 UTF-8 바이트 수다 ("산타" = 6바이트).
#
# 사용 : 라우터 함수가 Depends(get_current_user) 또는 Depends(require_role("ADMIN"))로 쓴다.
# 의존 : Redis(erp-redis), app/config.py
# ------------------------------------------------------------
import re
from dataclasses import asdict, dataclass

import redis
from fastapi import Depends, Request

from app.config import REDIS_HOST, REDIS_PORT, SESSION_KEY_PREFIX, SESSION_NAME, SESSION_TTL
from app.responses import ApiError

# PHP 가 만드는 세션 ID 형식 (영문·숫자·쉼표·하이픈). 이상한 값으로 임의의 Redis 키를 읽지 못하게 막는다
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9,-]{1,128}$")

# Redis 연결 풀 (컨테이너당 하나, 요청마다 새로 접속하지 않음)
# socket_timeout 2초: Redis 가 죽어 있어도 요청이 오래 멈추지 않게 한다 (PHP 의 접속 제한 2초와 같음)
_redis_client = redis.Redis(
    host=REDIS_HOST, port=REDIS_PORT, socket_connect_timeout=2, socket_timeout=2
)


@dataclass
class SessionUser:
    """로그인 사용자 정보. 필드는 PHP Session.php 의 $_SESSION 키와 같다."""

    session_id: str
    user_id: int
    username: str
    display_name: str
    role: str  # ADMIN(산타) | WORKER(루돌프)
    login_at: str

    def to_api(self) -> dict:
        """API 응답용 camelCase 딕셔너리 (PHP /api/inventory/session 응답과 같은 키)."""
        d = asdict(self)
        return {
            "sessionId": d["session_id"],
            "userId": d["user_id"],
            "username": d["username"],
            "displayName": d["display_name"],
            "role": d["role"],
            "loginAt": d["login_at"],
        }


class PhpSessionDecodeError(ValueError):
    """PHP 세션 문자열 형식이 올바르지 않을 때 발생한다."""


def decode_php_session(raw: bytes) -> dict:
    """PHP 기본 세션 직렬화 문자열을 딕셔너리로 바꾼다.

    Args:    raw — Redis 에서 읽은 값 (bytes). 예) b'userId|i:1;username|s:5:"santa";'
    Returns: {"userId": 1, "username": "santa", ...}
    Raises:  PhpSessionDecodeError — 형식이 잘못되었거나 지원하지 않는 타입(배열·객체)일 때

    ※ 문자열 길이가 UTF-8 바이트 수이므로, 디코딩하기 전에 bytes 상태로 잘라야 한글이 깨지지 않는다.
    """
    result: dict = {}
    pos = 0
    while pos < len(raw):
        bar = raw.find(b"|", pos)
        if bar == -1:
            raise PhpSessionDecodeError("변수 이름 뒤에 | 가 없습니다.")
        name = raw[pos:bar].decode("utf-8")
        value, pos = _decode_value(raw, bar + 1)
        result[name] = value
    return result


def _decode_value(raw: bytes, pos: int) -> tuple:
    """pos 위치의 값 하나를 해석한다.

    Returns: (값, 다음 변수가 시작하는 위치)
    Raises:  PhpSessionDecodeError
    """
    kind = raw[pos:pos + 2]
    if kind == b"N;":                                  # null
        return None, pos + 2
    if kind in (b"i:", b"b:", b"d:"):                  # 정수, 불리언, 실수: "<값>;" 까지
        end = raw.find(b";", pos)
        if end == -1:
            raise PhpSessionDecodeError("숫자 값 뒤에 ; 가 없습니다.")
        text = raw[pos + 2:end].decode("ascii")
        try:
            value = int(text) if kind == b"i:" else (text == "1" if kind == b"b:" else float(text))
        except ValueError as e:
            raise PhpSessionDecodeError(f"숫자 형식이 잘못되었습니다: {text}") from e
        return value, end + 1
    if kind == b"s:":                                  # 문자열: s:<바이트 길이>:"<내용>";
        colon = raw.find(b":", pos + 2)
        if colon == -1:
            raise PhpSessionDecodeError("문자열 길이 뒤에 : 가 없습니다.")
        try:
            length = int(raw[pos + 2:colon])
        except ValueError as e:
            raise PhpSessionDecodeError("문자열 길이가 숫자가 아닙니다.") from e
        start = colon + 2                              # :" 다음부터 내용
        end = start + length
        if raw[colon + 1:start] != b'"' or raw[end:end + 2] != b'";':
            raise PhpSessionDecodeError("문자열 따옴표 또는 길이가 맞지 않습니다.")
        return raw[start:end].decode("utf-8"), end + 2
    raise PhpSessionDecodeError(f"지원하지 않는 값 형식입니다: {kind!r}")


def get_redis() -> redis.Redis:
    """Redis 클라이언트를 돌려준다. 테스트에서는 dependency_overrides 로 가짜 저장소로 바꾼다."""
    return _redis_client


def get_current_user(request: Request, store: redis.Redis = Depends(get_redis)) -> SessionUser:
    """요청 쿠키의 세션 ID 로 로그인 사용자를 찾는다.

    Returns: SessionUser
    Raises:  ApiError(401) — 쿠키가 없거나, 세션이 만료·로그아웃되었거나, 로그인 정보가 없을 때
             ApiError(503) — Redis 에 접속할 수 없을 때
    """
    session_id = request.cookies.get(SESSION_NAME, "")
    if not SESSION_ID_PATTERN.match(session_id):
        raise ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.")

    key = SESSION_KEY_PREFIX + session_id
    try:
        raw = store.get(key)
        if raw is None:
            # 만료되었거나 PHP 에서 로그아웃(session_destroy)해 키가 지워진 경우
            raise ApiError(401, "UNAUTHORIZED", "세션이 만료되었습니다. 다시 로그인하세요.")
        # 슬라이딩 만료: 생산 서버를 쓰는 동안에도 세션이 끊기지 않게 PHP 와 같은 TTL 로 연장한다
        store.expire(key, SESSION_TTL)
    except redis.RedisError as e:
        print(f"[Session] Redis 오류: {e}")
        raise ApiError(503, "SESSION_STORE_UNAVAILABLE", "세션 저장소에 접속할 수 없습니다.") from e

    try:
        data = decode_php_session(raw)
        return SessionUser(
            session_id=session_id,
            user_id=int(data["userId"]),
            username=str(data["username"]),
            display_name=str(data["displayName"]),
            role=str(data["role"]),
            login_at=str(data["loginAt"]),
        )
    except (PhpSessionDecodeError, KeyError, TypeError, ValueError) as e:
        # 형식이 깨졌거나 로그인 정보가 없는 세션은 로그인하지 않은 것으로 본다
        print(f"[Session] 세션 해석 실패 ({session_id[:8]}...): {e}")
        raise ApiError(401, "UNAUTHORIZED", "로그인이 필요합니다.") from e


def require_role(role: str):
    """특정 역할만 허용하는 의존성을 만든다. 예) Depends(require_role("ADMIN"))

    Args:    role — "ADMIN" 또는 "WORKER"
    Returns: FastAPI 의존성 함수 (SessionUser 를 돌려줌)
    Raises:  ApiError(403) — 역할이 맞지 않을 때 (예: 루돌프가 작업지시 등록)
    """

    def dependency(user: SessionUser = Depends(get_current_user)) -> SessionUser:
        """로그인 사용자의 역할이 role 과 같은지 확인한다. 같으면 그 사용자를 돌려준다."""
        if user.role != role:
            raise ApiError(403, "FORBIDDEN", "이 기능을 사용할 권한이 없습니다.")
        return user

    return dependency
