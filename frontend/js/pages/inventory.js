/* ------------------------------------------------------------
 * js/pages/inventory.js — 재고 탭 (산타·루돌프 공통, US-9)
 * 역할 : 탭 3개
 *   - 오너먼트·자재 : 재고, 대기 지시(예약량), 사용 가능, 안전재고, 상태
 *   - 완성 트리     : 트리별 재고
 *   - 수불 이력     : 일시, 품목, 구분(입고·생산투입·생산입고·출하), 수량, 처리자, 작업지시 번호, 비고
 *   산타에게만 [자재 입고] 버튼이 보인다 (modals.js 의 입고 팝업).
 * 사용 API : GET /api/inventory/items, /api/inventory/models, /api/production/work-orders,
 *            GET /api/inventory/transactions (수불 이력 탭을 열 때만)
 * ------------------------------------------------------------ */
'use strict';

/** 고른 탭 (화면 보기 설정이라 브라우저에 둔다): MAT | TREE | TX */
let inventoryTab = 'MAT';

/** 수불 이력 구분 코드 → 화면 이름 */
const TX_LABEL = { RECEIPT: '입고', CONSUME: '생산투입', PRODUCE: '생산입고', SHIP: '출하' };

Pages.inventory = {
  /** @param {object} d Store.load() 결과 */
  async render(d) {
    const t = inventoryTab;
    let body;
    if (t === 'TX') {
      const { data: tx } = await Api.transactions(100);
      body = tx.length ? `<div class="table-wrap"><table>
        <thead><tr><th>일시</th><th>품목</th><th>구분</th><th class="r">수량</th><th class="r">잔량</th><th>처리자</th><th>작업지시</th><th>비고</th></tr></thead>
        <tbody>${tx.map(x => `<tr><td class="mono">${esc((x.at || '').slice(5, 16))}</td><td>${esc(x.itemName)}</td><td>${TX_LABEL[x.type] || esc(x.type)}</td>
          <td class="r num ${x.qty < 0 ? 'minus' : 'plus'}">${x.qty > 0 ? '+' : ''}${fmt(x.qty)}</td><td class="r num">${fmt(x.balanceAfter)}</td>
          <td>${esc(x.username)}</td><td class="mono hint">${esc(x.refNo || '-')}</td><td class="hint">${esc(x.memo || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="panel-body empty">아직 수불 이력이 없습니다.</div>';
    } else {
      const rows = t === 'MAT' ? d.mats : d.trees;
      body = `<div class="table-wrap"><table>
        <thead><tr><th>품목</th><th>코드</th><th class="r">재고</th>${t === 'MAT' ? '<th class="r">대기 지시</th><th class="r">사용 가능</th><th class="r">안전재고</th><th>상태</th>' : ''}</tr></thead>
        <tbody>${rows.map(i => {
          const rsv = t === 'MAT' ? d.reserved(i.code) : 0;
          return `<tr><td>${esc(i.name)}</td><td class="mono hint">${esc(i.code)}</td><td class="r num">${fmt(i.stock)}</td>
            ${t === 'MAT' ? `<td class="r num ${rsv ? 'minus' : 'hint'}">${rsv ? '−' + fmt(rsv) : '-'}</td><td class="r num">${fmt(d.avail(i.code))}</td>
              <td class="r num">${fmt(i.safetyStock)}</td><td>${stockPill(i.stock, i.safetyStock)}</td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>`;
    }
    return `
    <div class="panel">
      <div class="panel-head" style="padding-bottom:0;border-bottom:0">
        <div class="tabs" role="tablist" style="padding:0;border:0">
          ${[['MAT', '오너먼트·자재'], ['TREE', '완성 트리'], ['TX', '수불 이력']].map(([k, v]) =>
            `<button role="tab" aria-selected="${t === k}" data-action="inv-tab" data-t="${k}">${v}</button>`).join('')}
        </div>
        ${isAdmin() ? '<div style="padding-bottom:10px"><button class="btn" data-action="receive">자재 입고</button></div>' : ''}
      </div>
      <div style="border-top:1px solid var(--line)">${body}</div>
    </div>`;
  },
};

Object.assign(Actions, {
  'inv-tab': el => { inventoryTab = el.dataset.t; render(); },
});
