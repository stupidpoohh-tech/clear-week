/*
 * 말 — 한국어와 영어.
 *
 * **문자열을 화면에 박아 두지 않는다.** 여기 한 곳에 모아 두면 말을 하나 더
 * 늘릴 때 손댈 자리가 이 폴더뿐이다. 지금은 둘만 있지만, 일본어·중국어·유럽어를
 * 넣을 자리가 이미 열려 있다 — `ko.js` 옆에 파일 하나를 더 두고 `PACKS`에
 * 적으면 된다. **이번에는 둘만 넣는다.**
 *
 * 날짜와 요일은 번역하지 않는다. `Intl`이 기기의 말로 만들어 준다 —
 * 우리가 요일 이름을 들고 있으면 언어를 늘릴 때마다 그것도 따라 늘어난다.
 *
 * **한 주가 월요일에 시작하는 것은 말과 무관하다** (spec §3). 영어권에서
 * 일요일 시작이 흔하지만, 이 제품은 월~일 한 장이 뼈대다 — 바꾸지 않는다.
 */
import ko from './ko.js';
import en from './en.js';

export const PACKS = { ko, en };
export const FALLBACK = 'en';

let lang = FALLBACK;
let locale = 'en-US';
const listeners = new Set();

/* 기기 말에서 우리가 가진 것을 고른다. `ko-KR`·`ko` 둘 다 한국어다 */
export function pick(tags) {
  for (const tag of Array.isArray(tags) ? tags : [tags]) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (PACKS[base]) return base;
  }
  return FALLBACK;
}

export function setLocale(tags) {
  const list = Array.isArray(tags) ? tags : [tags];
  lang = pick(list);
  locale = String(list.find(Boolean) || lang);
  listeners.forEach(fn => fn(lang));
  return lang;
}

export const getLang = () => lang;
export const getLocale = () => locale;
export const onLocale = fn => { listeners.add(fn); return () => listeners.delete(fn); };

/*
 * 말 하나를 꺼낸다. 없으면 영어로, 그것도 없으면 열쇠 자체를 돌려준다 —
 * **화면이 비는 것보다 열쇠라도 보이는 것이 낫다** (빠진 자리를 바로 알아본다).
 * `{이름}` 자리는 `vars`로 채운다.
 */
export function t(key, vars) {
  const line = (PACKS[lang] && PACKS[lang][key]) ||
    (PACKS[FALLBACK] && PACKS[FALLBACK][key]) || key;
  if (!vars) return line;
  return line.replace(/\{(\w+)\}/g, (m, name) =>
    (vars[name] === undefined ? m : String(vars[name])));
}

/* ── 날짜 — 기기의 말로 ───────────────────────────────────── */

/* 머리말의 날짜 — **모양은 말이 정한다.** `Intl`의 긴 형태는 머리말에 안 들어가고
   (`2026. 8. 24.-8. 30.`), 이 자리는 좁다. 그래서 꼴을 말 꾸러미에 둔다 */
export function rangeLabel(monday) {
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  return t('date.range', {
    y: monday.getFullYear(),
    m1: monday.getMonth() + 1, d1: monday.getDate(),
    m2: end.getMonth() + 1, d2: end.getDate(),
  });
}

/* 칸 라벨의 요일 한 글자 — 한국어는 월화수…, 영어는 M T W… */
export function dayInitial(date) {
  try {
    const s = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date);
    if (s) return s;
  } catch (e) { /* Intl이 없으면 아래로 */ }
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getDay()];
}
