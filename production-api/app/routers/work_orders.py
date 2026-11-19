# ------------------------------------------------------------
# app/routers/work_orders.py
# 역할 : 생산계획·작업지시 API.
#
#   GET   /api/production/work-orders         (모두)   작업지시 목록 + 모델별 대기 수량 + 오늘 계획 횟수
#   POST  /api/production/plans/check         (ADMIN)  새 계획 + 대기 작업지시를 합쳐 부족 자재 확인
#   POST  /api/production/work-orders/batch   (ADMIN)  생산계획 저장 + 작업지시 일괄 등록 (같은 모델 WAIT 에 합침)
#   PATCH /api/production/work-orders/{id}    (ADMIN)  대기 작업지시 수량 수정 (0 = 삭제)
#
# 흐름 (일괄 등록)
#   세션 확인(ADMIN) → 생산계획 잠금 → WAIT 작업지시 조회 → 재고 서버 check(대기 + 새 계획)
#   → 부족하면 409(아무것도 저장 안 함) → 계획·계획 줄 저장 → WAIT 에 합치기 / 새 작업지시 → 커밋
#
# 의존 : app/db.py(MySQL), app/inventory_client.py(재고 서버), app/services/planning.py(계산)
# ------------------------------------------------------------
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import inventory_client
from app.db import planning_transaction, read_cursor
from app.responses import ApiError, ok
from app.services import planning
from app.session import SessionUser, get_current_user, require_role

router = APIRouter(prefix="/api/production")

# 트리 코드 형식 (예: T-CLASSIC). 실제로 있는 모델인지는 재고 서버가 BOM 으로 확인한다(없으면 400)
TREE_CODE = Field(min_length=1, max_length=20, pattern=r"^[A-Z0-9-]+$")
MAX_QTY = 10000

WORK_ORDER_COLUMNS = """
    id, wo_no, tree_code, qty, status, shipped, created_by_name, created_at,
    completed_by_name, completed_server, completed_at
"""


# ---- 요청 본문 형식 (형식이 틀리면 main.py 처리기가 400 VALIDATION_ERROR 로 응답) ----

class CheckLine(BaseModel):
    treeCode: str = TREE_CODE
    qty: int = Field(ge=0, le=MAX_QTY)


class CheckRequest(BaseModel):
    lines: list[CheckLine] = Field(min_length=1, max_length=20)


class PlanLine(BaseModel):
    treeCode: str = TREE_CODE
    orderQty: int = Field(ge=0, le=MAX_QTY)   # 트리 모델 탭에서 담은 주문 수량
    planQty: int = Field(ge=0, le=MAX_QTY)    # 생산계획 화면에서 확정한 수량 (작업지시가 될 수량)


class BatchRequest(BaseModel):
    lines: list[PlanLine] = Field(min_length=1, max_length=20)


class QtyUpdate(BaseModel):
    qty: int = Field(ge=0, le=MAX_QTY)


# ---- 공통 ----------------------------------------------------------------

def _fmt_time(value) -> str | None:
    """DB 의 DATETIME 을 "YYYY-MM-DD HH:MM:SS" 문자열로 바꾼다 (없으면 None)."""
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else None


def _to_api(row: dict) -> dict:
    """work_orders 행을 화면용 camelCase 딕셔너리로 바꾼다."""
    return {
        "id": row["id"],
        "woNo": row["wo_no"],
        "treeCode": row["tree_code"],
        "qty": int(row["qty"]),
        "status": row["status"],
        "shipped": bool(row["shipped"]),
        "createdBy": row["created_by_name"],
        "createdAt": _fmt_time(row["created_at"]),
        "completedBy": row["completed_by_name"],
        "completedServer": row["completed_server"],   # 완료를 처리한 생산 서버 hostname (T10)
        "completedAt": _fmt_time(row["completed_at"]),
    }


def _select_waiting(cur, lock: bool) -> list[dict]:
    """WAIT 작업지시를 id 순으로 읽는다. lock 이면 행을 잠근다(FOR UPDATE)."""
    cur.execute(
        f"SELECT {WORK_ORDER_COLUMNS} FROM work_orders WHERE status = 'WAIT' ORDER BY id"
        + (" FOR UPDATE" if lock else "")
    )
    return cur.fetchall()


