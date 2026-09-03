/*
 * 칸 나누기 — **개수가 아니라 실제로 넘치는지를 본다.**
 * 숫자를 박으면 어떤 폰에서는 자리가 남는데 나뉘고, 어떤 폰에서는 나뉘어도 잘린다.
 */
import { check, ok, done } from './_harness.mjs';
import { planColumns } from '../src/core/columns.js';

const rows = n => Array.from({ length: n }, () => 26);

console.log('\n── 나뉨 ──');
check('빈 칸은 한 단', planColumns([], 100).columns, 1);
check('들어가면 안 나눈다', planColumns(rows(3), 100).columns, 1);
check('넘치면 나뉜다', planColumns(rows(6), 100).columns, 2);
ok('나뉘면 글씨가 작아진다', planColumns(rows(6), 100).scale < 1);
check('많으면 세 단까지', planColumns(rows(12), 100).columns, 3);
check('**최대는 세 단이다**', planColumns(rows(60), 100).columns, 3);
ok('그래도 넘치면 잘렸다고 알린다', planColumns(rows(60), 100).hidden > 0);
check('잘린 것을 숨기지 않는다 — 몇 개인지 센다', planColumns(rows(60), 100).hidden,
  60 - planColumns(rows(60), 100).chunks.flat().length);

console.log('\n── 화면 높이에 따라 다르다 ──');
check('작은 화면에서는 일찍 나뉜다', planColumns(rows(4), 80).columns, 2);
check('큰 화면에서는 안 나뉜다', planColumns(rows(4), 200).columns, 1);

console.log('\n── 한 항목이 열에 걸쳐 잘리지 않는다 ──');
const plan = planColumns([26, 52, 26, 26], 80);
ok('두 줄짜리는 통째로 한 열에 있다',
  plan.chunks.every(c => c.length === new Set(c).size));
check('모든 항목이 어딘가에는 있다',
  plan.chunks.flat().length + plan.hidden, 4);
done('칸 나누기');
