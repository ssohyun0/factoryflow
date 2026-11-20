# ------------------------------------------------------------
# tests/test_complete.py
# 역할 : 작업지시 완료·출하 단위 테스트 (T10).
#        MySQL 대신 SQL 을 기록하고 커밋/롤백 여부를 표시하는 가짜 트랜잭션을,
#        재고 서버 대신 httpx.MockTransport 를 쓴다.
# 실행 : docker exec erp-production-api-1 pytest -q
# 검사 : 완료 시 재고 서버 produce 호출 내용과 처리 서버 기록(SC-8),
#        이미 DONE 이면 409 + 재고 서버 미호출, 자재 부족 409 면 롤백,
#        출하 성공·초과 409 롤백(SC-9c), 역할 403
# ------------------------------------------------------------
import json
from contextlib import contextmanager

import httpx
import pytest

from app import inventory_client
from app.config import SERVED_BY
from app.routers import shipments, work_orders


def order_row(status="WAIT", qty=5):
    """work_orders DB 행 흉내 (레드 트리 작업지시 1번)."""
    return {"id": 1, "wo_no": "WO-1119-001", "tree_code": "T-CLASSIC", "qty": qty, "status": status,
            "shipped": 0, "created_by_name": "santa", "created_at": None,
            "completed_by_name": None, "completed_server": None, "completed_at": None}


class FakeTx:
    """가짜 트랜잭션 커서. fetchone 은 정해 둔 행을, fetchall 은 정해 둔 목록을 돌려준다."""

    def __init__(self, one=None, many=None):
        self.one = one
        self.many = many or []
        self.sql: list[tuple[str, object]] = []
        self.committed = False
        self.rolled_back = False

    def execute(self, sql, args=None):
        self.sql.append((sql, args))

    def executemany(self, sql, seq):
        self.sql.append((sql, list(seq)))

    def fetchone(self):
        return self.one

    def fetchall(self):
        return self.many

    def writes(self):
        return [s for s, _ in self.sql if s.lstrip().split()[0].upper() in ("INSERT", "UPDATE", "DELETE")]


@pytest.fixture
def fake_tx(monkeypatch):
    """planning_transaction 을 가짜로 바꾼다. 블록이 예외 없이 끝나면 커밋, 예외면 롤백으로 표시한다."""

    def _install(tx: FakeTx):
        @contextmanager
        def fake_cm():
            try:
                yield tx
                tx.committed = True
            except Exception:
                tx.rolled_back = True
                raise

        monkeypatch.setattr(work_orders, "planning_transaction", fake_cm)
        monkeypatch.setattr(shipments, "planning_transaction", fake_cm)
        return tx

    return _install


@pytest.fixture
def fake_inventory(monkeypatch):
    """재고 서버 흉내. 받은 요청을 calls 에 기록한다."""

    def _install(status, payload):
        calls = []

        def handler(request: httpx.Request):
            calls.append({"path": request.url.path, "body": json.loads(request.content)})
            return httpx.Response(status, json=payload)

        monkeypatch.setattr(inventory_client, "client",
                            httpx.Client(base_url="http://inventory", transport=httpx.MockTransport(handler)))
        return calls

    return _install


PRODUCE_OK = {"success": True, "data": {"treeCode": "T-CLASSIC", "qty": 5, "treeStock": 11,
                                        "consumed": [{"itemCode": "RIBBON", "qty": 20, "stockAfter": 24}]}}
SHORT_409 = {"success": False, "error": {"code": "INSUFFICIENT_STOCK", "message": "자재가 부족해 작업지시를 완료할 수 없습니다.",
                                         "details": [{"itemCode": "RIBBON", "name": "벨벳 리본", "need": 20, "stock": 4, "short": 16}]}}


# ---------- 작업지시 완료 ----------

def test_complete_calls_produce_and_records_server(login, client, fake_tx, fake_inventory):
    """SC-8: 완료하면 재고 서버 produce 를 부르고, 작업지시에 처리자와 처리 서버 hostname 을 남긴다."""
    login("reindeer")
    tx = fake_tx(FakeTx(one=order_row()))
    calls = fake_inventory(200, PRODUCE_OK)

    res = client.post("/api/production/work-orders/1/complete")

    assert res.status_code == 200
    assert calls == [{"path": "/internal/stock/produce",
                      "body": {"treeCode": "T-CLASSIC", "qty": 5, "userId": 2, "woNo": "WO-1119-001"}}]
    update_sql, update_args = next((s, a) for s, a in tx.sql if s.startswith("UPDATE"))
    assert "status = 'DONE'" in update_sql
    assert update_args == (2, "reindeer", SERVED_BY, 1)       # 처리자 id·이름, 처리 서버, 작업지시 id
    assert tx.committed is True
    assert res.json()["data"]["treeStock"] == 11


