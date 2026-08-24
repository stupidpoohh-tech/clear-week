/*
 * Clear Week — 합치기 규칙 검사
 *
 *   node tests/merge.mjs
 *
 * 브라우저가 필요 없다. 합치기는 서버 한 곳에만 있으므로 여기서 직접 부른다.
 * 규칙은 하나 — 적은 것이 없어지지 않는 쪽으로 기운다.
 */
import { mergeWeek, sanitizeWeek, blankWeek } from '../functions/_lib.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` +
    (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

const T = 1_750_000_000_000;      // 시각은 1e12를 넘는다 — |0을 쓰면 깨진다
const item = (id, text, at, extra = {}) =>
  ({ id, text, struck: false, createdAt: at, updatedAt: at, strikes: [], ...extra });
const week = (mon = [], extra = {}) => {
  const w = blankWeek('2026-W34');
  w.days.mon = mon;
  return { ...w, ...extra };
};
const texts = w => w.days.mon.map(i => i.text);

console.log('\n── 항목 합치기 ──');
check('양쪽에서 적은 것이 둘 다 남는다',
  texts(mergeWeek(week([item('a', '장보기', T)]), week([item('b', '은행', T + 10)]), T + 99)),
  ['장보기', '은행']);

check('순서는 적은 시각으로 정해진다 (기기 순서가 아니라)',
  texts(mergeWeek(week([item('b', '은행', T + 10)]), week([item('a', '장보기', T)]), T + 99)),
  ['장보기', '은행']);

check('같은 항목은 나중에 고친 쪽을 따른다',
  texts(mergeWeek(
    week([item('a', '장보기', T, { updatedAt: T + 5 })]),
    week([item('a', '장보기 · 우유', T, { updatedAt: T + 50 })]), T + 99)),
  ['장보기 · 우유']);

check('그은 것이 안 그은 것을 이긴다 (나중이면)',
  mergeWeek(
    week([item('a', '장보기', T, { updatedAt: T + 5 })]),
    week([item('a', '장보기', T, { updatedAt: T + 50, struck: true })]), T + 99)
    .days.mon[0].struck, true);

console.log('\n── 지우기 ──');
check('한쪽에서 지우면 지워진 채로 남는다',
  texts(mergeWeek(
    week([item('a', '장보기', T)]),
    week([], { graves: { a: T + 20 } }), T + 99)),
  []);

check('지운 뒤 다른 기기에서 고쳤으면 살아남는다',
  texts(mergeWeek(
    week([item('a', '장보기 · 우유', T, { updatedAt: T + 60 })]),
    week([], { graves: { a: T + 20 } }), T + 99)),
  ['장보기 · 우유']);

check('지운 표시는 유지된다 — 다음 합치기에 되살아나지 않게',
  Object.keys(mergeWeek(week([]), week([], { graves: { a: T } }), T + 99).graves),
  ['a']);

check('오래된 지운 표시는 정리된다',
  Object.keys(mergeWeek(week([]), week([], { graves: { a: T } }),
    T + 61 * 86400000).graves),
  []);

console.log('\n── 요일 메모 ──');
check('메모는 나중에 적은 쪽',
  mergeWeek(
    week([], { notes: { ...blankWeek('x').notes, mon: '8/20 마감' }, noteAt: { ...blankWeek('x').noteAt, mon: T } }),
    week([], { notes: { ...blankWeek('x').notes, mon: '8/21 마감' }, noteAt: { ...blankWeek('x').noteAt, mon: T + 5 } }),
    T + 99).notes.mon,
  '8/21 마감');

check('메모를 비운 것도 반영된다',
  mergeWeek(
    week([], { notes: { ...blankWeek('x').notes, mon: '8/20 마감' }, noteAt: { ...blankWeek('x').noteAt, mon: T } }),
    week([], { noteAt: { ...blankWeek('x').noteAt, mon: T + 5 } }),
    T + 99).notes.mon,
  '');

/* 메모의 획은 **글자와 한 몸**이다 — 따로 합치면 이쪽 글자에 저쪽 획이
   얹혀 엉뚱한 자리에 줄이 간다 (spec §4-6) */
const noteWeek = (text, at, strikes = []) => week([], {
  notes: { ...blankWeek('x').notes, mon: text },
  noteAt: { ...blankWeek('x').noteAt, mon: at },
  noteStrikes: { ...blankWeek('x').noteStrikes, mon: strikes },
});
const S = (a, b) => ({ line: 0, a, b, seed: 7 });

check('메모의 획도 나중에 고친 쪽을 따른다',
  mergeWeek(noteWeek('8/20 마감', T, [S(0, 1)]), noteWeek('8/20 마감', T + 5, []), T + 99).noteStrikes.mon,
  []);

check('그은 쪽이 나중이면 획이 남는다',
  mergeWeek(noteWeek('8/20 마감', T, []), noteWeek('8/20 마감', T + 5, [S(0, 1)]), T + 99).noteStrikes.mon,
  [S(0, 1)]);

check('글자와 획은 같은 쪽에서 온다',
  (w => [w.notes.mon, w.noteStrikes.mon.length])(
    mergeWeek(noteWeek('옛 글자', T + 5, [S(0, 1)]), noteWeek('새 글자', T, [S(0, 0.4), S(1, 1)]), T + 99)),
  ['옛 글자', 1]);

check('예전에 저장된 주에는 획 자리가 없다 — 빈 것으로 본다',
  mergeWeek({ ...blankWeek('2026-W34'), noteStrikes: undefined },
            noteWeek('8/20 마감', T, []), T + 99).noteStrikes.mon, []);

check('바깥에서 온 획도 모양을 믿지 않는다',
  sanitizeWeek({ noteStrikes: { mon: [{ line: '2', a: 'x', b: 1, seed: 3, 몰래: '치과' }] } },
               '2026-W34').noteStrikes.mon,
  [{ line: 2, a: 0, b: 1, seed: 3 }]);

check('메모 획은 여덟 개까지', sanitizeWeek(
  { noteStrikes: { mon: Array.from({ length: 40 }, () => S(0, 1)) } }, '2026-W34').noteStrikes.mon.length, 8);

console.log('\n── 합치기는 순서를 타지 않아야 한다 ──');
{
  const a = week([item('a', '장보기', T), item('c', '운동', T + 30)], { graves: { z: T + 1 } });
  const b = week([item('b', '은행', T + 10, { updatedAt: T + 40 })]);
  check('a+b 와 b+a 가 같다',
    JSON.stringify(mergeWeek(a, b, T + 99)) === JSON.stringify(mergeWeek(b, a, T + 99)), true);
}

console.log('\n── 바깥에서 들어온 값 ──');
check('모양이 아닌 값은 빈 주가 된다', texts(sanitizeWeek(null, '2026-W34')), []);
check('id 없는 항목은 버린다',
  sanitizeWeek({ days: { mon: [{ text: '이름표 없음' }] } }, '2026-W34').days.mon.length, 0);
check('시각이 잘리지 않는다 (1e12 초과)',
  sanitizeWeek({ days: { mon: [{ id: 'a', text: 'x', createdAt: T }] } }, '2026-W34').days.mon[0].createdAt, T);
check('updatedAt이 없으면 createdAt으로 채운다',
  sanitizeWeek({ days: { mon: [{ id: 'a', text: 'x', createdAt: T }] } }, '2026-W34').days.mon[0].updatedAt, T);

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
