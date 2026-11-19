# ------------------------------------------------------------
# tests/test_planning.py
# 역할 : 생산계획·작업지시 규칙 단위 테스트 (T9).
#        MySQL 대신 실행한 SQL 을 기록하는 가짜 커서(FakeCursor)를,
#        재고 서버 대신 httpx.MockTransport 를 쓴다.
# 실행 : docker exec erp-production-api-1 pytest -q
# 검사 : 같은 모델 WAIT 합치기(SC-9b), 대기 + 계획 합산 후 409(SC-9, DB 변경 없음),
#        수량 수정 규칙, 재고 서버 오류 변환, 역할 403(SC-9d), 입력 400
# ------------------------------------------------------------
import json
from contextlib import contextmanager

import httpx
import pytest

from app import inventory_client
from app.routers import work_orders
from app.services import planning

# 재고 서버가 레드 13그루 확인에 돌려주는 부족 목록 (SC-9 사례: 금색 별 1, 벨벳 리본 8 부족)
SHORTAGES_RED_13 = [
    {"itemCode": "RIBBON", "name": "벨벳 리본", "need": 52, "stock": 44, "short": 8},
    {"itemCode": "STAR-GOLD", "name": "금색 별", "need": 13, "stock": 12, "short": 1},
]


def wait_row(wo_id, tree, qty, wo_no=None):
    """WAIT 작업지시 DB 행 흉내."""
    return {"id": wo_id, "wo_no": wo_no or f"WO-1201-{wo_id:03d}", "tree_code": tree, "qty": qty,
            "status": "WAIT", "shipped": 0, "created_by_name": "santa", "created_at": None,
            "completed_by_name": None, "completed_server": None, "completed_at": None}


# ---------- 순수 계산 (app/services/planning.py) ----------

def test_sum_by_tree_merges_same_model_and_skips_zero():
    assert planning.sum_by_tree([("T-CLASSIC", 3), ("T-MINI", 0), ("T-CLASSIC", 2)]) == {"T-CLASSIC": 5}


def test_lines_for_check_adds_waiting_and_new_plan():
    # 대기 레드 11 + 새 계획 레드 2, 미니 2 → 재고 서버에는 레드 13, 미니 2 로 확인 요청
    lines = planning.lines_for_check({"T-CLASSIC": 11}, {"T-CLASSIC": 2, "T-MINI": 2})
    assert lines == [{"treeCode": "T-CLASSIC", "qty": 13}, {"treeCode": "T-MINI", "qty": 2}]


def test_plan_batch_scenario_red3_red2_mini2_makes_two_orders():
    """SC-9b: 레드 3 → 레드 2 → 미니 2 를 차례로 등록하면 작업지시 2건(레드 5, 미니 2)."""
    first = planning.plan_batch([], {"T-CLASSIC": 3})
    assert first.creates == [("T-CLASSIC", 3)] and first.merges == []

    second = planning.plan_batch([wait_row(1, "T-CLASSIC", 3)], {"T-CLASSIC": 2})
    assert second.merges == [(1, 5)] and second.creates == []

    third = planning.plan_batch([wait_row(1, "T-CLASSIC", 5)], {"T-MINI": 2})
    assert third.creates == [("T-MINI", 2)] and third.merges == []


def test_plan_batch_does_not_merge_into_done_orders():
    # DONE 작업지시는 waiting_rows 에 들어오지 않으므로 같은 모델이어도 새로 만든다
    assert planning.plan_batch([], {"T-CLASSIC": 4}).creates == [("T-CLASSIC", 4)]


def test_waiting_after_edit_replaces_one_order_qty():
    rows = [wait_row(1, "T-CLASSIC", 5), wait_row(2, "T-MINI", 2)]
    assert planning.waiting_after_edit(rows, 1, 9) == {"T-CLASSIC": 9, "T-MINI": 2}
    assert planning.waiting_after_edit(rows, 2, 0) == {"T-CLASSIC": 5}


def test_format_wo_no():
    assert planning.format_wo_no("1201", 3) == "WO-1201-003"


# ---------- 가짜 MySQL · 가짜 재고 서버 ----------

