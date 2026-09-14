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

/*
 * 주가 넘어갔나 (P1-2) — **앱을 며칠 켜 둔 채로 두어도 이번 주가 따라간다.**
 *
 * 일요일 밤에 열어 둔 화면이 월요일 아침에도 지난주를 보여 주면, 거기에 적은
 * 것이 지난주로 들어간다. 그래서 앱이 앞으로 돌아올 때와 자정을 지날 때
 * 이것을 물어본다.
 *
 * **보고 있던 주가 이번 주였을 때만** 옮긴다. 사람이 일부러 지난주를 펴 둔
 * 것이라면 그대로 둔다 — 지난 주도 고쳐 쓸 수 있는 제품이다 (spec §3).
 * **옮기는 것은 화면뿐이다. 항목은 따라가지 않는다** (자동 이월 없음, 규칙 2).
 */
export function rolledOver(shownMonday, wasThisWeek, now = new Date()) {
  if (!wasThisWeek) return false;
  return weekIdOf(shownMonday) !== weekIdOf(now);
}

/* 다음 주가 시작할 때까지 남은 밀리초. 타이머를 그때에 맞춘다 */
export function untilNextWeek(now = new Date()) {
  const next = addWeeks(mondayOf(now), 1);
  return Math.max(1000, next.getTime() - now.getTime());
}
