/* ------------------------------------------------------------
 * js/api.js — 서버 API 호출 모음 (jQuery $.ajax)
 * 역할 : 화면 코드가 서버 주소·응답 형식을 몰라도 되게 감싼다.
 *        모든 요청은 같은 주소(http://factoryflow.test)로 보내고, erp-proxy 가 경로를 보고 나눈다.
 *          /api/auth/*, /api/inventory/*  → erp-inventory-api (PHP)
 *          /api/production/*              → erp-production-api-1~3 (FastAPI, 라운드로빈)
 *        같은 출처라서 브라우저가 세션 쿠키(FFSESSID)를 두 서버에 자동으로 함께 보낸다 (CORS 불필요).
 *
 * 공통 응답 형식 (두 서버 동일)
 *   성공 : { success: true,  data, servedBy }
 *   실패 : { success: false, error: { code, message, details? }, servedBy }
 *
 * 사용 : Api.login('santa', 'santa123').then(res => ...).catch(err => ...)
 *        then 에는 { data, servedBy }, catch 에는 ApiError 가 들어온다.
 * ------------------------------------------------------------ */
'use strict';

/**
 * 서버가 돌려준 실패(4xx·5xx) 또는 통신 실패를 나타내는 오류.
 * status 0 은 서버에 닿지 못한 경우(프록시·컨테이너 중지 등)다.
 */
class ApiError extends Error {
  /**
   * @param {number} status   HTTP 상태 코드
   * @param {string} code     서버 오류 코드 (예: UNAUTHORIZED, INSUFFICIENT_STOCK)
   * @param {string} message  화면에 보여줄 한국어 메시지
   * @param {Array}  details  부족 자재 목록 등
   * @param {string} servedBy 응답한 컨테이너 이름
   */
  constructor(status, code, message, details = [], servedBy = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.servedBy = servedBy;
  }
}

const Api = (() => {
  /** 401(로그인 필요)을 받았을 때 화면이 등록해 두는 처리 함수 (app.js 가 로그인 화면으로 보냄) */
  let onUnauthorized = () => {};

  /**
   * 공통 요청 함수.
   *
   * @param {string} method HTTP 메서드
   * @param {string} url    경로 (예: /api/production/session)
   * @param {object} [body] JSON 으로 보낼 본문
   * @returns {Promise<{data:any, servedBy:string}>}
   * @throws  {ApiError} 실패 응답 또는 통신 실패
   */
  function request(method, url, body) {
    return new Promise((resolve, reject) => {
      $.ajax({
        method,
        url,
        contentType: body === undefined ? undefined : 'application/json',
        data: body === undefined ? undefined : JSON.stringify(body),
        dataType: 'json',
        cache: false,        // GET 에 시각 값을 붙여 브라우저 캐시를 피한다 (세션·재고는 항상 최신)
        timeout: 10000,
      })
        .done(res => resolve({ data: res.data, servedBy: res.servedBy }))
        .fail(xhr => {
          const res = xhr.responseJSON;
          const err = res && res.error
            ? new ApiError(xhr.status, res.error.code, res.error.message, res.error.details || [], res.servedBy || '')
            : new ApiError(xhr.status, 'NETWORK_ERROR', '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
          // 로그인 요청 자체의 401(비밀번호 틀림)은 화면이 직접 처리하므로 제외한다
          if (err.status === 401 && url !== '/api/auth/login') onUnauthorized(err);
          reject(err);
        });
    });
  }

  return {
    ApiError,
    /** 401 처리 함수 등록 */
    setUnauthorizedHandler(fn) { onUnauthorized = fn; },

    // ---- 인증·세션 (erp-inventory-api, PHP) ----
    /** 로그인. 성공하면 서버가 FFSESSID 쿠키를 내려준다 */
    login: (username, password) => request('POST', '/api/auth/login', { username, password }),
    /** 로그아웃. Redis 세션이 지워져 두 서버 모두 401 이 된다 */
    logout: () => request('POST', '/api/auth/logout'),
    /** PHP 가 읽은 세션 정보 */
    inventorySession: () => request('GET', '/api/inventory/session'),

    // ---- 생산 서버 (erp-production-api-1~3, FastAPI) ----
    /** FastAPI 가 같은 쿠키로 읽은 세션 정보. servedBy 로 어느 복제본이 응답했는지 알 수 있다 */
    productionSession: () => request('GET', '/api/production/session'),
  };
})();
