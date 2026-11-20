/* ------------------------------------------------------------
 * js/modals.js — 산타 팝업: [자재 입고], [수량 수정]
 * 역할 : 팝업을 열 때 서버 데이터를 새로 받아 채우고, 저장하면 API 를 부른 뒤 화면을 다시 그린다.
 *   [자재 입고]  POST  /api/inventory/receipts          (대시보드 자재 현황, 생산계획 부족 자재, 재고 탭)
 *   [수량 수정]  PATCH /api/production/work-orders/{id} (대시보드 현재 작업지시)
 * 등록 : Actions['receive'], Actions['edit-qty'], Forms['receive-form'], Forms['edit-form']
 * 의존 : js/api.js, js/store.js, js/app.js(Actions·Forms·toast·render)
 * ------------------------------------------------------------ */
'use strict';

/** 입고 팝업의 공급처 기본값 */
const DEFAULT_SUPPLIER = '북극 장식상사';

/**
 * [자재 입고] 팝업을 연다.
 * @param {string} [code] 미리 고를 자재 (없으면 재고 비율이 가장 낮은 자재)
 * @param {number} [qty]  미리 채울 수량 (생산계획 화면의 부족 수량)
 */
async function openReceive(code, qty) {
  const data = await Store.load();
  const mats = data.mats.slice();
  const lowest = mats.slice().sort((a, b) => a.stock / a.safetyStock - b.stock / b.safetyStock)[0];
  const selected = code || (lowest && lowest.code);
  $q('#layer').innerHTML = `<div class="overlay" data-action="close-layer"><form class="modal" id="receive-form">
    <div class="panel-head"><h2>자재 입고 등록</h2></div>
    <div class="panel-body">
      <div class="field"><label for="rc-item">자재</label><select id="rc-item">${mats.map(i =>
        `<option value="${esc(i.code)}" ${i.code === selected ? 'selected' : ''}>${esc(i.name)} (재고 ${fmt(i.stock)} / 안전재고 ${fmt(i.safetyStock)})</option>`).join('')}</select></div>
      <div class="field"><label for="rc-qty">입고 수량</label><input id="rc-qty" type="number" min="1" max="10000" value="${qty > 0 ? qty : 10}" required></div>
      <div class="field"><label for="rc-sup">공급처</label><input id="rc-sup" maxlength="100" value="${DEFAULT_SUPPLIER}"></div>
      <div class="err" id="rc-err" role="alert"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-action="close-layer">취소</button><button class="btn primary" type="submit">입고</button></div>
  </form></div>`;
  $q('#rc-qty').focus();
}

/**
 * 입고 저장: 재고 서버가 재고 증가와 수불 이력(RECEIPT)을 한 트랜잭션으로 기록한다.
 * 실패(400 등)하면 팝업 안에 메시지를 보여준다.
 */
async function submitReceive(form) {
  const code = $q('#rc-item').value, qty = Number($q('#rc-qty').value), supplier = $q('#rc-sup').value.trim();
  if (!(qty >= 1)) { $q('#rc-err').textContent = '입고 수량은 1 이상이어야 합니다.'; return; }
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const { data } = await Api.receipt(code, qty, supplier);
    closeLayer();
    toast(`${data.name} ${fmt(data.qty)}개를 입고했습니다.`, { meta: `재고 ${fmt(data.stock)}` });
    render();   // 재고·사용 가능 수량·부족 판정을 서버 값으로 다시 그린다
  } catch (err) {
    $q('#rc-err').textContent = err.message;
    btn.disabled = false;
  }
}

/** [수량 수정] 팝업: 대기 중인 작업지시마다 수량 입력칸 */
async function openEditQty() {
  const data = await Store.load();
  if (!data.waiting.length) { toast('수정할 대기 작업지시가 없습니다.'); return; }
  $q('#layer').innerHTML = `<div class="overlay" data-action="close-layer"><form class="modal" id="edit-form">
    <div class="panel-head"><h2>작업지시 수량 수정</h2></div>
    <div class="panel-body">
      ${data.waiting.map(o => `<div class="edit-row"><label for="edit-qty-${o.id}">${esc(data.item(o.treeCode).name)}<span class="mono hint">${esc(o.woNo)}</span></label>
        <input class="qty-input" id="edit-qty-${o.id}" type="number" min="0" max="10000" value="${o.qty}" data-id="${o.id}" data-before="${o.qty}" data-wo="${esc(o.woNo)}"><span>그루</span></div>`).join('')}
      <p class="hint" style="margin:0">완료된 작업지시는 수정할 수 없습니다. 0으로 저장하면 해당 작업지시가 삭제됩니다.</p>
      <div class="err" id="edit-err" role="alert"></div>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-action="close-layer">취소</button><button class="btn primary" type="submit">저장</button></div>
  </form></div>`;
}

/**
 * 수량 수정 저장. 바뀐 작업지시만 하나씩 PATCH 한다.
 * 줄이는 것부터 보내야 늘리는 쪽이 줄어든 예약량만큼 자재를 쓸 수 있다.
 * 중간에 409(자재 부족)가 나면 거기서 멈추고, 이미 저장된 줄과 실패한 줄을 알려준다.
 */
async function submitEditQty(form) {
  const changes = [...form.querySelectorAll('input[data-id]')]
    .map(el => ({ id: Number(el.dataset.id), woNo: el.dataset.wo, before: Number(el.dataset.before), qty: Math.max(0, Math.floor(Number(el.value) || 0)) }))
    .filter(c => c.qty !== c.before)
    .sort((a, b) => (a.qty - a.before) - (b.qty - b.before));   // 많이 줄이는 것부터
  if (!changes.length) { closeLayer(); return; }

  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  const saved = [];
  for (const c of changes) {
    try {
      await Api.updateWorkOrder(c.id, c.qty);
      saved.push(c.woNo);
    } catch (err) {
      const short = (err.details || []).map(d => `${d.name} ${d.short}개`).join(', ');
      $q('#edit-err').textContent = `${c.woNo}: ${err.message}${short ? ` (부족: ${short})` : ''}`
        + (saved.length ? ` · 먼저 저장됨: ${saved.join(', ')}` : '');
      btn.disabled = false;
      if (saved.length) render();   // 저장된 줄은 화면 뒤쪽에 반영해 둔다
      return;
    }
  }
  closeLayer();
  toast('작업지시 수량을 수정했습니다.');
  render();
}

Object.assign(Actions, {
  receive: el => openReceive(el.dataset.item, Number(el.dataset.qty) || 0),
  'edit-qty': () => openEditQty(),
});
Object.assign(Forms, {
  'receive-form': submitReceive,
  'edit-form': submitEditQty,
});
