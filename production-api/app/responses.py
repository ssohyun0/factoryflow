# ------------------------------------------------------------
# app/responses.py
# 역할 : 공통 JSON 응답 형식과 API 오류 예외를 정의한다.
#        형식은 PHP 재고 서버(inventory-api/src/Http.php)와 같다.
#   성공 : { "success": true,  "data": {...}, "servedBy": "erp-production-api-2" }
#   실패 : { "success": false, "error": { "code", "message", "details"? }, "servedBy": ... }
# 사용 : 라우터 함수는 ok() 로 응답하고, 실패는 ApiError 를 raise 한다.
#        main.py 의 예외 처리기가 ApiError 를 실패 응답으로 바꾼다.
# ------------------------------------------------------------
from typing import Any

from fastapi.responses import JSONResponse

from app.config import SERVED_BY


class ApiError(Exception):
    """API 처리 중 의도한 오류(401, 403, 409 등)를 나타내는 예외."""

    def __init__(self, status: int, code: str, message: str, details: list | None = None):
        """
        Args: status  — HTTP 상태 코드
              code    — 화면에서 구분할 오류 코드 (예: UNAUTHORIZED)
              message — 사용자에게 보여줄 한국어 메시지
              details — 부족 자재 목록 등 추가 정보 (없으면 생략)
        """
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []


def ok(data: Any, status: int = 200) -> JSONResponse:
    """성공 응답을 만든다.

    Args:    data — 응답 데이터, status — HTTP 상태 코드 (기본 200)
    Returns: 공통 성공 형식의 JSONResponse
    """
    return _send(status, {"success": True, "data": data, "servedBy": SERVED_BY})


def fail(status: int, code: str, message: str, details: list | None = None) -> JSONResponse:
    """실패 응답을 만든다.

    Args:    status, code, message, details — ApiError 와 같음
    Returns: 공통 실패 형식의 JSONResponse
    """
    error: dict[str, Any] = {"code": code, "message": message}
    if details:
        error["details"] = details
    return _send(status, {"success": False, "error": error, "servedBy": SERVED_BY})


def _send(status: int, payload: dict) -> JSONResponse:
    """상태 코드와 본문으로 JSONResponse 를 만든다.
    세션·재고 정보는 캐시하면 안 되므로 Cache-Control: no-store 를 붙인다 (PHP 와 동일).
    """
    return JSONResponse(status_code=status, content=payload, headers={"Cache-Control": "no-store"})
