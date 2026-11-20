/* ------------------------------------------------------------
 * js/pages/work.js — 작업 탭 (루돌프) + 출하 작업서 팝업
 * 역할 (US-7, US-8)
 *   - 작업지시마다 트리 그림, 필요 자재, [완료] 버튼. 완료하면 카드에 완료 시각과 "처리한 생산 서버"가 나온다.
 *   - 상단: 오늘 작업 진행률, [트리 출하] (완료했지만 출하하지 않은 작업지시가 있을 때만 활성화)
 *   - 출하 작업서: 줄마다 트리·출하처·수량 (줄 추가·삭제), 트리별 출하 합계 / 재고 표시
 *     [출하] 성공 → 대시보드로 이동 + 출하 완료 메시지. 재고 초과면 서버 409 를 팝업에 표시.
 * 사용 API : POST /api/production/work-orders/{id}/complete, POST /api/production/shipments
 *            (생산 서버가 재고 서버 /internal/stock/produce·ship 을 대신 호출한다)
 * ------------------------------------------------------------ */
'use strict';

/** 출하처 선택지 */
const DESTINATIONS = ['강남 물류센터', '부산 물류센터', '대전 허브', '산타 썰매 터미널'];

/** 출하 작업서 입력값 (팝업이 열려 있는 동안만 쓰고, 닫거나 출하하면 비운다) */
const ShipSheet = {
  rows: [],      // [{ treeCode, destination, qty }]
  data: null,    // 팝업을 연 시점의 Store 데이터 (트리 재고 표시용)
};

Pages.work = {
  /** @param {object} d Store.load() 결과 */
  render(d) {
    const os = d.orders;
    if (!os.length) {
      return '<div class="panel"><div class="panel-body empty">오늘 작업지시가 없습니다.<br>산타가 생산계획을 등록하면 여기에 나타납니다.</div></div>';
    }
    const done = os.filter(o => o.status === 'DONE').length;
    const shipQty = d.toShip.reduce((n, o) => n + o.qty, 0);
    return `
    <div class="work-bar panel">
      <div><strong>오늘 작업 ${done} / ${os.length} 완료</strong>
        <div class="bar" style="width:220px"><i class="ok" style="width:${Math.round(done / os.length * 100)}%"></i></div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="hint">${shipQty ? `완료한 트리 ${fmt(shipQty)}그루를 지금 출하할 수 있습니다.` : d.waiting.length ? '작업지시를 완료하면 바로 출하할 수 있습니다.' : '만든 트리를 모두 출하했습니다.'}</span>
        <button class="btn berry" data-action="ship-open" ${shipQty ? '' : 'disabled'}>트리 출하</button>
      </div>
    </div>
    <div class="work-grid">
      ${os.map(o => {
        const m = d.model(o.treeCode);
        return `<article class="panel work-card ${o.status === 'DONE' ? 'is-done' : ''}">
          <div class="work-tree">${treeSvg(m)}</div>
          <div class="work-info">
            <span class="mono hint">${esc(o.woNo)}</span>
            <h2>${esc(m.name)} <span class="num">× ${fmt(o.qty)}</span></h2>
            <p class="hint">${m.bom.map(b => `${esc(b.name)} ${fmt(b.qtyPerTree * o.qty)}`).join(' · ')}</p>
            ${o.status === 'DONE'
              ? `<span class="pill ok">완료 ${esc(hhmm(o.completedAt))}</span><span class="server">${esc(o.completedServer)}</span>${o.shipped ? '<span class="pill wait">출하됨</span>' : ''}`
              : `<button class="btn primary big" data-action="complete" data-id="${o.id}" data-name="${esc(m.name)}">완료</button>`}
          </div>
        </article>`;
      }).join('')}
    </div>`;
  },
};

/**
 * [완료]: 생산 서버가 재고 서버를 호출해 자재 차감 + 트리 입고를 한 트랜잭션으로 처리한다.
 * 알림에 처리한 생산 서버 이름을 보여준다 (3대 중 어느 것이 처리했는지).
 */
async function completeOrder(btn) {
  btn.disabled = true;
  try {
    const { data, servedBy } = await Api.completeWorkOrder(Number(btn.dataset.id));
    const o = data.order;
    toast(`${btn.dataset.name} ${fmt(o.qty)}그루 완료 (${o.woNo})`, { meta: `${servedBy} 처리 · 자재 ${data.consumed.length}종 차감` });
    await render();
    const d = await Store.load();
    if (d.orders.length && !d.waiting.length) toast('모든 작업지시를 완료했습니다.');
  } catch (err) {
    const short = (err.details || []).map(s => `${s.name} ${s.short}개`).join(', ');
    toast(`${err.message}${short ? ` (부족: ${short})` : ''}`, { crit: true, meta: err.servedBy ? `${err.servedBy} · 재고 변화 없음` : '' });
    render();
  }
}

// ---- 출하 작업서 ---------------------------------------------------------

/** [트리 출하]: 완료·미출하 수량을 트리별로 미리 채워 팝업을 연다 */
async function openShipSheet() {
  const d = await Store.load();
  ShipSheet.data = d;
  const made = {};
  d.toShip.forEach(o => { made[o.treeCode] = (made[o.treeCode] || 0) + o.qty; });
  ShipSheet.rows = Object.entries(made).map(([treeCode, qty]) => ({ treeCode, destination: DESTINATIONS[0], qty }));
  if (!ShipSheet.rows.length) ShipSheet.rows = [{ treeCode: d.trees[0].code, destination: DESTINATIONS[0], qty: 1 }];
  drawShipSheet();
}

