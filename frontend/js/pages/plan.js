/* ------------------------------------------------------------
 * js/pages/plan.js — 생산계획 (산타, 트리 모델 탭의 [최종 결정] 다음 단계)
 * 역할 (US-4)
 *   - 최종 주문 내역과 필요 오너먼트
 *   - 미달 재고: 주문 수량 그대로 만들 때 부족한 자재 (필요, 사용 가능, 부족)
 *   - 생산계획 입력: 모델별 계획 수량, 단독 최대, [재고에 맞추기], [주문 수량으로 되돌리기]
 *   - 부족 자재는 그 자리에서 [입고 등록] (modals.js 의 자재 입고 팝업)
 *   - 부족이 없을 때만 [작업지시 일괄 등록] 활성화 → 등록하면 대시보드로
 *
 * 부족 판정 : 화면을 그릴 때마다 생산 서버 POST /api/production/plans/check 를 부른다.
 *            서버가 "대기 작업지시 + 이 계획"을 합쳐 재고 서버에 확인하므로 사용 가능 수량 기준이다.
 *            등록 버튼을 누르면 서버가 저장 직전에 한 번 더 확인하고, 그사이 바뀌었으면 409 를 준다.
 * 표시 변환 : 서버 부족 목록의 need 는 대기 지시 몫을 포함한 전체 필요량이므로,
 *            화면에는 "이번 계획 필요량 = need − 예약량", "사용 가능 = 재고 − 예약량"으로 보여준다.
 * ------------------------------------------------------------ */
'use strict';

