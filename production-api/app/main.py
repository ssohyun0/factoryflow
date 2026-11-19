# ------------------------------------------------------------
# app/main.py — erp-production-api 진입점
# 역할 : FastAPI 앱을 만들고, 공통 오류 처리기와 라우트를 등록한다.
# 실행 : uvicorn app.main:app --host 0.0.0.0 --port 8000 (Dockerfile CMD)
#
# 경로
#   GET /api/production/session   세션 정보 + servedBy(응답한 컨테이너 hostname)
#                                 → PHP 의 /api/inventory/session 과 sessionId·사용자가 같으면 세션 공유,
#                                   여러 번 호출해 servedBy 가 3종 나오면 분산이 증명된다.
#   (작업지시·생산계획·출하 API 는 T9, T10 에서 추가)
# ------------------------------------------------------------
import platform

import fastapi
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.responses import ApiError, fail, ok
from app.session import SessionUser, get_current_user

# docs_url 등을 끈다: 외부에 API 문서를 노출하지 않는다
app = FastAPI(title="FactoryFlow 생산 서비스", docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, e: ApiError):
    """의도한 오류(401/403/409 등)를 공통 실패 응답으로 바꾼다."""
    return fail(e.status, e.code, e.message, e.details)


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(request: Request, e: StarletteHTTPException):
    """없는 경로(404), 허용하지 않는 메서드(405)도 공통 형식으로 응답한다."""
    if e.status_code == 404:
        return fail(404, "NOT_FOUND", f"요청한 API가 없습니다: {request.method} {request.url.path}")
    if e.status_code == 405:
        return fail(405, "METHOD_NOT_ALLOWED", "허용하지 않는 HTTP 메서드입니다.")
    return fail(e.status_code, "HTTP_ERROR", str(e.detail))


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, e: RequestValidationError):
    """요청 본문·경로 값 형식 오류를 400 으로 응답한다 (FastAPI 기본값 422 대신 PHP 와 같은 400)."""
    details = [{"field": ".".join(str(p) for p in err["loc"]), "message": err["msg"]} for err in e.errors()]
    return fail(400, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", details)


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, e: Exception):
    """예상하지 못한 오류. 내용은 docker logs 에만 남기고 응답에는 노출하지 않는다."""
    print(f"[Error] {request.method} {request.url.path}: {e!r}")
    return fail(500, "INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.")


@app.get("/api/production/session")
def session_info(user: SessionUser = Depends(get_current_user)):
    """세션 확인 (세션 공유·분산 증명용).

    Returns: { sessionId, userId, username, displayName, role, loginAt, server: "Python 3.11 / FastAPI ..." }
    Raises:  401 — 로그인하지 않았거나 세션이 만료됨
    """
    server = f"Python {platform.python_version()} / FastAPI {fastapi.__version__}"
    return ok(user.to_api() | {"server": server})