class FakeCursor:
    """실행한 SQL 을 기록하고, WAIT 조회에는 정해 둔 행을 돌려주는 가짜 커서."""

    def __init__(self, waiting_rows):
        self.waiting_rows = waiting_rows
        self.sql: list[str] = []
        self._last = ""

    def execute(self, sql, args=None):
        self.sql.append(sql)
        self._last = sql

    def fetchall(self):
        return self.waiting_rows if "status = 'WAIT'" in self._last else []

    def fetchone(self):
        return None

    def writes(self):
        """INSERT / UPDATE / DELETE 문만 모은다 (DB 를 바꾸려 했는지 확인용)."""
        return [s for s in self.sql if s.lstrip().split()[0].upper() in ("INSERT", "UPDATE", "DELETE")]


@pytest.fixture
def fake_db(monkeypatch):
    """work_orders 라우터의 DB 접근을 가짜 커서로 바꾼다. fake_db(rows) 로 WAIT 행을 정한다."""

    def _install(waiting_rows):
        cur = FakeCursor(waiting_rows)

        @contextmanager
        def fake_cm():
            yield cur

        monkeypatch.setattr(work_orders, "read_cursor", fake_cm)
        monkeypatch.setattr(work_orders, "planning_transaction", fake_cm)
        return cur

    return _install


@pytest.fixture
def fake_inventory(monkeypatch):
    """재고 서버를 흉내 낸다. fake_inventory(status, payload) 로 응답을 정하고, 받은 요청을 기록한다."""

    def _install(status, payload):
        calls = []

        def handler(request: httpx.Request):
            calls.append({"path": request.url.path, "body": json.loads(request.content),
                          "token": request.headers.get("X-Internal-Token")})
            return httpx.Response(status, json=payload)

        monkeypatch.setattr(inventory_client, "client",
                            httpx.Client(base_url="http://inventory", transport=httpx.MockTransport(handler),
                                         headers={"X-Internal-Token": "factoryflow-internal"}))
        return calls

    return _install


# ---------- API: POST /plans/check ----------

def test_check_plan_sends_waiting_plus_new_and_returns_shortages(login, client, fake_db, fake_inventory):
    login("santa")
    fake_db([wait_row(1, "T-CLASSIC", 11)])
    calls = fake_inventory(200, {"success": True, "data": {"ok": False, "need": {}, "shortages": SHORTAGES_RED_13}})

    res = client.post("/api/production/plans/check", json={"lines": [{"treeCode": "T-CLASSIC", "qty": 2}]})

    assert res.status_code == 200
    assert calls[0]["path"] == "/internal/stock/check"
    assert calls[0]["body"] == {"lines": [{"treeCode": "T-CLASSIC", "qty": 13}]}   # 대기 11 + 계획 2
    assert calls[0]["token"] == "factoryflow-internal"
    data = res.json()["data"]
    assert data["ok"] is False
    assert data["waitingByTree"] == {"T-CLASSIC": 11}
    assert {s["itemCode"]: s["short"] for s in data["shortages"]} == {"RIBBON": 8, "STAR-GOLD": 1}


# ---------- API: POST /work-orders/batch ----------

def test_batch_with_shortage_is_409_and_writes_nothing(login, client, fake_db, fake_inventory):
    """SC-9: 레드 11 대기 중 레드 2 등록 → 409 + 부족 목록, DB 는 바뀌지 않는다."""
    login("santa")
    cur = fake_db([wait_row(1, "T-CLASSIC", 11)])
    fake_inventory(200, {"success": True, "data": {"ok": False, "need": {}, "shortages": SHORTAGES_RED_13}})

    res = client.post("/api/production/work-orders/batch",
                      json={"lines": [{"treeCode": "T-CLASSIC", "orderQty": 2, "planQty": 2}]})

    assert res.status_code == 409
    body = res.json()
    assert body["error"]["code"] == "INSUFFICIENT_STOCK"
    assert {d["itemCode"]: d["short"] for d in body["error"]["details"]} == {"RIBBON": 8, "STAR-GOLD": 1}
    assert cur.writes() == []


def test_batch_all_zero_is_400(login, client, fake_db):
    login("santa")
    fake_db([])
    res = client.post("/api/production/work-orders/batch",
                      json={"lines": [{"treeCode": "T-CLASSIC", "orderQty": 3, "planQty": 0}]})
    assert res.status_code == 400