def _require_no_shortage(check: dict) -> None:
    """재고 서버 check 결과에 부족 자재가 있으면 409 를 낸다.

    Raises: ApiError(409, INSUFFICIENT_STOCK) — details = [{itemCode, name, need, stock, short}, ...]
            (need 는 대기 작업지시 몫을 포함한 전체 필요량, short = need − stock)
    """
    if not check["ok"]:
        raise ApiError(409, "INSUFFICIENT_STOCK", "자재가 부족해 이 수량으로는 작업지시를 등록할 수 없습니다.",
                       check["shortages"])


# ---- API ----------------------------------------------------------------

@router.get("/work-orders")
def list_work_orders(user: SessionUser = Depends(get_current_user)):
    """작업지시 목록 (대시보드·작업 탭).

    포함하는 작업지시: 대기(WAIT) 전부 + 완료했지만 출하하지 않은 것 + 오늘 만들었거나 오늘 완료한 것
    Returns: { orders: [...], waitingByTree: {"T-CLASSIC": 5}, planCountToday: 2 }
             waitingByTree 를 BOM 과 곱하면 화면의 "대기 지시" 자재 수량(예약량)이 된다.
    """
    with read_cursor() as cur:
        cur.execute(
            f"""SELECT {WORK_ORDER_COLUMNS} FROM work_orders
                WHERE status = 'WAIT'
                   OR (status = 'DONE' AND shipped = 0)
                   OR DATE(created_at) = CURDATE()
                   OR DATE(completed_at) = CURDATE()
                ORDER BY id"""
        )
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS n FROM production_plans WHERE DATE(created_at) = CURDATE()")
        plan_count = cur.fetchone()["n"]

    waiting = [r for r in rows if r["status"] == "WAIT"]
    return ok({
        "orders": [_to_api(r) for r in rows],
        "waitingByTree": planning.waiting_by_tree(waiting),
        "planCountToday": int(plan_count),
    })


@router.post("/plans/check")
def check_plan(body: CheckRequest, user: SessionUser = Depends(require_role("ADMIN"))):
    """생산계획 확인 (저장하지 않음). 생산계획 화면의 "미달 재고"에 쓴다.

    대기 작업지시 수량을 더해서 확인하므로, 결과는 "사용 가능 수량" 기준이다.
    Returns: { ok, shortages, need, waitingByTree }
    """
    with read_cursor() as cur:
        waiting = planning.waiting_by_tree(_select_waiting(cur, lock=False))
    new = planning.sum_by_tree([(l.treeCode, l.qty) for l in body.lines])
    lines = planning.lines_for_check(waiting, new)
    check = inventory_client.check_stock(lines) if lines else {"ok": True, "need": {}, "shortages": []}
    return ok(check | {"waitingByTree": waiting})


