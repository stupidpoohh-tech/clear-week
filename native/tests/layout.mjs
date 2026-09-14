/*
 * 자리 — 획을 그릴 좌표와 손짓을 받을 좌표가 **같은 계산에서 나온다.**
 * 어긋날 수 없다는 것이 이 파일의 요지다.
 */
import { check, ok, done } from './_harness.mjs';
import { computeLayout } from '../src/ui/layout.js';
import { blankWeek, addItem, setNote, addStrike } from '../src/core/model.js';
import { mondayOf } from '../src/core/week.js';
import { lineAt, lineAtY, cellAt, strokeAt } from '../src/core/hit.js';
import { SIZE, PAD } from '../src/core/constants.js';

const monday = mondayOf(new Date(2026, 7, 24));
const lay = (week, w = 390, h = 620, metrics = {}) =>
  computeLayout({ width: w, height: h, week, monday, metrics });

let week = blankWeek('2026-W35');
let first = null;
for (let i = 0; i < 3; i++) {
  const r = addItem(week, 'mon', '항목' + i, 1_750_000_000_000 + i);
  week = r.week; if (!first) first = r.item;
}
week = setNote(week, 'mon', '8/20 마감');

console.log('\n── 여덟 칸 ──');
const L = lay(week);
check('요일 일곱과 note 하나', L.cells.length, 8);
check('요일 칸은 세로로 균등', Math.round(L.cells[1].top - L.cells[0].top), Math.round(620 / 7));
ok('note 칸은 오른쪽에 세로로 하나', L.cells[7].key === 'free' && L.cells[7].bottom === 620);
ok('note 칸에는 왼쪽 여백이 없다', L.cells[7].bodyLeft === L.cells[7].left);
check('요일 칸의 왼쪽 여백은 날짜 폭', L.cells[0].bodyLeft - L.cells[0].left, SIZE.labelW);

console.log('\n── 줄 ──');
const monLines = L.lines.filter(l => l.key === 'mon');
check('항목 셋 + 메모 한 줄', monLines.length, 4);
const l0 = monLines[0];
ok('글자 위를 짚으면 그 줄을 찾는다', lineAt(L.lines, l0.left + 3, (l0.top + l0.bottom) / 2) === l0);
ok('글자보다 위는 그 줄이 아니다', lineAt(L.lines, l0.left + 3, l0.top - 30) !== l0);

console.log('\n── 여백에서 그어도 인식한다 ──');
const c = L.cells[0];
const inMargin = lineAtY(L.lines, (l0.top + l0.bottom) / 2, 'mon');
ok('여백의 높이로 그 줄을 찾는다', inMargin && inMargin.id === l0.id);
ok('여백은 항목 칸 왼쪽이다', c.left < c.bodyLeft);
check('그 자리는 mon 칸이다', cellAt(L.cells, c.left + 2, c.top + 4).key, 'mon');

console.log('\n── 획은 줄 위에 앉는다 ──');
const struck = addStrike(week, 'mon', first.id, { line: 0, a: 0.05, b: 0.95, seed: 5 });
const L2 = lay(struck);
check('획 하나', L2.strokes.length, 1);
const s = L2.strokes[0];
const line = L2.lines.find(l => l.id === first.id && l.line === 0);
ok('획의 높이는 줄의 한가운데', Math.abs(s.y - (line.top + line.bottom) / 2) < 0.001);
ok('획의 왼쪽 끝은 비율대로',
  Math.abs(s.minX - (line.left + 0.05 * (line.right - line.left))) < 0.001);
ok('그 자리를 문대면 그 획을 찾는다', strokeAt(L2.strokes, s.minX + 2, s.y) === s);
ok('멀리 떨어진 곳에서는 안 찾는다', strokeAt(L2.strokes, s.minX + 2, s.y + 200) === null);

console.log('\n── 펜 판은 글자 아래에서 시작한다 ──');
ok('적힌 것들보다 아래', L.cells[0].pad === null || L.cells[0].pad.y >= L.cells[0].lowest);
const empty = lay(blankWeek('2026-W35'));
ok('빈 칸에는 판이 있다', !!empty.cells[0].pad);
ok('판은 왼쪽 여백을 침범하지 않는다', empty.cells[0].pad.x === empty.cells[0].bodyLeft);

let full = blankWeek('2026-W35');
for (let i = 0; i < 30; i++) full = addItem(full, 'mon', '항목' + i).week;
const L3 = lay(full);
ok('**자리가 좁으면 판을 두지 않는다** — 펜이 글자를 낚아채면 안 된다',
  L3.cells[0].pad === null ||
  L3.cells[0].bottom - L3.cells[0].lowest >= PAD.minRoom);
ok('다 못 담으면 잘렸다고 알린다', L3.cells[0].hidden > 0);

/*
 * 넘친 것에 **닿을 수 있어야 한다** (P1-2). 개수만 알면 적어 둔 것을 다시 보지도
 * 고치지도 못한다 — 데이터는 있는데 손이 안 닿는 자리가 된다.
 */
console.log('\n── 넘친 것 ──');
{
  let many = blankWeek('2026-W35');
  const made = [];
  for (let i = 0; i < 30; i++) {
    const r = addItem(many, 'mon', '항목' + i, 1_750_000_000_000 + i);
    many = r.week; made.push(r.item.id);
  }
  const M = lay(many);
  const c = M.cells.find(x => x.key === 'mon');
  ok('다 못 담는다', c.hidden > 0);
  check('**잘린 것이 무엇인지 들고 있다**', c.hiddenItems.length, c.hidden);
  ok('잘린 것은 그려지지 않은 것들이다',
    c.hiddenItems.every(id => !M.items.some(it => it.key === 'mon' && it.id === id)));
  ok('보이는 것과 잘린 것을 합치면 전부다',
    M.items.filter(it => it.key === 'mon').length + c.hidden === made.length);
  ok('잘린 것은 뒤쪽 항목들이다 — 앞에서부터 채우므로',
    c.hiddenItems[c.hiddenItems.length - 1] === made[made.length - 1]);

  ok('누를 자리가 있다', !!c.moreRect);
  ok('그 자리는 칸 안이다',
    c.moreRect.right <= c.right + 0.001 && c.moreRect.bottom <= c.bottom + 0.001);
  ok('넉넉히 눌러진다', (c.moreRect.right - c.moreRect.left) > 20 &&
    (c.moreRect.bottom - c.moreRect.top) > 20);

  const small = lay(week);      /* 안 넘치는 칸 */
  const sc = small.cells.find(x => x.key === 'mon');
  check('안 넘치면 잘린 것도 없다', [sc.hidden, sc.hiddenItems.length], [0, 0]);
  ok('안 넘치면 누를 자리도 없다', sc.moreRect === null);
}

console.log('\n── 잰 글자가 자리를 바꾼다 ──');
const metrics = { ['mon:' + first.id]: { lines: [40, 30] } };   /* 두 줄로 감긴 항목 */
const L4 = lay(week, 390, 620, metrics);
check('두 줄이면 줄이 둘 등록된다',
  L4.lines.filter(l => l.id === first.id).length, 2);
ok('둘째 줄은 첫 줄 아래', (() => {
  const two = L4.lines.filter(l => l.id === first.id);
  return two[1].top > two[0].top;
})());
done('자리');
