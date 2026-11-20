# ------------------------------------------------------------
# app/routers/shipments.py
# 역할 : 출하 API (루돌프의 출하 작업서).
#
#   POST /api/production/shipments   (WORKER)  출하 작업서 저장 → 재고 서버 ship
#
# 규칙 (SPEC 1장)
#   - 완료했지만 아직 출하하지 않은 트리가 있으면, 대기 작업지시가 남아 있어도 언제든 출하할 수 있다.
#   - 완성 트리 재고보다 많이 출하하면 재고 서버가 409 로 거절한다 (트리별 합계로 판정).
#   - 출하에 성공하면 완료·미출하 작업지시를 모두 shipped = 1 로 표시한다 (작업 탭의 "출하됨").
#
# 흐름 : 잠금·트랜잭션 → 출하 기록 INSERT, 작업지시 shipped 표시(커밋 전) → 재고 서버 ship
#        → 성공하면 커밋 / 409 면 롤백 (출하 기록도 재고도 그대로)
# 의존 : app/db.py, app/inventory_client.py
# ------------------------------------------------------------
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import inventory_client
from app.config import SERVED_BY
from app.db import planning_transaction
from app.responses import ok
from app.session import SessionUser, require_role

router = APIRouter(prefix="/api/production")


class ShipmentRow(BaseModel):
    """출하 작업서의 한 줄: 트리, 출하처, 수량."""

    treeCode: str = Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9-]+$")
    destination: str = Field(min_length=1, max_length=50)   # 예: 강남 물류센터
    qty: int = Field(ge=1, le=10000)


class ShipmentRequest(BaseModel):
    rows: list[ShipmentRow] = Field(min_length=1, max_length=20)


@router.post("/shipments")
def create_shipment(body: ShipmentRequest, user: SessionUser = Depends(require_role("WORKER"))):
    """출하 작업서 저장.

    Returns: 201 { rows: [...], treeStock: {"T-CLASSIC": 8, ...}, shippedOrders: ["WO-...", ...] }
    Raises:  400 — 입력 형식 오류 (재고 서버의 품목 검사 포함: 트리가 아닌 품목 등)
             409 INSUFFICIENT_STOCK — 완성 트리 재고 초과 (DB 는 바뀌지 않음)
    """
    rows = [{"treeCode": r.treeCode, "destination": r.destination.strip(), "qty": r.qty} for r in body.rows]

    # 완료와 같은 잠금: 출하 중에 다른 서버가 작업지시를 완료해 shipped 표시가 엇갈리지 않게 한다
    with planning_transaction() as cur:
        # 1) 내 DB 먼저 (커밋 전): 출하 기록과 작업지시 출하 표시
        cur.executemany(
            "INSERT INTO shipments (tree_code, destination, qty, shipped_by, shipped_by_name, shipped_server) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            [(r["treeCode"], r["destination"], r["qty"], user.user_id, user.username, SERVED_BY) for r in rows],
        )
        cur.execute("SELECT wo_no FROM work_orders WHERE status = 'DONE' AND shipped = 0 ORDER BY id FOR UPDATE")
        shipped_orders = [r["wo_no"] for r in cur.fetchall()]
        cur.execute("UPDATE work_orders SET shipped = 1 WHERE status = 'DONE' AND shipped = 0")

        # 2) 재고 서버: 완성 트리 차감 (한 트랜잭션). 재고 초과면 409 가 올라가며 위 변경이 롤백된다
        stock = inventory_client.ship(user.user_id, rows)

    return ok({"rows": rows, "treeStock": stock["treeStock"], "shippedOrders": shipped_orders}, status=201)