@router.post("/work-orders/batch")
def create_batch(body: BatchRequest, user: SessionUser = Depends(require_role("ADMIN"))):
    """생산계획 저장 + 작업지시 일괄 등록.

    Returns: 201 { planId, created: ["WO-..."], merged: ["WO-..."], orders: [등록·변경된 작업지시] }
    Raises:  400 — 계획 수량 합계가 0
             409 — 대기 작업지시 + 이번 계획으로 자재가 부족 (DB 는 바뀌지 않음)
    """
    new = planning.sum_by_tree([(l.treeCode, l.planQty) for l in body.lines])
    if not new:
        raise ApiError(400, "VALIDATION_ERROR", "계획 수량이 모두 0입니다. 1그루 이상 입력하세요.")

    # 확인과 저장 사이에 다른 서버가 끼어들지 못하도록 잠금 안에서 처리한다
    with planning_transaction() as cur:
        waiting_rows = _select_waiting(cur, lock=True)
        # 화면에서 확인했더라도 저장 직전에 한 번 더 확인한다 (그사이 다른 계획이 등록됐을 수 있음)
        check = inventory_client.check_stock(planning.lines_for_check(planning.waiting_by_tree(waiting_rows), new))
        _require_no_shortage(check)

        # 1) 생산계획과 계획 줄 (주문 수량과 계획 수량을 함께 남긴다)
        cur.execute("INSERT INTO production_plans (created_by, created_by_name) VALUES (%s, %s)",
                    (user.user_id, user.username))
        plan_id = cur.lastrowid
        cur.executemany(
            "INSERT INTO plan_lines (plan_id, tree_code, order_qty, plan_qty) VALUES (%s, %s, %s, %s)",
            [(plan_id, l.treeCode, l.orderQty, l.planQty) for l in body.lines if l.orderQty or l.planQty],
        )

        # 2) 같은 모델 WAIT 에 합치기 / 새 작업지시 만들기
        batch = planning.plan_batch(waiting_rows, new)
        changed_ids = []
        for wo_id, qty in batch.merges:
            cur.execute("UPDATE work_orders SET qty = %s WHERE id = %s", (qty, wo_id))
            changed_ids.append(wo_id)
        if batch.creates:
            # 번호의 날짜와 순번은 DB 시각(+09:00) 기준. 잠금 안이라 순번이 겹치지 않는다
            cur.execute("SELECT DATE_FORMAT(NOW(), '%m%d') AS mmdd")
            mmdd = cur.fetchone()["mmdd"]
            cur.execute("SELECT COALESCE(MAX(CAST(SUBSTRING(wo_no, 9) AS UNSIGNED)), 0) AS seq "
                        "FROM work_orders WHERE wo_no LIKE %s", (f"WO-{mmdd}-%",))
            seq = int(cur.fetchone()["seq"])
            for tree, qty in batch.creates:
                seq += 1
                cur.execute(
                    "INSERT INTO work_orders (wo_no, tree_code, qty, created_by, created_by_name) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (planning.format_wo_no(mmdd, seq), tree, qty, user.user_id, user.username),
                )
                changed_ids.append(cur.lastrowid)

        cur.execute(f"SELECT {WORK_ORDER_COLUMNS} FROM work_orders WHERE id IN %s ORDER BY id", (changed_ids,))
        orders = [_to_api(r) for r in cur.fetchall()]

    merged_ids = {wo_id for wo_id, _ in batch.merges}
    return ok({
        "planId": plan_id,
        "created": [o["woNo"] for o in orders if o["id"] not in merged_ids],
        "merged": [o["woNo"] for o in orders if o["id"] in merged_ids],
        "orders": orders,
    }, status=201)


@router.patch("/work-orders/{wo_id}")
def update_qty(wo_id: int, body: QtyUpdate, user: SessionUser = Depends(require_role("ADMIN"))):
    """대기 작업지시 수량 수정 ([수량 수정] 팝업). 0 으로 저장하면 삭제한다.

    Returns: { id, woNo, qty, deleted }
    Raises:  404 — 없는 작업지시
             409 ALREADY_DONE — 완료된 작업지시는 수정할 수 없음
             409 INSUFFICIENT_STOCK — 늘린 수량으로 자재가 부족 (DB 는 바뀌지 않음)
    """
    with planning_transaction() as cur:
        waiting_rows = _select_waiting(cur, lock=True)
        row = next((r for r in waiting_rows if r["id"] == wo_id), None)
        if row is None:
            cur.execute("SELECT status FROM work_orders WHERE id = %s", (wo_id,))
            found = cur.fetchone()
            if found is None:
                raise ApiError(404, "NOT_FOUND", "작업지시를 찾을 수 없습니다.")
            raise ApiError(409, "ALREADY_DONE", "완료된 작업지시는 수정할 수 없습니다.")

        if body.qty == 0:
            cur.execute("DELETE FROM work_orders WHERE id = %s", (wo_id,))
            return ok({"id": wo_id, "woNo": row["wo_no"], "qty": 0, "deleted": True})

        # 수량을 늘릴 때만 부족을 확인한다 (줄이면 예약량이 줄어들 뿐이라 부족이 생기지 않는다)
        if body.qty > int(row["qty"]):
            after = planning.waiting_after_edit(waiting_rows, wo_id, body.qty)
            _require_no_shortage(inventory_client.check_stock(planning.lines_for_check(after)))
        cur.execute("UPDATE work_orders SET qty = %s WHERE id = %s", (body.qty, wo_id))

    return ok({"id": wo_id, "woNo": row["wo_no"], "qty": body.qty, "deleted": False})
