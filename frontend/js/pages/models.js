/* ------------------------------------------------------------
 * js/pages/models.js — ② 트리 모델 (산타)
 * 역할 : 모델을 고르면 BOM(1그루당 소요량)과 재고·대기 지시·사용 가능 수량, 트리 그림,
 *        "현재 재고로 생산 가능" 수량과 병목 자재를 보여준다.
 *        수량을 정해 [주문 목록에 담기] → 여러 모델을 담은 뒤 [최종 결정] → 생산계획 화면.
 *        같은 모델을 다시 담으면 수량이 합쳐진다 (US-3).
 * 상태 : 고른 모델·담은 주문은 아직 서버에 보내지 않은 입력값이라 Draft(store.js)에 둔다.
 * 사용 API : GET /api/inventory/models, /api/inventory/items, /api/production/work-orders
 * ------------------------------------------------------------ */
'use strict';

Pages.models = {
  /** @param {object} d Store.load() 결과 */
  render(d) {
    if (!d.model(Draft.selModel)) Draft.selModel = d.models[0].code;
    const m = d.model(Draft.selModel), cap = d.capacity(m.code), neck = d.bottleneck(m.code);
    return `
    <div class="models">
      <div class="panel">
        <div class="panel-head"><h2>트리 모델</h2></div>
        <div class="model-list">
          ${d.models.map(x => `<button data-action="pick-model" data-model="${esc(x.code)}" aria-pressed="${x.code === m.code}">
            <strong>${esc(x.name)}</strong><span class="code">${esc(x.code)} · 오너먼트 ${x.bom.length}종</span></button>`).join('')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${esc(m.name)} 구성 (BOM)</h2><span class="hint">트리 1그루당 소요량 · 고정</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>오너먼트 · 자재</th><th class="r">소요량</th><th class="r">현재 재고</th><th class="r">대기 지시</th><th class="r">사용 가능</th></tr></thead>
          <tbody>${m.bom.map(b => {
            const rsv = d.reserved(b.itemCode);
            return `<tr class="bom-row"><td>${esc(b.name)} <span class="hint mono">${esc(b.itemCode)}</span></td>
              <td class="r num">${b.qtyPerTree}</td><td class="r num">${fmt(d.item(b.itemCode).stock)}</td>
              <td class="r num ${rsv ? 'minus' : 'hint'}">${rsv ? '−' + fmt(rsv) : '-'}</td><td class="r num">${fmt(d.avail(b.itemCode))}</td></tr>`;
          }).join('')}</tbody></table></div>
        <div class="add-row" style="align-items:center">
          <label for="order-qty" style="font-weight:600">${esc(m.name)}</label>
          <input class="qty-input" id="order-qty" type="number" min="1" max="10000" value="${Draft.orderQty}">
          <span>그루</span>
          <button class="btn primary" data-action="order-add">주문 목록에 담기</button>
          <span class="hint">단독 최대 ${fmt(cap)}그루</span>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>미리보기</h2></div>
        <div class="preview">
          ${treeSvg(m)}
          <div class="cap-box"><span>현재 재고로 생산 가능</span><strong class="num">${fmt(cap)}그루</strong></div>
          <div class="hint">병목 자재: <strong>${esc(neck.name)}</strong> (사용 가능 ${fmt(d.avail(neck.itemCode))} ÷ ${neck.qtyPerTree})</div>
        </div>
      </div>
    </div>
    ${orderPanel(d)}`;
  },
};

/** 주문 목록 패널: 담은 모델과 수량, [빼기], [최종 결정] */
function orderPanel(d) {
  const list = Draft.orderList, total = list.reduce((n, l) => n + l.qty, 0);
  return `<div class="panel">
    <div class="panel-head"><h2>주문 목록</h2><span class="hint">모델을 바꿔 가며 여러 트리를 담을 수 있습니다</span></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>트리 모델</th><th class="r">수량</th><th></th></tr></thead><tbody>
      ${list.map((l, idx) => `<tr><td>${esc(d.item(l.treeCode).name)}</td><td class="r num">${fmt(l.qty)}그루</td>
        <td class="r"><button class="icon-btn" data-action="order-del" data-idx="${idx}" aria-label="${esc(d.item(l.treeCode).name)} 빼기">빼기</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="panel-body hint">아직 담은 트리가 없습니다. 위에서 수량을 정하고 [주문 목록에 담기]를 누르세요.</div>'}
    <div class="panel-foot"><span class="hint">${list.length}종 · ${fmt(total)}그루</span>
      <button class="btn primary" data-action="order-decide" ${list.length ? '' : 'disabled'}>최종 결정</button></div>
  </div>`;
}

Object.assign(Actions, {
  /** 왼쪽 목록에서 모델 선택 */
  'pick-model': el => { Draft.selModel = el.dataset.model; render(); },

  /** 주문 목록에 담기: 같은 모델이면 수량을 합친다 */
  'order-add': () => {
    const q = Math.min(10000, Math.max(1, Math.floor(Number($q('#order-qty').value) || 1)));
    const same = Draft.orderList.find(l => l.treeCode === Draft.selModel);
    if (same) same.qty += q; else Draft.orderList.push({ treeCode: Draft.selModel, qty: q });
    Draft.orderQty = q;
    render();
    toast(`${$q('[aria-pressed="true"] strong')?.textContent || Draft.selModel} ${q}그루를 주문 목록에 담았습니다.`);
  },

  /** 주문 목록에서 한 줄 빼기 */
  'order-del': el => { Draft.orderList.splice(Number(el.dataset.idx), 1); render(); },

  /** 최종 결정: 주문 수량을 계획 수량의 시작값으로 삼아 생산계획 화면으로 */
  'order-decide': () => {
    Draft.plan = Draft.orderList.map(l => ({ treeCode: l.treeCode, orderQty: l.qty, planQty: l.qty }));
    go('plan');
  },
});
