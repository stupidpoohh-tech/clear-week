/* 주 계산 — 웹과 **같은 weekId**가 나와야 한다. 서버 저장 키가 그것이다 */
import { check, ok, done } from './_harness.mjs';
import {
  mondayOf, weekIdOf, addWeeks, rangeLabel, cellLabel, isThisWeek, todayKey,
} from '../src/core/week.js';

console.log('\n── 주 ──');
const mon = mondayOf(new Date(2026, 7, 26));       /* 수요일 */
check('수요일에서 월요일을 찾는다', mon.toDateString(), 'Mon Aug 24 2026');
check('월요일은 그대로', mondayOf(new Date(2026, 7, 24)).toDateString(), 'Mon Aug 24 2026');
check('일요일은 그 주의 끝이다', mondayOf(new Date(2026, 7, 30)).toDateString(), 'Mon Aug 24 2026');
check('ISO 주 번호', weekIdOf(mon), '2026-W35');
check('머리말', rangeLabel(mon), '2026. 8.24-8.30');
check('칸 라벨', [cellLabel('mon', mon), cellLabel('sun', mon), cellLabel('free', mon)],
  ['24.M', '30.S', 'note']);
check('다음 주', weekIdOf(addWeeks(mon, 1)), '2026-W36');
check('지난 주', weekIdOf(addWeeks(mon, -1)), '2026-W34');
ok('이번 주인지 안다', isThisWeek(mondayOf(new Date())));
check('오늘 칸', todayKey(mon, new Date(2026, 7, 26)), 'wed');
check('이번 주가 아니면 오늘 칸이 없다', todayKey(mon, new Date(2026, 8, 3)), null);
done('주');
