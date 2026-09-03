/*
 * 저장 — **처음부터 App Group 컨테이너에 둔다.**
 *
 * 위젯은 Swift라 JS가 닿지 않는다. 앱과 위젯이 만나는 자리는 App Group
 * 공유 컨테이너 하나뿐이다 (HANDOFF §11). 나중에 옮기면 마이그레이션이
 * 생기므로, **처음부터 거기에 적는다** — 위젯은 이 값을 그대로 읽는다.
 *
 * iOS  : 공유 UserDefaults (`ExtensionStorage`, App Group)
 * 그 외: MMKV — 안드로이드·개발 중에만 쓰는 대체 자리다
 *
 * 저장이 막히면 **조용히 실패하지 않는다** — 머리말 아래에 알린다 (spec §5-2).
 * 그 알림은 화면 쪽이 하고, 여기서는 실패를 숨기지 않고 돌려주기만 한다.
 */
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { MMKV } from 'react-native-mmkv';

export const APP_GROUP = 'group.dev.clearweek';   /* app.json·위젯과 같은 값 */

export const PREFIX = 'clearweek:';
export const weekKey = id => PREFIX + id;
export const INDEX_KEY = PREFIX + 'index';        /* 적은 적 있는 주 목록 */
export const GUIDE_KEY = PREFIX + 'guide-seen';
export const RESET_KEY = PREFIX + 'reset-at';   /* 마지막으로 전부 비운 시각 */
export const SOUND_KEY = PREFIX + 'sound';
export const WIDGET_KEY = 'week';                 /* 위젯이 읽는 자리 */

const shared = Platform.OS === 'ios' ? new ExtensionStorage(APP_GROUP) : null;
const mmkv = shared ? null : new MMKV({ id: 'clearweek' });

let broken = null;         /* 마지막으로 막힌 이유. 화면이 이걸 보고 알린다 */
export const failure = () => broken;

function put(key, value) {
  try {
    if (shared) shared.set(key, value);
    else mmkv.set(key, value);
    broken = null;
    return true;
  } catch (e) {
    broken = String((e && e.message) || e);
    return false;
  }
}

function take(key) {
  try {
    const v = shared ? shared.get(key) : mmkv.getString(key);
    return typeof v === 'string' ? v : null;
  } catch (e) {
    broken = String((e && e.message) || e);
    return null;
  }
}

function drop(key) {
  try {
    if (shared) shared.remove(key);
    else mmkv.delete(key);
  } catch (e) { broken = String((e && e.message) || e); }
}

/* ── 주 ─────────────────────────────────────────────────────── */

export function loadWeek(weekId) {
  const raw = take(weekKey(weekId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function saveWeek(week) {
  const ok = put(weekKey(week.weekId), JSON.stringify(week));
  if (ok) addToIndex(week.weekId);
  return ok;
}

export function dropWeek(weekId) {
  drop(weekKey(weekId));
  setIndex(weekIds().filter(id => id !== weekId));
}

/* 키를 훑는 API가 공유 UserDefaults에는 없다 — 목록을 직접 들고 있는다 */
export function weekIds() {
  const raw = take(INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(v => typeof v === 'string') : [];
  } catch (e) { return []; }
}

function setIndex(list) {
  put(INDEX_KEY, JSON.stringify(Array.from(new Set(list)).sort()));
}

function addToIndex(weekId) {
  const list = weekIds();
  if (!list.includes(weekId)) setIndex([...list, weekId]);
}

export function loadAll() {
  const out = {};
  for (const id of weekIds()) {
    const w = loadWeek(id);
    if (w) out[id] = w;
  }
  return out;
}

/* ── 사람의 뜻 ──────────────────────────────────────────────── */

export const guideSeen = () => take(GUIDE_KEY) === '1';
export const setGuideSeen = v => (v ? put(GUIDE_KEY, '1') : drop(GUIDE_KEY));

/* 전부 비운 시각. **이보다 오래된 기기가 올리는 것을 서버가 막는다** —
   막지 않으면 방금 비운 것이 그 기기에서 되살아난다 (spec §11) */
export const resetAt = () => Number(take(RESET_KEY)) || 0;
export const setResetAt = v => put(RESET_KEY, String(v));

/* 이 기기의 주만 지운다. 비운 시각은 건드리지 않는다 —
   "서버 것으로 맞추기"는 서버를 비우는 것이 아니라 내 것을 버리는 것이다. */
export function clearWeeks() {
  weekIds().forEach(id => drop(weekKey(id)));
  setIndex([]);
}

/* 소리는 **꺼 둔 것만** 기억한다. 기본은 켜짐이다 */
export const soundOff = () => take(SOUND_KEY) === 'off';
export const setSoundOff = off => (off ? put(SOUND_KEY, 'off') : drop(SOUND_KEY));
