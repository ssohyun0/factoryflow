/* ------------------------------------------------------------
 * js/store.js — 화면 데이터 불러오기와 계산
 * 역할 : 화면을 그릴 때마다 서버에서 품목·BOM·작업지시를 새로 받아 Data 객체로 묶고,
 *        예약량(대기 지시)·사용 가능 수량·단독 최대 생산량 같은 파생 값을 계산한다.
 *        재고·작업지시 숫자는 브라우저에 보관하지 않는다 (항상 API 값에서 계산).
 *
 * 계산 규칙 (SPEC 1장 핵심 규칙과 같다)
 *   예약량(대기 지시) = Σ(대기 작업지시 수량 × 1그루당 소요량)
 *   사용 가능 수량    = 현재 재고 − 예약량
 *   단독 최대         = min(사용 가능 ÷ 소요량)  (BOM 의 자재 중 가장 부족한 것이 병목)
 *   ※ 최종 판정(409)은 언제나 서버가 한다. 여기 계산은 화면 안내와 버튼 활성화용이다.
 *
 * Draft : 산타가 입력 중인 주문 목록·계획 수량. 아직 서버에 보내지 않은 "입력값"이라 브라우저에 둔다.
 * 의존 : js/api.js
 * ------------------------------------------------------------ */
'use strict';

/** 입력 중인 값 (트리 모델 탭 → 생산계획 화면으로 넘어가는 동안만 쓴다) */
const Draft = {
  selModel: 'T-CLASSIC',   // 트리 모델 탭에서 고른 모델
  orderQty: 10,            // [주문 목록에 담기] 수량 입력칸의 마지막 값
  orderList: [],           // 담은 주문 [{ treeCode, qty }]
  plan: [],                // 최종 결정한 생산계획 [{ treeCode, orderQty, planQty }]
  /** 일괄 등록이 끝나면 입력값을 비운다 */
  reset() { this.orderList = []; this.plan = []; },
};

const Store = (() => {
  /**
   * 서버 응답 세 개(품목, 모델·BOM, 작업지시)를 동시에 받아 계산 함수와 함께 돌려준다.
   * @returns {Promise<object>} 화면 함수가 받는 data 객체
   */
  async function load() {
    const [items, models, wo] = await Promise.all([Api.items(), Api.models(), Api.workOrders()]);
    return build(items.data, models.data, wo.data);
  }

  /**
   * API 데이터로 조회·계산 함수를 만든다.
   * @param {Array} items  [{code, name, shortName, kind, safetyStock, stock}]
   * @param {Array} models [{code, name, shortName, stock, bom:[{itemCode, name, qtyPerTree, stock}]}]
   * @param {object} wo    { orders, waitingByTree, planCountToday }
   */
  function build(items, models, wo) {
    const itemMap = Object.fromEntries(items.map(i => [i.code, i]));
    const modelMap = Object.fromEntries(models.map(m => [m.code, m]));
    const waitingByTree = wo.waitingByTree || {};

    const item = code => itemMap[code];
    const model = code => modelMap[code];
    /** 화면에 쓸 짧은 이름 (트리는 "레드 트리", 자재는 원래 이름) */
    const shortName = code => (itemMap[code] && (itemMap[code].shortName || itemMap[code].name)) || code;

    /** 자재 하나의 예약량 = 대기 작업지시가 앞으로 쓸 수량 */
    const reserved = code => models.reduce((n, m) => {
      const line = m.bom.find(b => b.itemCode === code);
      return n + (line ? line.qtyPerTree * (waitingByTree[m.code] || 0) : 0);
    }, 0);
    /** 새 계획에 쓸 수 있는 수량 */
    const avail = code => (itemMap[code] ? itemMap[code].stock : 0) - reserved(code);
    /** 모델 하나를 이 재고로 몇 그루까지 만들 수 있는지 (다른 모델 계획은 고려하지 않음) */
    const capacity = code => Math.max(0, Math.min(...model(code).bom.map(b => Math.floor(avail(b.itemCode) / b.qtyPerTree))));
    /** 병목 자재: 단독 최대를 결정하는 BOM 줄 */
    const bottleneck = code => model(code).bom.reduce((x, y) =>
      Math.floor(avail(x.itemCode) / x.qtyPerTree) <= Math.floor(avail(y.itemCode) / y.qtyPerTree) ? x : y);
    /** 여러 줄(트리, 수량)의 자재 소요량 합계 { 자재코드: 수량 } */
    const needOf = lines => {
      const need = {};
      lines.forEach(l => model(l.treeCode).bom.forEach(b => { need[b.itemCode] = (need[b.itemCode] || 0) + b.qtyPerTree * (l.qty || 0); }));
      return need;
    };
    /** 사용 가능 수량 기준 부족 자재 [{ code, need, have, short }] (화면 즉시 판정용) */
    const shortages = lines => Object.entries(needOf(lines))
      .filter(([c, n]) => n > avail(c))
      .map(([c, n]) => ({ code: c, need: n, have: avail(c), short: n - avail(c) }));

    const orders = wo.orders || [];
    return {
      items, models, orders, planCountToday: wo.planCountToday || 0,
      mats: items.filter(i => i.kind === 'MAT'),
      trees: items.filter(i => i.kind === 'TREE'),
      waiting: orders.filter(o => o.status === 'WAIT'),
      toShip: orders.filter(o => o.status === 'DONE' && !o.shipped),   // 완료했지만 출하하지 않은 작업지시
      item, model, shortName, reserved, avail, capacity, bottleneck, needOf, shortages,
    };
  }

  return { load };
})();

/** 숫자를 1,234 형식으로 */
const fmt = n => Number(n).toLocaleString('ko-KR');
/** 오늘 날짜 "YYYY-MM-DD" (브라우저 시각 기준. 서버와 같은 한국 시간대에서 쓴다) */
const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
/** "2026-11-20 13:26:32" → "13:26" */
const hhmm = at => (at || '').slice(11, 16);
/** 재고 ÷ 안전재고 비율에 따른 상태 알약 (위험 < 50% ≤ 부족 < 100% ≤ 정상) */
function stockPill(stock, safety) {
  const r = safety ? stock / safety : 1;
  return r < 0.5 ? '<span class="pill crit">위험</span>' : r < 1 ? '<span class="pill warn">부족</span>' : '<span class="pill ok">정상</span>';
}