def test_complete_already_done_is_409_without_calling_inventory(login, client, fake_tx, fake_inventory):
    login("reindeer")
    tx = fake_tx(FakeTx(one=order_row(status="DONE")))
    calls = fake_inventory(200, PRODUCE_OK)

    res = client.post("/api/production/work-orders/1/complete")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "ALREADY_DONE"
    assert calls == []                  # 재고 서버를 부르지 않았으므로 재고 그대로
    assert tx.writes() == []


def test_complete_with_shortage_rolls_back(login, client, fake_tx, fake_inventory):
    login("reindeer")
    tx = fake_tx(FakeTx(one=order_row()))
    fake_inventory(409, SHORT_409)

    res = client.post("/api/production/work-orders/1/complete")

    assert res.status_code == 409
    assert res.json()["error"]["details"][0]["short"] == 16
    assert tx.rolled_back is True and tx.committed is False   # DONE 변경이 취소된다


def test_complete_unknown_is_404(login, client, fake_tx):
    login("reindeer")
    fake_tx(FakeTx(one=None))
    assert client.post("/api/production/work-orders/99/complete").status_code == 404


def test_admin_cannot_complete(login, client):
    login("santa")
    assert client.post("/api/production/work-orders/1/complete").status_code == 403


# ---------- 출하 ----------

SHIP_BODY = {"rows": [{"treeCode": "T-CLASSIC", "destination": "강남 물류센터", "qty": 3},
                      {"treeCode": "T-CLASSIC", "destination": "부산 물류센터", "qty": 2}]}


def test_shipment_records_rows_and_marks_done_orders(login, client, fake_tx, fake_inventory):
    login("reindeer")
    tx = fake_tx(FakeTx(many=[{"wo_no": "WO-1119-001"}]))
    calls = fake_inventory(200, {"success": True, "data": {"rows": [], "treeStock": {"T-CLASSIC": 6}}})

    res = client.post("/api/production/shipments", json=SHIP_BODY)

    assert res.status_code == 201
    assert calls[0]["path"] == "/internal/stock/ship"
    assert calls[0]["body"] == {"userId": 2, "rows": SHIP_BODY["rows"]}
    insert_sql, insert_rows = next((s, a) for s, a in tx.sql if s.startswith("INSERT INTO shipments"))
    assert insert_rows[0] == ("T-CLASSIC", "강남 물류센터", 3, 2, "reindeer", SERVED_BY)
    assert any(s.startswith("UPDATE work_orders SET shipped = 1") for s, _ in tx.sql)
    assert tx.committed is True
    assert res.json()["data"]["shippedOrders"] == ["WO-1119-001"]


def test_shipment_over_stock_is_409_and_rolls_back(login, client, fake_tx, fake_inventory):
    """SC-9c: 완성 트리 재고보다 많이 출하하면 409, 출하 기록과 shipped 표시가 취소된다."""
    login("reindeer")
    tx = fake_tx(FakeTx())
    fake_inventory(409, {"success": False, "error": {"code": "INSUFFICIENT_STOCK",
                                                     "message": "완성 트리 재고보다 많이 출하할 수 없습니다.",
                                                     "details": [{"itemCode": "T-CLASSIC", "need": 99, "stock": 6, "short": 93}]}})

    res = client.post("/api/production/shipments",
                      json={"rows": [{"treeCode": "T-CLASSIC", "destination": "강남 물류센터", "qty": 99}]})

    assert res.status_code == 409
    assert tx.rolled_back is True and tx.committed is False


@pytest.mark.parametrize("body", [
    {"rows": []},
    {"rows": [{"treeCode": "T-CLASSIC", "destination": "", "qty": 1}]},
    {"rows": [{"treeCode": "T-CLASSIC", "destination": "강남 물류센터", "qty": 0}]},
])
def test_shipment_invalid_body_is_400(login, client, body):
    login("reindeer")
    assert client.post("/api/production/shipments", json=body).status_code == 400


def test_admin_cannot_ship(login, client):
    login("santa")
    assert client.post("/api/production/shipments", json=SHIP_BODY).status_code == 403
