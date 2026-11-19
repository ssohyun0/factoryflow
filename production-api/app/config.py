# ------------------------------------------------------------
# app/config.py
# 역할 : 환경변수에서 설정값을 읽는다. docker run -e 옵션으로 바꿀 수 있고,
#        없으면 시연용 기본값을 쓴다.
# 사용 : session.py, main.py 등 모든 모듈이 import 한다.
# 주의 : 세션 관련 값은 PHP(inventory-api/src/config.php)와 반드시 같아야 세션이 공유된다.
#        기본 비밀번호는 시연용 공개 값이다 (db/init/01-schema.sql 의 계정과 같아야 함).
# ------------------------------------------------------------
import os
import socket


def env(name: str, default: str) -> str:
    """환경변수를 읽고, 없거나 빈 값이면 기본값을 돌려준다.

    Args:    name — 환경변수 이름, default — 없을 때 쓸 값
    Returns: 설정값 문자열
    """
    value = os.environ.get(name, "")
    return value if value != "" else default


# MySQL 접속 정보 (생산 서비스 전용 계정은 erp_production 스키마에만 권한이 있다)
DB_HOST = env("DB_HOST", "erp-mysql")
DB_PORT = int(env("DB_PORT", "3306"))
DB_NAME = env("DB_NAME", "erp_production")
DB_USER = env("DB_USER", "production_app")
DB_PASSWORD = env("DB_PASSWORD", "production_pw")

# Redis 접속 정보 (PHP와 같은 세션 저장소)
REDIS_HOST = env("REDIS_HOST", "erp-redis")
REDIS_PORT = int(env("REDIS_PORT", "6379"))

# 세션 설정 — PHP 쪽 값과 반드시 같아야 한다
SESSION_NAME = env("SESSION_NAME", "FFSESSID")      # 쿠키 이름 (PHP session_name)
SESSION_KEY_PREFIX = "session:"                      # Redis 키 접두사 (PHP RedisSessionHandler 와 동일)
SESSION_TTL = int(env("SESSION_TTL", "3600"))        # 유효시간(초), 요청마다 연장

# 재고 서버 내부 API (T9부터 사용)
INVENTORY_API_URL = env("INVENTORY_API_URL", "http://erp-inventory-api")
INTERNAL_TOKEN = env("INTERNAL_TOKEN", "factoryflow-internal")

# 응답의 servedBy 에 넣을 컨테이너 이름 (docker run --hostname 값: erp-production-api-1~3)
# 세 컨테이너 중 어느 것이 응답했는지 화면에서 보여주는 데 쓴다 (분산 증명)
SERVED_BY = socket.gethostname()
