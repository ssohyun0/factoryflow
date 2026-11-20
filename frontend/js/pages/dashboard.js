/* ------------------------------------------------------------
 * js/pages/dashboard.js — ① 대시보드 (산타·루돌프 공통)
 * 역할 : 오늘 작업 현황을 한 화면에 보여준다. 모든 숫자는 Store.load() 의 서버 값에서 계산한다.
 *   - 상단 안내 + 산타 전용 [BOM 입력하기]
 *   - KPI 4개: 오늘 생산 완료, 남은 작업지시, 안전재고 미달 자재, 출하 대기 완성 트리
 *   - 현재 작업지시(위) → 자재 현황(아래): 화면 너비와 관계없이 위아래로 쌓는다
 *   - 현재 작업지시: 모델별 요약 한 줄 + 목록(번호, 트리, 수량, 상태, 처리 서버)
 *                   산타 [수량 수정] / 루돌프 [작업하러 가기]
 *   - 자재 현황: 재고 / 안전재고, 대기 지시(예약량), 상태 / 완성 트리 재고 / 산타 [자재 입고]
 * 사용 API : GET /api/inventory/items, /api/inventory/models, /api/production/work-orders
 * ------------------------------------------------------------ */
'use strict';

Pages.dashboard = {
  /** @param {object} d Store.load() 결과 */
  render(d) {
    // 재고 비율이 낮은 자재부터 (가장 급한 것이 위로)
    const mats = d.mats.slice().sort((a, b) => a.stock / a.safetyStock - b.stock / b.safetyStock);
    const low = d.mats.filter(i => i.stock < i.safetyStock);
    const today = todayStr();
    const doneToday = d.orders.filter(o => o.status === 'DONE' && (o.completedAt || '').startsWith(today))
      .reduce((n, o) => n + o.qty, 0);
    const treeSum = d.trees.reduce((n, t) => n + t.stock, 0);

    const bar = isAdmin()
      ? `<span class="hint">${d.planCountToday
          ? `오늘 생산계획을 ${d.planCountToday}번 등록했습니다. 추가로 만들 트리가 있으면 다시 입력하세요.`
          : '오늘 생산계획이 아직 없습니다. 트리 모델에서 주문을 담고 최종 결정하세요.'}</span>
         <button class="btn primary" data-action="goto" data-to="models">BOM 입력하기</button>`
      : `<span class="hint">${d.waiting.length ? '오늘 작업지시가 도착했습니다.' : '산타가 오늘 생산계획을 등록하면 작업지시가 표시됩니다.'}</span>`;

    return `
    <div class="dash-bar">${bar}</div>
    <div class="kpis">
      <div class="kpi"><span class="label">오늘 생산 완료</span><span class="value">${fmt(doneToday)}<small>그루</small></span></div>
      <div class="kpi"><span class="label">남은 작업지시</span><span class="value">${d.waiting.length}<small>건</small></span></div>
      <div class="kpi ${low.length ? 'alert' : ''}"><span class="label">안전재고 미달 자재</span><span class="value">${low.length}<small>종</small></span></div>
      <div class="kpi"><span class="label">출하 대기 완성 트리</span><span class="value">${fmt(treeSum)}<small>그루</small></span></div>
    </div>
    ${workOrderPanel(d)}
    <div class="panel">
      <div class="panel-head"><h2>자재 현황</h2>
        ${isAdmin() ? '<button class="btn small primary" data-action="receive">자재 입고</button>' : ''}</div>
      <div class="mat-list">
        <div class="mat-row mat-head"><span>자재</span><span></span><span>재고 / 안전재고</span><span class="rsv">대기 지시</span><span></span></div>
        ${mats.map(i => {
          const r = i.safetyStock ? i.stock / i.safetyStock : 1, rsv = d.reserved(i.code);
          return `<div class="mat-row"><span>${esc(i.name)}</span>
            <div class="bar"><i class="${r < 0.5 ? 'crit' : r < 1 ? '' : 'ok'}" style="width:${Math.min(100, Math.round(r * 100))}%"></i></div>
            <span class="num">${fmt(i.stock)} / ${fmt(i.safetyStock)}</span>
            <span class="rsv num ${rsv ? 'minus' : 'hint'}" title="대기 중인 작업지시가 쓸 수량">${rsv ? '−' + fmt(rsv) : '-'}</span>${stockPill(i.stock, i.safetyStock)}</div>`;
        }).join('')}
      </div>
      <div class="tree-stock"><span class="hint">완성 트리</span>${d.trees.map(t => `<span>${esc(d.shortName(t.code))} <strong class="num">${fmt(t.stock)}</strong></span>`).join('')}</div>
    </div>`;
  },
};

/**
 * 현재 작업지시 패널: 모델별 요약 한 줄 + 목록 + 역할별 버튼.
 * 목록에는 대기 전부, 출하 전 완료분, 오늘 만들거나 완료한 작업지시가 나온다 (서버가 고른 범위).
 */
function workOrderPanel(d) {
  const os = d.orders;
  const editBtn = isAdmin() && d.waiting.length ? '<button class="btn small" data-action="edit-qty">수량 수정</button>' : '';
  if (!os.length) {
    return `<div class="panel"><div class="panel-head"><h2>현재 작업지시</h2></div>
      <div class="panel-body empty">오늘 등록된 작업지시가 없습니다.${isAdmin() ? '<br>[BOM 입력하기]로 생산계획을 시작하세요.' : ''}</div></div>`;
  }
  const sum = {};   // 모델별 합계 (예: 레드 트리 5, 미니 트리 2)
  os.forEach(o => { sum[o.treeCode] = (sum[o.treeCode] || 0) + o.qty; });
  const summary = Object.entries(sum).map(([code, q]) => `${esc(d.shortName(code))} ${fmt(q)}`).join(', ');
  return `<div class="panel">
    <div class="panel-head"><h2>현재 작업지시</h2>${editBtn}</div>
    <div class="wo-summary">${summary}</div>
    <div class="table-wrap"><table>
      <thead><tr><th>번호</th><th>트리</th><th class="r">수량</th><th>상태</th><th>처리 서버</th></tr></thead>
      <tbody>${os.map(o => `<tr><td class="mono">${esc(o.woNo)}</td><td>${esc(d.item(o.treeCode).name)}</td><td class="r num">${fmt(o.qty)}</td>
        <td>${o.status === 'DONE'
          ? `<span class="pill ok">완료 ${esc(hhmm(o.completedAt))}</span>${o.shipped ? ' <span class="pill wait">출하됨</span>' : ''}`
          : '<span class="pill wait">대기</span>'}</td>
        <td>${o.completedServer ? `<span class="server">${esc(o.completedServer)}</span>` : '<span class="hint">-</span>'}</td></tr>`).join('')}</tbody></table></div>
    ${isAdmin() ? '' : `<div class="panel-foot">
      <span class="hint">${d.waiting.length ? `${d.waiting.length}건 남음` : '모든 작업 완료'}${d.toShip.length ? ' · 출하할 트리가 있습니다' : ''}</span>
      <button class="btn primary" data-action="goto" data-to="work">작업하러 가기</button></div>`}
  </div>`;
}

Object.assign(Actions, {
  /** data-to 화면으로 이동 */
  goto: el => go(el.dataset.to),
});
