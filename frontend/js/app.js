/* ------------------------------------------------------------
 * js/app.js — FactoryFlow 화면 (로그인, 메뉴, 화면 이동)
 * 역할 : 시안(docs/mockup)의 화면 구조를 옮기고, 데이터는 서버 API(api.js)에서 받는다.
 *        화면이 기억하는 값은 로그인 사용자 정보뿐이다. 재고·작업지시 등은 매번 서버에 묻는다.
 * 화면 이동 : 주소의 #해시 (#dashboard, #models, #plan, #work, #inventory)
 * 역할별 메뉴 : 산타(ADMIN) 대시보드·트리 모델·재고 / 루돌프(WORKER) 대시보드·작업·재고
 * 업무 화면 : T11(산타 화면), T12(루돌프·재고 화면)에서 js/pages/*.js 로 채운다.
 * 의존 : jQuery, js/api.js
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

// ---- 아이콘 (시안과 동일) ------------------------------------------------
const ICON = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2 6 10h3l-4 6h4l-3 4h12l-3-4h4l-4-6h3z"/><path d="M12 20v2"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 11h8M8 15h5"/></svg>',
  work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 21V10l5 3V10l5 3V6l8 4v11z"/><path d="M7 17h2M12 17h2M17 17h1"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7 12 3l9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>',
};
const TREE_LOGO = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 7 14h4l-5 7h18l-5-7h4z" fill="var(--pine)"/><rect x="13" y="21" width="4" height="5" fill="var(--gold)"/><circle cx="12" cy="17" r="1.6" fill="var(--berry)"/><circle cx="18" cy="12" r="1.6" fill="var(--berry)"/></svg>';

/** 아직 연결하지 않은 업무 화면의 임시 내용 (T11, T12 에서 교체) */
const pending = task => () => `<div class="panel"><div class="panel-body empty">이 화면은 ${task}에서 서버 API와 연결합니다.</div></div>`;

// ---- 라우팅: 역할별 탭 --------------------------------------------------
// render 는 HTML 문자열을 돌려주는 함수. nav=false 인 화면(생산계획)은 메뉴에 없고 단계 이동으로만 들어간다
const ROUTES = {
  dashboard: { title: '대시보드',        sub: '오늘 작업지시와 자재 현황',                        render: pending('T11'), roles: ['ADMIN', 'WORKER'], nav: true },
  models:    { title: '트리 모델 (BOM)', sub: '트리 모델을 고르고 몇 그루 만들지 정합니다',       render: pending('T11'), roles: ['ADMIN'],           nav: true },
  plan:      { title: '생산계획',        sub: '최종 주문 내역을 확인하고 오늘 생산할 수량을 정합니다', render: pending('T11'), roles: ['ADMIN'],      nav: false },
  work:      { title: '작업',            sub: '작업지시대로 트리를 조립하고 완료를 누릅니다',     render: pending('T12'), roles: ['WORKER'],          nav: true },
  inventory: { title: '재고',            sub: '자재·완성 트리 재고와 수불 이력',                  render: pending('T12'), roles: ['ADMIN', 'WORKER'], nav: true },
};

/** 현재 #해시에 맞는 화면 이름. 없거나 권한이 없는 화면이면 대시보드 */
function route() {
  const h = location.hash.slice(1);
  return ROUTES[h] && ROUTES[h].roles.includes(state.user.role) ? h : 'dashboard';
}

