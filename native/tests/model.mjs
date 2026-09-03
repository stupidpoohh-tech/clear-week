/* 데이터 — 웹·서버와 **같은 모양**이어야 한다. 규칙 넷이 지켜지는지 본다 */
import { check, ok, done } from './_harness.mjs';
import {
  blankWeek, sanitizeWeek, addItem, editItem, removeItem, addStrike, removeStrike,
  setNote, setNoteStrikes, clearNote, isEmptyWeek, ts,
} from '../src/core/model.js';

const T = 1_750_000_000_000;      /* 시각은 1e12를 넘는다 — |0을 쓰면 깨진다 */

console.log('\n── 모양 ──');
const w0 = blankWeek('2026-W35');
check('여덟 칸이 있다', Object.keys(w0.days).length, 8);
check('note 칸이 있다', Array.isArray(w0.days.free), true);
check('시각은 32비트를 넘어도 산다', ts(T), T);

console.log('\n── 손질 ──');
const { week: w1, item } = addItem(w0, 'mon', '장보기', T);
check('적힌다', w1.days.mon.map(i => i.text), ['장보기']);
check('적은 시각이 남는다', w1.days.mon[0].createdAt, T);

const w2 = editItem(w1, 'mon', item.id, '장보기·우유', T + 5);
check('고쳐진다', w2.days.mon[0].text, '장보기·우유');
check('고친 시각이 오른다', w2.days.mon[0].updatedAt, T + 5);

const w3 = addStrike(w2, 'mon', item.id, { line: 0, a: 0.01, b: 0.97, seed: 7 }, T + 9);
check('그어진다', [w3.days.mon[0].struck, w3.days.mon[0].strikes.length], [true, 1]);
check('획은 좌표가 아니라 비율이다',
  Object.keys(w3.days.mon[0].strikes[0]).sort(), ['a', 'b', 'line', 'seed']);

const w4 = removeStrike(w3, 'mon', item.id, 0, T + 10);
check('다 지우면 그어짐도 내려간다', [w4.days.mon[0].struck, w4.days.mon[0].strikes.length],
  [false, 0]);

const w5 = removeItem(w3, 'mon', item.id, T + 20);
check('지우면 사라진다', w5.days.mon.length, 0);
ok('**지운 표시가 남는다** — 없으면 다른 기기에서 되살아난다', w5.graves[item.id] === T + 20);

console.log('\n── 메모는 글자와 획이 한 몸이다 ──');
const n1 = setNote(w0, 'mon', '8/20 마감', T);
check('메모가 적힌다', [n1.notes.mon, n1.noteAt.mon], ['8/20 마감', T]);
const n2 = setNoteStrikes(n1, 'mon', [{ line: 0, a: 0, b: 1, seed: 3 }], T + 1);
check('메모에 그으면 시각이 함께 오른다', n2.noteAt.mon, T + 1);
const n3 = clearNote(n2, 'mon', T + 2);
check('메모를 지우면 글자와 획이 함께 사라진다',
  [n3.notes.mon, n3.noteStrikes.mon.length], ['', 0]);

console.log('\n── 바깥에서 온 것은 믿지 않는다 ──');
const dirty = sanitizeWeek({
  days: { mon: [{ id: 'a', text: 'x', createdAt: T }, { text: '아이디 없음' }] },
  notes: { mon: 42 }, graves: { b: 'x', c: T },
}, '2026-W35');
check('아이디 없는 항목은 버린다', dirty.days.mon.length, 1);
check('updatedAt이 없으면 createdAt을 쓴다', dirty.days.mon[0].updatedAt, T);
check('글자가 아닌 메모는 빈 것으로', dirty.notes.mon, '');
check('시각이 아닌 무덤은 버린다', Object.keys(dirty.graves), ['c']);
ok('빈 주를 알아본다', isEmptyWeek(blankWeek('2026-W35')));
ok('적힌 주는 빈 주가 아니다', !isEmptyWeek(w1));
done('모양');
