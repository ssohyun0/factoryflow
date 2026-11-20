/* ------------------------------------------------------------
 * js/core.js — 모든 화면 파일이 함께 쓰는 공통 도구 (가장 먼저 불러온다)
 * 역할 : 로그인 사용자 상태, HTML 이스케이프, 알림(toast), 팝업 닫기,
 *        그리고 화면 파일이 자기 함수를 등록하는 객체(Pages·Actions·Forms·Changes)를 정의한다.
 * 불러오는 순서 (index.html) : jquery → core → api → store → tree-svg → modals → pages/* → app
 * ------------------------------------------------------------ */
'use strict';

// ---- 상태: 로그인 사용자만 기억한다 -----------------------------------
const state = {
  user: null,   // { userId, username, displayName, role, loginAt, sessionId }
};

// ---- 공통 도구 ---------------------------------------------------------
const $q = (s, el = document) => el.querySelector(s);
const isAdmin = () => state.user && state.user.role === 'ADMIN';
const ROLE_LABEL = { ADMIN: '생산관리자', WORKER: '현장 작업자' };

/**
 * 서버에서 받은 글자를 HTML 에 넣기 전에 특수문자를 바꾼다 (XSS 방지).
 * @param {any} v 출력할 값
 * @returns {string}
 */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 화면 오른쪽 아래에 알림을 잠깐 보여준다. 최근 3개만 남긴다.
 * @param {string} msg 본문
 * @param {{crit?:boolean, meta?:string}} opt crit=오류 색, meta=처리 서버 등 보조 정보
 */
function toast(msg, opt = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opt.crit ? ' crit' : '');
  el.innerHTML = `<div>${esc(msg)}</div>${opt.meta ? `<div class="meta">${esc(opt.meta)}</div>` : ''}`;
  const box = $q('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), 4500);
}
const closeLayer = () => { $q('#layer').innerHTML = ''; };

// ---- 화면 파일이 함수를 등록하는 곳 ----------------------------------------
const Pages = {};     // Pages.dashboard = { render: async (data) => HTML 문자열 }
const Actions = {};   // Actions['receive'] = (el, event) => ...   (data-action="receive" 클릭)
const Forms = {};     // Forms['receive-form'] = (form) => ...    (<form id="receive-form"> 제출)
const Changes = {};   // Changes['plan-qty'] = (el) => ...        (data-change="plan-qty" 입력값 변경)
