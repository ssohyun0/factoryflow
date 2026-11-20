/* ------------------------------------------------------------
 * js/tree-svg.js — 트리 그림 (SVG)
 * 역할 : 모델의 BOM(서버 값)을 보고 트리에 장식을 그린다. 시안의 treeSvg 와 같은 그림이다.
 *        빨간 볼·금색 볼·미니 볼·눈꽃·리본·솔방울은 소요량만큼(최대 개수 제한) 점 자리에 배치하고,
 *        LED 전구줄이 있으면 점선 줄을, 별은 금색/은색 중 BOM 에 있는 것을 꼭대기에 그린다.
 *        미니 전나무(FIR-60) 모델은 작게 줄여 그린다.
 * 사용 : 트리 모델 탭 미리보기, 작업 탭 카드 (T12)
 * ------------------------------------------------------------ */
'use strict';

/**
 * @param {object} model 서버의 모델 { code, name, bom:[{itemCode, qtyPerTree}] }
 * @returns {string} SVG 문자열
 */
function treeSvg(model) {
  const has = c => (model.bom.find(b => b.itemCode === c) || { qtyPerTree: 0 }).qtyPerTree;
  const mini = has('FIR-60') > 0;
  // 장식을 놓을 자리 (위에서 아래로)
  const spots = [[110,70],[96,92],[124,96],[110,112],[84,124],[136,128],[98,140],[122,150],[72,160],[148,162],[92,172],[128,178],[110,190],[64,198],[156,200],[86,208],[134,212],[110,224],[76,232],[146,234],[100,240],[122,244],[60,242],[160,244]];
  let k = 0;
  const take = n => spots.slice(k, k = Math.min(spots.length, k + n));
  let orn = '';
  if (has('LIGHT')) orn += '<path d="M84 104 Q110 120 136 106 M70 152 Q110 172 150 152 M58 204 Q110 226 162 204" fill="none" stroke="var(--gold)" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"/>';
  take(Math.min(has('BALL-RED'), 8)).forEach(([x, y]) => { orn += `<circle cx="${x}" cy="${y}" r="6" fill="#d63447"/><circle cx="${x - 2}" cy="${y - 2}" r="1.6" fill="#fff" opacity=".7"/>`; });
  take(Math.min(has('BALL-GOLD'), 6)).forEach(([x, y]) => { orn += `<circle cx="${x}" cy="${y}" r="6" fill="#d4a72c"/><circle cx="${x - 2}" cy="${y - 2}" r="1.6" fill="#fff" opacity=".7"/>`; });
  take(Math.min(has('MINI-BALL'), 8)).forEach(([x, y], i) => { orn += `<circle cx="${x}" cy="${y}" r="3.6" fill="${['#d63447', '#3a7bd5', '#d4a72c'][i % 3]}"/>`; });
  take(Math.min(has('SNOW'), 7)).forEach(([x, y]) => { orn += `<g stroke="#e9f3ff" stroke-width="1.6" stroke-linecap="round"><path d="M${x - 6} ${y}h12M${x} ${y - 6}v12M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8"/></g>`; });
  take(Math.min(has('RIBBON'), 4)).forEach(([x, y]) => { orn += `<g fill="#9b1c31"><path d="M${x} ${y} l-7 -5 v10z M${x} ${y} l7 -5 v10z"/><circle cx="${x}" cy="${y}" r="2"/></g>`; });
  take(Math.min(has('PINECONE'), 3)).forEach(([x, y]) => { orn += `<ellipse cx="${x}" cy="${y}" rx="3.5" ry="5" fill="#7a4a24"/>`; });
  const star = has('STAR-GOLD') ? '#e8b923' : has('STAR-SLV') ? '#c9d1d9' : null;
  return `<svg viewBox="0 0 220 280" role="img" aria-label="${esc(model.name)} 그림">
    <g ${mini ? 'transform="translate(28 50) scale(.75)"' : ''}>
      <rect x="100" y="250" width="20" height="18" rx="2" fill="#7a4a24"/>
      <path d="M110 50 L150 120 L70 120Z" fill="#2d7a4f"/><path d="M110 86 L164 182 L56 182Z" fill="#256b44"/><path d="M110 140 L176 254 L44 254Z" fill="#1f5c3d"/>
      ${orn}${star ? `<path d="M110 30 l6 13 14 1 -11 9 4 14 -13 -8 -13 8 4 -14 -11 -9 14 -1z" fill="${star}" stroke="#00000022"/>` : ''}
    </g></svg>`;
}
