# ------------------------------------------------------------
# app/services/planning.py
# 역할 : 생산계획·작업지시의 업무 계산. DB 와 HTTP 를 쓰지 않는 순수 함수만 둔다.
#        그래서 tests/test_planning.py 에서 MySQL·재고 서버 없이 규칙을 검증할 수 있다.
# 사용 : app/routers/work_orders.py
#
# 핵심 규칙 (SPEC 1장)
#   1) 사용 가능 수량 = 재고 − 대기(WAIT) 작업지시의 소요량.
#      → 재고 서버에 "대기 작업지시 수량 + 새 계획 수량"을 합쳐 보내 부족을 판정한다.
#   2) 등록할 때 같은 모델의 WAIT 작업지시가 있으면 새로 만들지 않고 수량을 합친다.
#      완료(DONE)된 작업지시에는 합치지 않는다.
#   예) 레드 3 등록 → 레드 2 등록 → 미니 2 등록  ⇒  작업지시 2건 (레드 5, 미니 2)
# ------------------------------------------------------------
from dataclasses import dataclass, field


def sum_by_tree(lines: list[tuple[str, int]]) -> dict[str, int]:
    """(트리 코드, 수량) 목록을 트리별 합계로 만든다. 수량 0 인 줄은 뺀다.

    Args:    lines — 예) [("T-CLASSIC", 3), ("T-MINI", 0), ("T-CLASSIC", 2)]
    Returns: 예) {"T-CLASSIC": 5}   (처음 나온 순서 유지)
    """
    total: dict[str, int] = {}
    for tree, qty in lines:
        if qty > 0:
            total[tree] = total.get(tree, 0) + qty
    return total


def waiting_by_tree(waiting_rows: list[dict]) -> dict[str, int]:
    """대기 중인 작업지시 행들을 트리별 대기 수량으로 합친다.

    Args:    waiting_rows — DB 행 [{"tree_code": "T-CLASSIC", "qty": 11, ...}, ...]
    Returns: {"T-CLASSIC": 11, ...}
    """
    return sum_by_tree([(r["tree_code"], int(r["qty"])) for r in waiting_rows])


def lines_for_check(*by_tree_maps: dict[str, int]) -> list[dict]:
    """여러 트리별 수량을 더해 재고 서버 check 요청 형식으로 바꾼다.

    Args:    by_tree_maps — 예) 대기 수량 {"T-CLASSIC": 11}, 새 계획 {"T-CLASSIC": 2}
    Returns: [{"treeCode": "T-CLASSIC", "qty": 13}]
    """
    total: dict[str, int] = {}
    for m in by_tree_maps:
        for tree, qty in m.items():
            total[tree] = total.get(tree, 0) + qty
    return [{"treeCode": t, "qty": q} for t, q in total.items() if q > 0]


@dataclass
class BatchPlan:
    """일괄 등록 때 DB 에 반영할 내용."""

    merges: list[tuple[int, int]] = field(default_factory=list)    # (작업지시 id, 합친 뒤 수량)
    creates: list[tuple[str, int]] = field(default_factory=list)   # (트리 코드, 수량) 새 작업지시


def plan_batch(waiting_rows: list[dict], new_by_tree: dict[str, int]) -> BatchPlan:
    """새 계획 수량을 기존 WAIT 작업지시에 합칠지, 새로 만들지 정한다.

    Args:    waiting_rows — WAIT 작업지시 행 [{"id", "tree_code", "qty"}, ...] (id 순)
             new_by_tree  — 새 계획의 트리별 수량 (sum_by_tree 결과)
    Returns: BatchPlan
    ※ 같은 모델의 WAIT 가 여러 건 있으면(정상 흐름에서는 생기지 않음) 가장 먼저 만든 것에 합친다.
    """
    first_wait: dict[str, dict] = {}
    for row in waiting_rows:
        first_wait.setdefault(row["tree_code"], row)
    result = BatchPlan()
    for tree, qty in new_by_tree.items():
        if tree in first_wait:
            row = first_wait[tree]
            result.merges.append((row["id"], int(row["qty"]) + qty))
        else:
            result.creates.append((tree, qty))
    return result


def waiting_after_edit(waiting_rows: list[dict], wo_id: int, new_qty: int) -> dict[str, int]:
    """작업지시 하나의 수량을 바꿨다고 가정한 트리별 대기 수량 (수량 수정 전 부족 판정용).

    Args:    waiting_rows — WAIT 작업지시 행들, wo_id — 바꿀 작업지시, new_qty — 새 수량 (0 = 삭제)
    Returns: {"T-CLASSIC": ..., ...}
    """
    return sum_by_tree([
        (r["tree_code"], new_qty if r["id"] == wo_id else int(r["qty"])) for r in waiting_rows
    ])


def format_wo_no(mmdd: str, seq: int) -> str:
    """작업지시 번호를 만든다. 날짜별로 001 부터 매긴다.

    Args:    mmdd — 등록 날짜 월일 (예: "1201"), seq — 그날의 순번
    Returns: 예) "WO-1201-003"
    """
    return f"WO-{mmdd}-{seq:03d}"
