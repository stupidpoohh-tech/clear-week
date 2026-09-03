/*
 * 자리 미리 보기 — `node tools/preview.mjs [out.svg]`
 *
 * **이것은 기기 화면이 아니다.** RN이 그린 것도 아니다. `layout.js`가 정한
 * 자리와 `grain.js`가 만든 획을 그대로 SVG로 옮겨 그린 것이다 —
 * 숫자만 보고는 표가 제대로 앉았는지 알 수 없어서 둔다 (CLAUDE.md의 "눈으로 확인").
 *
 * 여기서 맞아 보이는 것과 실기기에서 맞는 것은 다른 문제다. 글꼴 폭이 다르고,
 * 손과 펜은 여기 없다. **"확인했습니다"라고 쓰지 말 것.**
 */
import { writeFileSync } from 'node:fs';
import { computeLayout } from '../src/ui/layout.js';
import { blankWeek, addItem, setNote, addStrike } from '../src/core/model.js';
import { mondayOf } from '../src/core/week.js';
import { pointsFromRecord, strokeOutline } from '../src/core/grain.js';
import { COLOR, SIZE } from '../src/core/constants.js';

const W = 390, H = 700, PAD = 10;
const monday = mondayOf(new Date(2026, 7, 24));
const T = 1_750_000_000_000;

/* 표본 — 손이 오갈 만한 모양으로. 한 칸은 일부러 넘치게 둔다 */
let week = blankWeek('2026-W35');
const put = (k, t) => { const r = addItem(week, k, t, T + Math.random() * 1000); week = r.week; return r.item; };
const a1 = put('mon', '장보기');
put('mon', '은행'); put('mon', '자전거 수리');
week = setNote(week, 'mon', '8/20 마감');
const t1 = put('tue', '치과 3시');
put('tue', '보고서 초안');
put('wed', '어머니 생신 선물');
for (let i = 0; i < 7; i++) put('thu', '항목 ' + (i + 1));
put('fri', '주간 회고');
week = setNote(week, 'sat', '회식');
put('sun', '빨래');
put('free', '전구 사기'); put('free', '도서관 책 반납'); put('free', '보험 문의');
week = addStrike(week, 'mon', a1.id, { line: 0, a: -0.02, b: 1.01, seed: 1074304443 }, T);
week = addStrike(week, 'tue', t1.id, { line: 0, a: 0.05, b: 0.9, seed: 88123 }, T);

/* 글자 폭은 대략 잡는다 — 실제 폭은 기기의 글꼴이 정한다 */
const metrics = {};
for (const k of Object.keys(week.days)) {
  for (const it of week.days[k]) {
    metrics[k + ':' + it.id] = { lines: [it.text.length * SIZE.itemFont * 0.62] };
  }
  if (week.notes[k]) metrics[k + ':note'] = { lines: [week.notes[k].length * SIZE.sublabelFont * 0.62] };
}

const L = computeLayout({ width: W - PAD * 2, height: H - PAD * 2 - SIZE.headerH, week, monday, metrics });
const off = (x, y) => [x + PAD, y + PAD + SIZE.headerH];

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  `<rect width="${W}" height="${H}" fill="${COLOR.paper}"/>`,
  `<text x="${PAD}" y="26" font-family="sans-serif" font-size="15" font-weight="600" fill="${COLOR.ink}">2026. 8.24-8.30 ‹ ›</text>`];

for (const c of L.cells) {
  const [x, y] = off(c.left, c.top);
  if (c.key !== 'free' && c.top > 0) {
    out.push(`<line x1="${x}" y1="${y}" x2="${x + (c.right - c.left)}" y2="${y}" stroke="${COLOR.rule}" stroke-width="0.5"/>`);
  }
  out.push(`<text x="${x + 2}" y="${y + 12}" font-family="sans-serif" font-size="${SIZE.itemFont}" font-weight="600" fill="${COLOR.ink}">${esc(c.label)}</text>`);
  if (c.hidden) out.push(`<text x="${x + (c.right - c.left) - 14}" y="${y + (c.bottom - c.top) - 3}" font-family="sans-serif" font-size="${SIZE.sublabelFont}" fill="${COLOR.inkFaint}">+${c.hidden}</text>`);
}
for (const n of L.notes.filter(n => n.text)) {
  const [x, y] = off(n.x, n.y);
  out.push(`<text x="${x}" y="${y + n.h * 0.75}" font-family="sans-serif" font-size="${SIZE.sublabelFont}" font-weight="600" fill="${COLOR.inkFaint}">${esc(n.text)}</text>`);
}
for (const it of L.items) {
  const [x, y] = off(it.x, it.y);
  out.push(`<text x="${x}" y="${y + it.lineHeight * 0.7}" font-family="sans-serif" font-size="${it.fontSize}" fill="${COLOR.ink}">${esc(it.text)}</text>`);
}
for (const s of L.strokes) {
  const pts = pointsFromRecord(s, s.lineLeft, s.lineWidth, s.y);
  const flat = strokeOutline(pts, 1);
  const d = [];
  for (let i = 0; i < flat.length; i += 2) {
    const [x, y] = off(flat[i], flat[i + 1]);
    d.push((i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1));
  }
  out.push(`<path d="${d.join('')}Z" fill="${COLOR.stroke}"/>`);
}
out.push('</svg>');

const path = process.argv[2] || 'preview.svg';
writeFileSync(path, out.join('\n'));
console.log('그렸습니다 →', path);