/** 화면 전체를 다시 그린다. 로그인 전이면 로그인 화면 */
function render() {
  const app = $q('#app');
  if (!state.user) { app.innerHTML = loginView(); $q('#login-id')?.focus(); return; }
  const r = route(), R = ROUTES[r], u = state.user;
  const tabs = Object.entries(ROUTES).filter(([, v]) => v.nav && v.roles.includes(u.role));
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand">${TREE_LOGO}<div>FactoryFlow<small>북극 트리 공장 ERP</small></div></div>
      <nav class="nav" aria-label="주 메뉴">
        ${tabs.map(([k, v]) => `<a href="#${k}" ${k === r || (r === 'plan' && k === 'models') ? 'aria-current="page"' : ''}>${ICON[k]}${v.title.replace(' (BOM)', '')}</a>`).join('')}
      </nav>
    </aside>
    <div class="main">
      <header class="top">
        <div><h1>${R.title}</h1><div class="sub">${R.sub}</div></div>
        <div class="top-actions">
          <span class="user-chip"><span class="avatar ${isAdmin() ? '' : 'worker'}">${esc(u.username[0].toUpperCase())}</span>${esc(u.username)} · ${esc(u.displayName)} · ${ROLE_LABEL[u.role] || esc(u.role)}</span>
          <button class="btn" data-action="logout">로그아웃</button>
        </div>
      </header>
      <section class="view">${R.render()}</section>
    </div>
  </div>`;
}

// ---- 로그인 -------------------------------------------------------------
function loginView() {
  return `
  <div class="login-wrap">
    <form class="login-card" id="login-form">
      <h1>${TREE_LOGO} FactoryFlow</h1>
      <p class="hint" style="margin:0">북극 트리 공장 생산·재고 관리 시스템</p>
      <div class="field"><label for="login-id">아이디</label><input id="login-id" autocomplete="username" required></div>
      <div class="field"><label for="login-pw">비밀번호</label><input id="login-pw" type="password" autocomplete="current-password" required></div>
      <div class="err" id="login-err" role="alert"></div>
      <button class="btn primary" type="submit" id="login-btn" style="justify-content:center;padding:10px">로그인</button>
      <div class="accounts">
        <button type="button" class="btn small" data-action="fill" data-id="santa">santa · 산타</button>
        <button type="button" class="btn small" data-action="fill" data-id="reindeer">reindeer · 루돌프</button>
      </div>
    </form>
  </div>`;
}

/**
 * 로그인 폼 제출: PHP 에 아이디·비밀번호를 보내고, 성공하면 대시보드로 이동한다.
 * 실패(401)하면 폼 아래에 메시지를 보여준다.
 */
async function submitLogin() {
  const username = $q('#login-id').value.trim(), password = $q('#login-pw').value;
  const btn = $q('#login-btn');
  btn.disabled = true;
  try {
    const { data } = await Api.login(username, password);
    state.user = data;
    location.hash = 'dashboard';
    render();
    toast(`${data.displayName}님, 환영합니다.`);
  } catch (err) {
    $q('#login-err').textContent = err.message;
    btn.disabled = false;
  }
}

/** 로그아웃: PHP 가 Redis 세션을 지운다. 이후에는 FastAPI 도 같은 쿠키로 401 이 된다 */
async function logout() {
  try {
    await Api.logout();
    toast('로그아웃했습니다.');
  } catch (err) {
    toast(err.message, { crit: true });
  }
  state.user = null;
  closeLayer();
  render();
}

// ---- 이벤트 연결 (data-action 속성으로 구분) ------------------------------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  switch (el.dataset.action) {
    case 'fill': $q('#login-id').value = el.dataset.id; $q('#login-pw').value = el.dataset.id + '123'; break;   // 시연용 계정 채우기
    case 'logout': logout(); break;
    case 'close-layer':
      // 팝업 바깥 어두운 영역 또는 [닫기] 버튼을 눌렀을 때만 닫는다 (팝업 안쪽 클릭은 무시)
      if (e.target === el || el.tagName === 'BUTTON') closeLayer();
      break;
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'login-form') submitLogin();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayer(); });
window.addEventListener('hashchange', () => { if (state.user) render(); });

// 세션이 끊기면(401: 만료·다른 탭에서 로그아웃) 로그인 화면으로 돌아간다
Api.setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  closeLayer();
  render();
  toast('세션이 만료되었습니다. 다시 로그인하세요.', { crit: true });
});

/**
 * 첫 화면: 새로고침해도 로그인이 유지되도록, 쿠키가 살아 있으면 PHP 에서 세션을 다시 받아온다.
 * (쿠키는 HttpOnly 라 자바스크립트로 읽을 수 없으므로 서버에 물어본다)
 */
(async function init() {
  try {
    const { data } = await Api.inventorySession();
    state.user = data;
  } catch (err) {
    state.user = null;   // 401 이면 로그인 화면
  }
  render();
})();