Pages.plan = {
  /** @param {object} d Store.load() 결과 */
  async render(d) {
    if (!Draft.plan.length) {
      return `<div class="panel"><div class="panel-body empty">최종 결정된 주문이 없습니다.<br>
        <button class="btn small" data-action="goto" data-to="models" style="margin-top:10px">트리 모델로 가기</button></div></div>`;
    }
    // 주문 수량 그대로 / 계획 수량 두 경우를 서버에 동시에 확인한다
    const [orderCheck, planCheck] = await Promise.all([
      Api.checkPlan(Draft.plan.map(l => ({ treeCode: l.treeCode, qty: l.orderQty }))),
      Api.checkPlan(Draft.plan.map(l => ({ treeCode: l.treeCode, qty: l.planQty }))),
    ]);
    const orderShort = toView(d, orderCheck.data.shortages);
    const planShort = toView(d, planCheck.data.shortages);
    const total = Draft.plan.reduce((n, l) => n + l.planQty, 0);
    const orderTotal = Draft.plan.reduce((n, l) => n + l.orderQty, 0);

    return `
    <ol class="steps"><li class="done">트리 모델 · 주문 담기</li><li class="done">최종 결정</li><li class="now">생산계획 입력</li><li>작업지시 일괄 등록</li></ol>
    <div class="decided">
      <div class="panel">
        <div class="panel-head"><h2>최종 주문 내역</h2><span class="pill ok">총 ${fmt(orderTotal)}그루</span></div>
        <div class="table-wrap"><table><thead><tr><th>트리 모델</th><th class="r">주문 수량</th><th>필요 오너먼트</th></tr></thead>
          <tbody>${Draft.plan.map(l => `<tr><td>${esc(d.item(l.treeCode).name)}</td><td class="r num">${fmt(l.orderQty)}</td>
            <td class="hint">${d.model(l.treeCode).bom.map(b => `${esc(b.name)} ${fmt(b.qtyPerTree * l.orderQty)}`).join(', ')}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <div class="panel short-panel ${orderShort.length ? 'has' : ''}">
        <div class="panel-head"><h2>미달 재고</h2>${orderShort.length ? `<span class="pill crit">${orderShort.length}종 부족</span>` : '<span class="pill ok">부족 없음</span>'}</div>
        ${orderShort.length ? `<div class="table-wrap"><table><thead><tr><th>자재</th><th class="r">필요</th><th class="r">사용 가능</th><th class="r">부족</th></tr></thead>
          <tbody>${orderShort.map(x => `<tr><td>${esc(x.name)}</td><td class="r num">${fmt(x.need)}</td><td class="r num">${fmt(x.have)}</td><td class="r num minus">${fmt(x.short)}</td></tr>`).join('')}</tbody></table></div>
          <div class="panel-body hint">주문 수량 그대로는 생산할 수 없습니다. 아래에서 계획 수량을 줄이거나 자재를 입고하세요.</div>`
        : '<div class="panel-body">주문 수량 그대로 생산할 수 있습니다.</div>'}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>생산계획 입력</h2><span class="hint">사용 가능 = 재고 − 대기 중인 작업지시 소요량</span></div>
      <div class="table-wrap"><table class="plan-table">
        <thead><tr><th>트리 모델</th><th class="r">주문 수량</th><th class="r">단독 최대</th><th class="r" style="width:130px">계획 수량</th><th>상태</th></tr></thead>
        <tbody>${Draft.plan.map((l, idx) => {
          const max = d.capacity(l.treeCode);
          return `<tr><td>${esc(d.item(l.treeCode).name)}</td><td class="r num">${fmt(l.orderQty)}</td><td class="r num">${fmt(max)}</td>
            <td class="r"><input class="qty-input" id="plan-qty-${idx}" type="number" min="0" max="10000" value="${l.planQty}" data-change="plan-qty" data-idx="${idx}"></td>
            <td>${l.planQty > max ? `<span class="pill warn">최대 ${fmt(max)}그루</span>` : l.planQty < l.orderQty ? '<span class="pill wait">주문보다 적게</span>' : '<span class="pill ok">주문대로</span>'}</td></tr>`;
        }).join('')}</tbody></table></div>
      <div class="short-box ${planShort.length ? '' : 'ok'}">
        ${planShort.length ? `<strong>이 계획으로는 ${planShort.length}종이 부족합니다</strong>${planShort.map(s => `
          <div class="short-item"><span>${esc(s.name)} · 필요 <span class="num">${fmt(s.need)}</span>, 사용 가능 <span class="num">${fmt(s.have)}</span> → <strong class="num">${fmt(s.short)}</strong> 부족</span>
          <button class="btn small" data-action="receive" data-item="${esc(s.code)}" data-qty="${s.short}">입고 등록</button></div>`).join('')}`
        : total
          ? `<strong>계획한 ${fmt(total)}그루를 생산할 수 있습니다${d.waiting.length ? ' (대기 중인 작업지시 몫을 빼고 계산)' : ''}.</strong>`
          : '<strong>계획 수량을 1그루 이상 입력하세요.</strong>'}
      </div>
      <div class="panel-foot">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-action="plan-fit">재고에 맞추기</button>
          <button class="btn" data-action="plan-reset">주문 수량으로 되돌리기</button>
        </div>
        <button class="btn primary" data-action="plan-submit" ${planShort.length || !total ? 'disabled' : ''}>작업지시 일괄 등록</button>
      </div>
    </div>`;
  },
};

/**
 * 서버 부족 목록을 화면 표시용으로 바꾼다.
 * @param {object} d Store 데이터
 * @param {Array} shortages 서버 [{itemCode, name, need(대기 포함), stock, short}]
 * @returns {Array} [{code, name, need(이번 계획분), have(사용 가능), short}]
 */
function toView(d, shortages) {
  return shortages.map(s => ({
    code: s.itemCode, name: s.name,
    need: s.need - d.reserved(s.itemCode),
    have: d.avail(s.itemCode),
    short: s.short,
  }));
}

/**
 * 재고에 맞추기: 위 줄부터 남은 사용 가능 수량으로 만들 수 있는 만큼만 계획한다 (주문 수량이 상한).
 * 모델끼리 같은 자재(리본, 전나무)를 나눠 쓰므로 앞 줄이 쓴 만큼 빼면서 계산한다.
 */
async function fitPlan() {
  const d = await Store.load();
  const left = {};
  d.mats.forEach(i => { left[i.code] = d.avail(i.code); });
  Draft.plan.forEach(l => {
    const bom = d.model(l.treeCode).bom;
    const max = Math.max(0, Math.min(...bom.map(b => Math.floor(left[b.itemCode] / b.qtyPerTree))));
    l.planQty = Math.min(l.orderQty, max);
    bom.forEach(b => { left[b.itemCode] -= b.qtyPerTree * l.planQty; });
  });
  await render();
  toast('현재 재고로 만들 수 있는 수량으로 맞췄습니다.');
}

/**
 * 작업지시 일괄 등록. 성공하면 입력값을 비우고 대시보드로 간다.
 * 409(그사이 다른 계획이 등록되는 등으로 부족)면 서버가 준 부족 목록을 알리고 화면을 다시 그린다.
 */
async function submitPlan(btn) {
  btn.disabled = true;
  try {
    const { data } = await Api.createBatch(Draft.plan.map(l => ({ treeCode: l.treeCode, orderQty: l.orderQty, planQty: l.planQty })));
    Draft.reset();
    go('dashboard');
    toast([data.created.length && `작업지시 ${data.created.length}건을 새로 등록했습니다`,
           data.merged.length && `${data.merged.length}건은 같은 모델의 대기 중 작업지시에 수량을 합쳤습니다`]
      .filter(Boolean).join('. ') + '.');
  } catch (err) {
    const short = (err.details || []).map(s => `${s.name} ${s.short}개`).join(', ');
    toast(`${err.message}${short ? ` (부족: ${short})` : ''}`, { crit: true });
    btn.disabled = false;
    render();
  }
}

Object.assign(Actions, {
  'plan-fit': () => fitPlan(),
  'plan-reset': () => { Draft.plan.forEach(l => { l.planQty = l.orderQty; }); render(); },
  'plan-submit': el => submitPlan(el),
});

Object.assign(Changes, {
  /** 계획 수량 입력 → 서버에 다시 확인하고 같은 칸에 커서를 둔다 */
  'plan-qty': el => {
    const idx = Number(el.dataset.idx);
    Draft.plan[idx].planQty = Math.min(10000, Math.max(0, Math.floor(Number(el.value) || 0)));
    renderKeepFocus(`plan-qty-${idx}`);
  },
});
