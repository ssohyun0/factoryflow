/* ------------------------------------------------------------
 * js/app.js — FactoryFlow 화면 (로그인, 메뉴, 화면 이동)
 * 역할 : 시안(docs/mockup)의 화면 구조를 옮기고, 데이터는 서버 API(api.js)에서 받는다.
 *        화면이 기억하는 값은 로그인 사용자 정보뿐이다. 재고·작업지시 등은 매번 서버에 묻는다.
 * 화면 이동 : 주소의 #해시 (#dashboard, #models, #plan, #work, #inventory)
 * 역할별 메뉴 : 산타(ADMIN) 대시보드·트리 모델·재고 / 루돌프(WORKER) 대시보드·작업·재고
 * 업무 화면 : js/pages/*.js 가 Pages(화면), Actions(버튼), Forms(폼 제출), Changes(입력 변경)에
 *            자기 함수를 등록하고, 이 파일이 화면 이동과 이벤트를 연결한다.
 * 화면 그리기 : 화면을 바꿀 때마다 Store.load() 로 서버 데이터를 새로 받아 그린다 (숫자를 기억하지 않음).
 * 의존 : jQuery, js/core.js, js/api.js, js/store.js, js/pages/*.js (이 파일을 맨 마지막에 불러온다)
 * ------------------------------------------------------------ */
'use strict';

// ---- 아이콘 (시안과 동일) ------------------------------------------------
const ICON = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2 6 10h3l-4 6h4l-3 4h12l-3-4h4l-4-6h3z"/><path d="M12 20v2"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 11h8M8 15h5"/></svg>',
  work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 21V10l5 3V10l5 3V6l8 4v11z"/><path d="M7 17h2M12 17h2M17 17h1"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7 12 3l9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>',
};
const TREE_LOGO = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 7 14h4l-5 7h18l-5-7h4z" fill="var(--pine)"/><rect x="13" y="21" width="4" height="5" fill="var(--gold)"/><circle cx="12" cy="17" r="1.6" fill="var(--berry)"/><circle cx="18" cy="12" r="1.6" fill="var(--berry)"/></svg>';

// ---- 라우팅: 역할별 탭 --------------------------------------------------
// nav=false 인 화면(생산계획)은 메뉴에 없고 트리 모델 탭의 [최종 결정]으로만 들어간다
const ROUTES = {
  dashboard: { title: '대시보드',        sub: '오늘 작업지시와 자재 현황',                        roles: ['ADMIN', 'WORKER'], nav: true },
  models:    { title: '트리 모델 (BOM)', sub: '트리 모델을 고르고 몇 그루 만들지 정합니다',       roles: ['ADMIN'],           nav: true },
  plan:      { title: '생산계획',        sub: '최종 주문 내역을 확인하고 오늘 생산할 수량을 정합니다', roles: ['ADMIN'],      nav: false },
  work:      { title: '작업',            sub: '작업지시대로 트리를 조립하고 완료를 누릅니다',     roles: ['WORKER'],          nav: true },
  inventory: { title: '재고',            sub: '자재·완성 트리 재고와 수불 이력',                  roles: ['ADMIN', 'WORKER'], nav: true },
};

/** 다른 화면으로 이동한다. 이미 그 화면이면 다시 그린다 (서버 데이터 새로 받음) */
const go = name => { if (location.hash.slice(1) === name) render(); else location.hash = name; };

/** 현재 #해시에 맞는 화면 이름. 없거나 권한이 없는 화면이면 대시보드 */
function route() {
  const h = location.hash.slice(1);
  return ROUTES[h] && ROUTES[h].roles.includes(state.user.role) ? h : 'dashboard';
}

/** 마지막으로 요청한 그리기 번호. 응답이 늦게 온 옛 그리기가 새 화면을 덮어쓰지 않게 한다 */
let renderSeq = 0;

/**
 * 화면 전체를 다시 그린다. 로그인 전이면 로그인 화면.
 * 서버 데이터를 먼저 받은 뒤 한 번에 바꿔서 화면이 깜빡이지 않게 한다.
 * @returns {Promise<void>}
 */
async function render() {
  const app = $q('#app');
  const seq = ++renderSeq;
  if (!state.user) { app.innerHTML = loginView(); $q('#login-id')?.focus(); return; }
  const r = route(), page = Pages[r];
  if (!app.querySelector('.shell')) app.innerHTML = shellView(r, '<div class="panel"><div class="panel-body empty">불러오는 중…</div></div>');
  let body;
  try {
    body = page ? await page.render(await Store.load()) : '<div class="panel"><div class="panel-body empty">준비 중인 화면입니다.</div></div>';
  } catch (err) {
    if (err.status === 401) return;   // 로그인 화면으로 이동은 Api 의 401 처리기가 한다
    body = `<div class="panel"><div class="panel-body empty minus">${esc(err.message)}<br><button class="btn small" data-action="reload" style="margin-top:10px">다시 시도</button></div></div>`;
  }
  if (seq !== renderSeq || !state.user) return;   // 그사이 다른 화면으로 이동했거나 로그아웃함
  app.innerHTML = shellView(r, body);
}

/**
 * 메뉴 + 상단 바 + 작업 영역 HTML.
 * @param {string} r    현재 화면 이름
 * @param {string} body 작업 영역에 넣을 HTML
 */
function shellView(r, body) {
  const R = ROUTES[r], u = state.user;
  const tabs = Object.entries(ROUTES).filter(([, v]) => v.nav && v.roles.includes(u.role));
  return `
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
      <section class="view">${body}</section>
    </div>
  </div>`;
}

/**
 * 입력칸 값을 바꾼 뒤 화면을 다시 그릴 때, 그 입력칸에 커서를 되돌려 놓는다.
 * @param {string} id 다시 포커스할 요소 id
 */
async function renderKeepFocus(id) {
  await render();
  const el = document.getElementById(id);
  if (el) { el.focus(); if (el.select) el.select(); }
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
  Draft.reset();
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
    case 'reload': render(); break;
    case 'close-layer':
      // 팝업 바깥 어두운 영역 또는 [닫기] 버튼을 눌렀을 때만 닫는다 (팝업 안쪽 클릭은 무시)
      if (e.target === el || el.tagName === 'BUTTON') closeLayer();
      break;
    default:
      if (Actions[el.dataset.action]) Actions[el.dataset.action](el, e);   // 화면 파일이 등록한 동작
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'login-form') submitLogin();
  else if (Forms[id]) Forms[id](e.target);
});

document.addEventListener('change', e => {
  const name = e.target.dataset && e.target.dataset.change;
  if (name && Changes[name]) Changes[name](e.target);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayer(); });
window.addEventListener('hashchange', () => { if (state.user) render(); });

// 세션이 끊기면(401: 만료·다른 탭에서 로그아웃) 로그인 화면으로 돌아간다
Api.setUnauthorizedHandler(() => {
  if (!state.user) return;
  state.user = null;
  Draft.reset();
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
