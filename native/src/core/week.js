/*
 * 주(week) 계산 — ISO 주, 월요일 기준.
 * 웹과 **같은 weekId**를 만들어야 한다. 서버 저장 키가 그것이다 (`week:<email>:<weekId>`).
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'free'];
export const WEEK_DAYS = DAY_KEYS.slice(0, 7);
const DAY_INITIAL = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7;   /* 일요일(0)을 주의 끝으로 민다 */
  d.setDate(d.getDate() - shift);
  return d;
}

export function addWeeks(monday, n) {
  const d = new Date(monday);
  d.setDate(d.getDate() + n * 7);
  return d;
}

/* ISO 주 번호. 목요일이 든 해가 그 주의 해다 */
export function weekIdOf(date) {
  const d = mondayOf(date);
  const thu = new Date(d);
  thu.setDate(thu.getDate() + 3);
  const jan1 = new Date(thu.getFullYear(), 0, 1);
  const week = Math.floor((thu - jan1) / 86400000 / 7) + 1;
  return thu.getFullYear() + '-W' + String(week).padStart(2, '0');
}

/* 머리말 — "2026. 8.24-8.30" */
export function rangeLabel(monday) {
  const a = new Date(monday);
  const b = new Date(monday);
  b.setDate(b.getDate() + 6);
  return `${a.getFullYear()}. ${a.getMonth() + 1}.${a.getDate()}-${b.getMonth() + 1}.${b.getDate()}`;
}

/* 칸 라벨 — 요일 칸은 "24.M", 8번째 칸은 note */
export function cellLabel(key, monday) {
  if (key === 'free') return 'note';
  const i = WEEK_DAYS.indexOf(key);
  const d = new Date(monday);
  d.setDate(d.getDate() + i);
  return d.getDate() + '.' + DAY_INITIAL[i];
}

export const isThisWeek = (monday, now = new Date()) =>
  weekIdOf(monday) === weekIdOf(now);

/* 오늘 칸 — 이번 주가 아니면 없다. 오늘을 진하게 칠하는 데 쓴다 */
export function todayKey(monday, now = new Date()) {
  if (!isThisWeek(monday, now)) return null;
  return WEEK_DAYS[(now.getDay() + 6) % 7];
}