@pytest.mark.parametrize("body", [
    {"lines": []},                                                               # 줄 없음
    {"lines": [{"treeCode": "T-CLASSIC", "orderQty": 1, "planQty": -1}]},       # 음수
    {"lines": [{"treeCode": "t classic", "orderQty": 1, "planQty": 1}]},        # 코드 형식
])
def test_batch_invalid_body_is_400(login, client, body):
    login("santa")
    res = client.post("/api/production/work-orders/batch", json=body)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------- API: PATCH /work-orders/{id} ----------

def test_patch_increase_with_shortage_is_409_and_writes_nothing(login, client, fake_db, fake_inventory):
    login("santa")
    cur = fake_db([wait_row(1, "T-CLASSIC", 11)])
    calls = fake_inventory(200, {"success": True, "data": {"ok": False, "need": {}, "shortages": SHORTAGES_RED_13}})

    res = client.patch("/api/production/work-orders/1", json={"qty": 13})

    assert res.status_code == 409
    assert calls[0]["body"] == {"lines": [{"treeCode": "T-CLASSIC", "qty": 13}]}   # 11 이 13 으로 바뀐 상태로 확인
    assert cur.writes() == []


def test_patch_decrease_skips_check_and_updates(login, client, fake_db, fake_inventory):
    login("santa")
    cur = fake_db([wait_row(1, "T-CLASSIC", 5)])
    calls = fake_inventory(500, {})   # 호출되면 안 된다

    res = client.patch("/api/production/work-orders/1", json={"qty": 3})

    assert res.status_code == 200
    assert res.json()["data"] == {"id": 1, "woNo": "WO-1201-001", "qty": 3, "deleted": False}
    assert calls == []
    assert len(cur.writes()) == 1 and cur.writes()[0].startswith("UPDATE")


def test_patch_zero_deletes(login, client, fake_db):
    login("santa")
    cur = fake_db([wait_row(1, "T-CLASSIC", 5)])
    res = client.patch("/api/production/work-orders/1", json={"qty": 0})
    assert res.status_code == 200
    assert res.json()["data"]["deleted"] is True
    assert cur.writes()[0].startswith("DELETE")


def test_patch_unknown_order_is_404(login, client, fake_db):
    login("santa")
    fake_db([])   # WAIT 에도 없고, 상태 조회(fetchone)도 None
    assert client.patch("/api/production/work-orders/99", json={"qty": 1}).status_code == 404


# ---------- 권한 (SC-9d) ----------

@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/production/plans/check", {"lines": [{"treeCode": "T-CLASSIC", "qty": 1}]}),
    ("post", "/api/production/work-orders/batch", {"lines": [{"treeCode": "T-CLASSIC", "orderQty": 1, "planQty": 1}]}),
    ("patch", "/api/production/work-orders/1", {"qty": 1}),
])
def test_worker_cannot_plan_or_edit(login, client, method, path, body):
    login("reindeer")
    res = getattr(client, method)(path, json=body)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_list_requires_login(store, client):
    assert client.get("/api/production/work-orders").status_code == 401


# ---------- 재고 서버 오류 변환 (app/inventory_client.py) ----------

def test_inventory_400_is_passed_through(fake_inventory):
    fake_inventory(400, {"success": False, "error": {"code": "UNKNOWN_TREE", "message": "BOM 이 없는 트리 모델입니다: T-X"}})
    with pytest.raises(inventory_client.ApiError) as e:
        inventory_client.check_stock([{"treeCode": "T-X", "qty": 1}])
    assert e.value.status == 400 and e.value.code == "UNKNOWN_TREE"


def test_inventory_403_token_error_becomes_502(fake_inventory):
    fake_inventory(403, {"success": False, "error": {"code": "FORBIDDEN", "message": "..."}})
    with pytest.raises(inventory_client.ApiError) as e:
        inventory_client.check_stock([{"treeCode": "T-CLASSIC", "qty": 1}])
    assert e.value.status == 502


def test_inventory_unreachable_is_503(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(inventory_client, "client", httpx.Client(transport=httpx.MockTransport(handler), base_url="http://x"))
    with pytest.raises(inventory_client.ApiError) as e:
        inventory_client.check_stock([{"treeCode": "T-CLASSIC", "qty": 1}])
    assert e.value.status == 503
