/*
 * 주 경계 (P1-2) — **앱을 며칠 켜 둔 채로 두어도 이번 주가 따라간다.**
 * 일요일 밤에 열어 둔 화면이 월요일에도 지난주면, 거기 적은 것이 지난주로 들어간다.
 *
 * **옮기는 것은 화면뿐이다.** 항목은 따라가지 않는다 (자동 이월 없음).
 */
import { check, ok, done } from './_harness.mjs';
import { mondayOf, weekIdOf, rolledOver, untilNextWeek, addWeeks } from '../src/core/week.js';

const sunNight = new Date(2026, 8, 13, 23, 59);   // 일요일 밤
const monDawn = new Date(2026, 8, 14, 0, 1);      // 월요일 새벽
const shown = mondayOf(sunNight);

console.log('\n── 넘어갔나 ──');
check('일요일 밤과 월요일 새벽은 다른 주', [weekIdOf(sunNight), weekIdOf(monDawn)],
  ['2026-W37', '2026-W38']);
ok('이번 주를 보고 있었으면 따라간다', rolledOver(shown, true, monDawn));
ok('**지난주를 일부러 펴 두었으면 그대로 둔다**', !rolledOver(shown, false, monDawn));
ok('같은 주 안에서는 움직이지 않는다',
  !rolledOver(shown, true, new Date(2026, 8, 13, 12, 0)));
ok('여러 주를 건너뛰어도 알아본다',
  rolledOver(shown, true, new Date(2026, 9, 5, 9, 0)));

console.log('\n── 언제 깨울까 ──');
const left = untilNextWeek(sunNight);
check('일요일 밤이면 곧', left <= 61_000 && left > 0, true);
const monMorning = new Date(2026, 8, 14, 9, 0);
const days = untilNextWeek(monMorning) / 86_400_000;
ok('월요일 아침이면 엿새 남짓', days > 6 && days < 7);
ok('언제 물어도 앞을 가리킨다',
  [0, 3, 6].every(d => untilNextWeek(addWeeks(monMorning, 0), d) > 0));

console.log('\n── 넘어가도 항목은 따라가지 않는다 ──');
/* 이월은 코드에 없다 — 다음 주의 주 id가 다르면 저장 키가 다르고, 그것이 전부다 */
check('다음 주는 다른 주소에 적힌다',
  weekIdOf(addWeeks(shown, 1)) !== weekIdOf(shown), true);
done('주 경계');