/** 출하 작업서 팝업을 (다시) 그린다. 입력값은 ShipSheet.rows 에 있다 */
function drawShipSheet(errorText = '') {
  const d = ShipSheet.data, trees = d.trees;
  const sums = {};
  ShipSheet.rows.forEach(r => { sums[r.treeCode] = (sums[r.treeCode] || 0) + (r.qty || 0); });
  $q('#layer').innerHTML = `<div class="overlay" data-action="close-layer"><form class="modal wide" id="ship-form">
    <div class="panel-head"><h2>출하 작업서</h2></div>
    <div class="panel-body">
      <div class="table-wrap"><table class="ship-table">
        <thead><tr><th>트리</th><th>출하처</th><th class="r">수량</th><th></th></tr></thead>
        <tbody>${ShipSheet.rows.map((r, idx) => `<tr>
          <td><select id="ship-treeCode-${idx}" data-change="ship-field" data-idx="${idx}" data-field="treeCode">${trees.map(t =>
            `<option value="${esc(t.code)}" ${t.code === r.treeCode ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td>
          <td><select id="ship-destination-${idx}" data-change="ship-field" data-idx="${idx}" data-field="destination">${DESTINATIONS.map(dst =>
            `<option ${dst === r.destination ? 'selected' : ''}>${esc(dst)}</option>`).join('')}</select></td>
          <td class="r"><input class="qty-input" id="ship-qty-${idx}" type="number" min="1" max="10000" value="${r.qty}" data-change="ship-field" data-idx="${idx}" data-field="qty"></td>
          <td class="r"><button type="button" class="icon-btn" data-action="ship-del" data-idx="${idx}" aria-label="줄 삭제" ${ShipSheet.rows.length > 1 ? '' : 'disabled'}>삭제</button></td></tr>`).join('')}</tbody></table></div>
      <button type="button" class="btn small" data-action="ship-add" style="align-self:flex-start">출하처 추가</button>
      <div class="ship-sum">${trees.filter(t => sums[t.code]).map(t =>
        `<span class="${sums[t.code] > t.stock ? 'minus' : ''}">${esc(d.shortName(t.code))} 출하 <strong class="num">${fmt(sums[t.code])}</strong> / 재고 <span class="num">${fmt(t.stock)}</span></span>`).join('')}</div>
      <div class="err" id="ship-err" role="alert">${esc(errorText)}</div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-action="close-layer">취소</button><button class="btn berry" type="submit">출하</button></div>
  </form></div>`;
}

/**
 * [출하]: 수량 0 줄은 빼고 보낸다. 성공하면 대시보드로 가서 완료 메시지를 띄운다.
 * 재고 초과(409)면 서버 메시지를 팝업에 보여주고, 재고는 바뀌지 않는다.
 */
async function submitShipment(form) {
  const rows = ShipSheet.rows.filter(r => r.qty > 0);
  if (!rows.length) { $q('#ship-err').textContent = '출하할 수량을 1 이상 입력하세요.'; return; }
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await Api.ship(rows);
    const names = Object.fromEntries(ShipSheet.data.trees.map(t => [t.code, t.name]));
    ShipSheet.rows = [];
    go('dashboard');
    openShipDone(rows, names);
  } catch (err) {
    const over = (err.details || []).map(s => `${s.name} 재고 ${s.stock}그루 (요청 ${s.need})`).join(', ');
    drawShipSheet(`${err.message}${over ? ` · ${over}` : ''}`);
  }
}

/** 출하 완료 메시지 팝업. [대시보드 보기]로 닫는다 */
function openShipDone(rows, names) {
  $q('#layer').innerHTML = `<div class="overlay" data-action="close-layer"><div class="modal" role="dialog" aria-label="출하 완료">
    <div class="panel-body done-box">
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" fill="var(--ok-bg)"/><path d="M17 29l7 7 15-16" fill="none" stroke="var(--ok)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>출하를 완료했습니다</h2>
      <ul>${rows.map(r => `<li>${esc(names[r.treeCode] || r.treeCode)} <strong class="num">${fmt(r.qty)}그루</strong> → ${esc(r.destination)}</li>`).join('')}</ul>
      <p class="hint" style="margin:0">수불 이력에 출하 기록이 남았습니다.</p>
    </div>
    <div class="modal-foot"><button class="btn primary" data-action="close-layer">대시보드 보기</button></div>
  </div></div>`;
}

Object.assign(Actions, {
  complete: el => completeOrder(el),
  'ship-open': () => openShipSheet(),
  'ship-add': () => {
    const last = ShipSheet.rows[ShipSheet.rows.length - 1];
    ShipSheet.rows.push({ treeCode: last ? last.treeCode : ShipSheet.data.trees[0].code, destination: DESTINATIONS[1], qty: 1 });
    drawShipSheet();
  },
  'ship-del': el => { ShipSheet.rows.splice(Number(el.dataset.idx), 1); drawShipSheet(); },
});
Object.assign(Forms, { 'ship-form': submitShipment });
Object.assign(Changes, {
  /** 출하 작업서 입력 변경 → 합계를 다시 계산해 그리고 같은 칸에 커서를 둔다 */
  'ship-field': el => {
    const r = ShipSheet.rows[Number(el.dataset.idx)], f = el.dataset.field;
    r[f] = f === 'qty' ? Math.min(10000, Math.max(0, Math.floor(Number(el.value) || 0))) : el.value;
    drawShipSheet();
    document.getElementById(el.id)?.focus();
  },
});
