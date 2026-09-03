/*
 * 캘린더 — **한 방향이다.** 이쪽에서 적은 것도 지운 것도 저쪽으로 안 간다.
 * 여기서 검사하는 것은 "받아 온 것을 어떻게 앉히나"뿐이다.
 */
import { check, ok, done } from './_harness.mjs';
import { applyRemote, dayDateISO } from '../src/sync/rules.js';
import { blankWeek, addItem } from '../src/core/model.js';
import { mondayOf } from '../src/core/week.js';

const monday = mondayOf(new Date(2026, 7, 24));
const T = 1_750_000_000_000;
const task = (id, title, day, extra = {}) => ({
  id, f: { kind: 'task', title, startDate: dayDateISO(monday, day), ...extra },
});
const texts = (w, k) => w.days[k].map(i => i.text);

console.log('\n── 받아 오기 ──');
let w = blankWeek('2026-W35');
let out = applyRemote(w, monday, [task('x1', '치과', 'tue')], T);
check('할 일이 그 날짜 칸에 온다', texts(out.week, 'tue'), ['치과']);
check('저쪽 id에서 이쪽 id를 유도한다', out.week.days.tue[0].id, 'dc-x1');

check('**몇 번을 받아 와도 중복이 없다**',
  applyRemote(out.week, monday, [task('x1', '치과', 'tue')], T + 1).week.days.tue.length, 1);

check('끝난 것은 안 가져온다',
  applyRemote(w, monday, [task('x2', '완료', 'tue', { task: { status: 'done' } })], T)
    .week.days.tue.length, 0);
check('반복은 안 가져온다',
  applyRemote(w, monday, [task('x3', '매주', 'tue', { isRecurring: true })], T)
    .week.days.tue.length, 0);
check('할 일이 아닌 것은 안 가져온다',
  applyRemote(w, monday, [{ id: 'x4', f: { kind: 'idea', title: '생각', startDate: dayDateISO(monday, 'tue') } }], T)
    .week.days.tue.length, 0);
check('이 주가 아닌 것은 안 가져온다',
  applyRemote(w, monday, [{ id: 'x5', f: { kind: 'task', title: '다음달', startDate: '2026-10-01' } }], T)
    .week.days.tue.length, 0);

console.log('\n── 저쪽에서 사라지면 이쪽에서도 지운다 ──');
const gone = applyRemote(out.week, monday, [], T + 10);
check('사라진다', gone.week.days.tue.length, 0);
ok('**무덤에 남는다** — 같은 id로 되살아나도 다시 안 온다', gone.week.graves['dc-x1'] === T + 10);
check('무덤이 막는다',
  applyRemote(gone.week, monday, [task('x1', '치과', 'tue')], T + 20).week.days.tue.length, 0);

console.log('\n── 이쪽 것은 건드리지 않는다 ──');
let mine = addItem(blankWeek('2026-W35'), 'tue', '내가 적은 것', T).week;
const mixed = applyRemote(mine, monday, [task('x9', '캘린더 것', 'tue')], T);
check('내가 적은 것은 그대로', texts(mixed.week, 'tue'), ['내가 적은 것', '캘린더 것']);
const after = applyRemote(mixed.week, monday, [], T + 5);
check('저쪽이 비어도 내가 적은 것은 안 지운다', texts(after.week, 'tue'), ['내가 적은 것']);

console.log('\n── 원본을 바꾸지 않는다 ──');
const before = JSON.stringify(mine);
applyRemote(mine, monday, [task('x7', '무엇', 'wed')], T);
check('넘겨준 주는 그대로다', JSON.stringify(mine), before);
check('바뀐 것이 없으면 같은 주를 그대로 돌려준다',
  applyRemote(mine, monday, [], T).week === mine, true);
done('캘린더');
