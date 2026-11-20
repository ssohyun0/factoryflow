# ------------------------------------------------------------
# app/inventory_client.py
# 역할 : 재고 서버(erp-inventory-api, PHP)의 내부 API 를 호출한다. (마이크로서비스 간 통신)
#        erp-net 안에서 컨테이너 이름으로 직접 호출하며, 프록시를 거치지 않는다.
#          POST /internal/stock/check    계획 확인 (재고 변경 없음)
#          POST /internal/stock/produce  작업지시 완료
#          POST /internal/stock/ship     출하
#        인증은 세션 쿠키가 아니라 X-Internal-Token 헤더(서비스 간 공유 비밀값)로 한다.
#
# 오류 변환 : 재고 서버의 400·409 는 그대로 화면까지 전달한다 (부족 자재 목록 포함).
#            연결 실패·응답 이상은 503·502 로 바꾼다.
# 사용 : from app import inventory_client;  inventory_client.check_stock([...])
# ------------------------------------------------------------
import httpx

from app.config import INTERNAL_TOKEN, INVENTORY_API_URL
from app.responses import ApiError

# 연결을 재사용하는 HTTP 클라이언트 (컨테이너당 하나).
# 테스트에서는 이 값을 가짜 응답을 내는 클라이언트(httpx.MockTransport)로 바꾼다.
client = httpx.Client(
    base_url=INVENTORY_API_URL,
    headers={"X-Internal-Token": INTERNAL_TOKEN},
    timeout=httpx.Timeout(5.0, connect=2.0),   # 재고 서버가 멈춰도 요청이 오래 붙잡히지 않게
)


def _post(path: str, body: dict) -> dict:
    """재고 서버 내부 API 를 호출하고 data 부분을 돌려준다.

    Args:    path — 예) /internal/stock/check, body — JSON 본문
    Returns: 응답의 data (딕셔너리)
    Raises:  ApiError(400/409) — 재고 서버가 거절함 (메시지·부족 목록을 그대로 전달)
             ApiError(502)     — 재고 서버 응답이 예상과 다름
             ApiError(503)     — 재고 서버에 연결할 수 없음
    """
    try:
        res = client.post(path, json=body)
    except httpx.HTTPError as e:
        print(f"[Inventory] {path} 연결 실패: {e!r}")
        raise ApiError(503, "INVENTORY_UNAVAILABLE", "재고 서버에 연결할 수 없습니다.") from e

    try:
        payload = res.json()
    except ValueError as e:
        print(f"[Inventory] {path} JSON 아님: HTTP {res.status_code}")
        raise ApiError(502, "INVENTORY_BAD_RESPONSE", "재고 서버 응답을 해석할 수 없습니다.") from e

    if res.status_code >= 400 or not payload.get("success"):
        err = payload.get("error") or {}
        # 업무 규칙 위반(400 입력 오류, 409 재고 부족)만 그대로 전달하고, 나머지(403 토큰 등)는 서버 간 문제로 본다
        status = res.status_code if res.status_code in (400, 409) else 502
        print(f"[Inventory] {path} 실패: HTTP {res.status_code} {err.get('code')}")
        raise ApiError(status, err.get("code", "INVENTORY_ERROR"),
                       err.get("message", "재고 서버가 요청을 거절했습니다."), err.get("details"))
    return payload["data"]


def check_stock(lines: list[dict]) -> dict:
    """트리별 수량을 BOM 으로 전개해 부족 자재를 확인한다. 재고는 바꾸지 않는다.

    Args:    lines — [{"treeCode": "T-CLASSIC", "qty": 13}, ...]
             (호출하는 쪽이 대기 중인 작업지시 수량을 이미 더해서 보낸다 → 사용 가능 수량 기준 판정)
    Returns: {"ok": bool, "need": {자재코드: 수량}, "shortages": [{itemCode, name, need, stock, short}, ...]}
    """
    return _post("/internal/stock/check", {"lines": lines})


def produce(tree_code: str, qty: int, user_id: int, wo_no: str) -> dict:
    """작업지시 1건 완료를 재고에 반영한다: 자재 차감(CONSUME) + 완성 트리 입고(PRODUCE).
    재고 서버가 하나의 DB 트랜잭션으로 처리하므로, 부족하면 아무것도 바뀌지 않고 409 가 온다.

    Args:    tree_code, qty — 만든 트리와 수량, user_id — 처리자(세션의 사용자), wo_no — 수불 이력에 남길 작업지시 번호
    Returns: {"treeCode", "qty", "treeStock", "consumed": [{"itemCode", "qty", "stockAfter"}, ...]}
    Raises:  ApiError(409) — 자재 부족 (details = 부족 자재 전부)
    """
    return _post("/internal/stock/produce", {"treeCode": tree_code, "qty": qty, "userId": user_id, "woNo": wo_no})


def ship(user_id: int, rows: list[dict]) -> dict:
    """출하 작업서를 재고에 반영한다: 완성 트리 차감(SHIP). 하나의 트랜잭션으로 처리한다.

    Args:    user_id — 처리자, rows — [{"treeCode", "destination", "qty"}, ...]
    Returns: {"rows": [...], "treeStock": {"T-CLASSIC": 8, ...}}
    Raises:  ApiError(409) — 트리별 합계가 완성 트리 재고보다 많음
    """
    return _post("/internal/stock/ship", {"userId": user_id, "rows": rows})
