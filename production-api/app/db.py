# ------------------------------------------------------------
# app/db.py
# 역할 : erp_production 스키마 접속과 트랜잭션, 생산계획 잠금을 제공한다.
#        생산 서비스 전용 계정(production_app)은 erp_production 에만 권한이 있어서,
#        재고 데이터(erp_inventory)는 반드시 재고 서버 API 로만 다룬다.
# 사용 : with planning_transaction() as cur:  ...  (끝나면 자동 커밋, 오류면 롤백)
#        with read_cursor() as cur:  ...          (조회 전용)
# 의존 : MySQL(erp-mysql), app/config.py
# ------------------------------------------------------------
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

from app.config import DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER
from app.responses import ApiError

# 생산계획·작업지시 수량을 바꾸는 요청을 한 번에 하나씩만 처리하기 위한 MySQL 이름 잠금.
# 생산 서버가 3대라서, 두 요청이 서로 다른 서버에서 동시에 "부족 없음" 판정을 받고
# 둘 다 저장해 자재를 이중으로 예약하는 일을 막는다. (잠금은 DB 에 있으므로 3대가 공유한다)
PLANNING_LOCK_NAME = "erp_production_planning"
PLANNING_LOCK_TIMEOUT_SECONDS = 5


def connect() -> pymysql.connections.Connection:
    """MySQL 에 새로 접속한다. 요청마다 접속하고 요청이 끝나면 닫는다.

    Returns: 자동 커밋을 끈 연결 (직접 commit / rollback 한다)
    Raises:  ApiError(503) — DB 에 접속할 수 없을 때
    """
    try:
        return pymysql.connect(
            host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, database=DB_NAME,
            charset="utf8mb4",          # 한글 데이터 (스키마 문자셋과 같게)
            cursorclass=DictCursor,     # 결과를 {"컬럼명": 값} 딕셔너리로 받는다
            autocommit=False,
            connect_timeout=3,
        )
    except (pymysql.MySQLError, RuntimeError) as e:
        # RuntimeError: 로그인 방식에 필요한 패키지(cryptography)가 없을 때 PyMySQL 이 내는 오류
        print(f"[DB] 접속 실패: {e!r}")
        raise ApiError(503, "DB_UNAVAILABLE", "데이터베이스에 접속할 수 없습니다.") from e


@contextmanager
def read_cursor():
    """조회 전용 커서. 블록이 끝나면 연결을 닫는다."""
    conn = connect()
    try:
        with conn.cursor() as cur:
            yield cur
    finally:
        conn.close()


@contextmanager
def planning_transaction():
    """생산계획 잠금 + 트랜잭션.

    순서: 접속 → 잠금 획득 → (블록 실행) → 커밋 → 잠금 해제 → 연결 닫기
    잠금을 커밋 "뒤"에 풀어야, 다음 요청이 아직 커밋되지 않은 옛 상태를 읽지 않는다.
    블록에서 예외가 나면 롤백하고 잠금을 푼 뒤 예외를 그대로 올려보낸다.

    Raises: ApiError(503) — 다른 요청이 5초 넘게 잠금을 쥐고 있을 때
    """
    conn = connect()
    locked = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT GET_LOCK(%s, %s) AS got", (PLANNING_LOCK_NAME, PLANNING_LOCK_TIMEOUT_SECONDS))
            if cur.fetchone()["got"] != 1:
                raise ApiError(503, "BUSY", "다른 생산계획을 처리하고 있습니다. 잠시 후 다시 시도하세요.")
            locked = True
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if locked:
            with conn.cursor() as cur:
                cur.execute("SELECT RELEASE_LOCK(%s)", (PLANNING_LOCK_NAME,))
        conn.close()
