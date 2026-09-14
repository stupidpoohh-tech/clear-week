/*
 * 되돌리기 (P1-2) — **지운 직후에만, 그 자리에 그대로.**
 *
 * 되돌리기가 "다시 적기"가 되면 안 된다. id가 바뀌면 다른 기기에서는 새 항목이
 * 되고, 원래 것의 지운 표시는 그대로 남아 결국 하나가 사라진다.
 */
import { check, ok, done } from './_harness.mjs';
import { captureItem, captureNote, captureMany, revert, countOf } from '../src/core/undo.js';
import { blankWeek, addItem, removeItem, setNote, setNoteStrikes, clearNote } from '../src/core/model.js';

const T = Date.now() - 60_000;
const texts = (w, k = 'mon') => w.days[k].map(i => i.text);

console.log('\n── 항목 ──');
let w0 = blankWeek('2026-W38');
const made = addItem(w0, 'mon', '장보기', T);
const w1 = made.week;
const snap = captureItem('mon', made.item);
const w2 = removeItem(w1, 'mon', made.item.id, T + 10);
check('지우면 사라진다', texts(w2), []);
ok('지운 표시가 남는다', !!w2.graves[made.item.id]);

const w3 = revert(w2, snap, T + 20);
check('되돌리면 돌아온다', texts(w3), ['장보기']);
check('**같은 id로** 돌아온다 — 새 항목이 아니다', w3.days.mon[0].id, made.item.id);
check('적은 시각은 그대로다', w3.days.mon[0].createdAt, T);
check('고친 시각은 지금으로 — 지운 표시를 이겨야 한다', w3.days.mon[0].updatedAt, T + 20);
ok('**지운 표시를 걷어낸다** — 안 걷으면 다음 합치기에 도로 지워진다',
  w3.graves[made.item.id] === undefined);

check('두 번 되돌려도 둘이 되지 않는다', texts(revert(w3, snap, T + 30)), ['장보기']);
check('없는 것을 되돌리라고 하면 그대로', revert(w2, null), w2);

console.log('\n── 메모는 글자와 획이 한 몸 ──');
const S = { line: 0, a: 0.02, b: 0.97, seed: 7 };
let n1 = setNote(blankWeek('2026-W38'), 'tue', '8/20 마감', T);
n1 = setNoteStrikes(n1, 'tue', [S], T + 1);
const nsnap = captureNote('tue', n1.notes.tue, n1.noteStrikes.tue);
const n2 = clearNote(n1, 'tue', T + 5);
check('메모를 지우면 글자와 획이 함께 사라진다',
  [n2.notes.tue, n2.noteStrikes.tue.length], ['', 0]);
const n3 = revert(n2, nsnap, T + 9);
check('되돌리면 글자가 온다', n3.notes.tue, '8/20 마감');
check('**획도 함께 온다**', n3.noteStrikes.tue, [S]);
check('메모의 시각도 지금으로', n3.noteAt.tue, T + 9);

console.log('\n── 한 손짓에 여럿 ──');
let m = blankWeek('2026-W38');
const three = [];
for (const name of ['가', '나', '다']) {
  const r = addItem(m, 'wed', name, T);
  m = r.week; three.push(captureItem('wed', r.item));
}
let gone = m;
three.forEach(s => { gone = removeItem(gone, 'wed', s.item.id, T + 10); });
check('셋이 사라진다', texts(gone, 'wed'), []);
const many = captureMany(three);
check('묶음의 수를 센다', countOf(many), 3);
check('한 번에 셋이 돌아온다', texts(revert(gone, many, T + 20), 'wed').sort(), ['가', '나', '다']);

console.log('\n── 원본을 건드리지 않는다 ──');
const before = JSON.stringify(w2);
revert(w2, snap, T + 40);
check('넘겨준 주는 그대로다', JSON.stringify(w2), before);
done('되돌리기');
