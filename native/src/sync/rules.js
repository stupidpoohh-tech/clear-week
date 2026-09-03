/*
 * 캘린더에서 받아 온 것을 이 주에 어떻게 앉히나 — **규칙만.**
 *
 * 가져오는 일(fetch)과 갈라 두었다. 규칙에는 네트워크도 기기도 필요 없으므로
 * 화면 없이 검사한다 (`tests/calendar.mjs`). 웹에서 이 규칙은 한 함수 안에
 * 통째로 들어 있어서 눈으로만 확인할 수 있었다.
 */
import { WEEK_DAYS } from '../core/week.js';
import { CAL } from './config.js';

const pad = n => String(n).padStart(2, '0');
export const dateISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export function dayDateISO(monday, key) {
  const i = WEEK_DAYS.indexOf(key);
  if (i < 0) return '';
  const d = new Date(monday);
  d.setDate(d.getDate() + i);
  return dateISO(d);
}

/*
 * 받아 온 것을 이 주에 반영한 **새 주**를 돌려준다 (원본은 건드리지 않는다).
 * 가져오기(fetch)와 갈라 두었다 — 규칙만 따로 검사할 수 있게 (`tests/calendar.mjs`).
 *
 * 저쪽 id에서 이쪽 id를 유도하므로(`dc-<origId>`) 몇 번을 받아 와도 중복이 없다.
 * **저쪽에서 사라진 것은 이쪽에서도 지우고 무덤에 남긴다** — 무덤이 있어야
 * 저쪽에서 같은 id로 되살아나도 다시 오지 않는다.
 * **이쪽에서 지운 것은 무덤이 막아 다시 안 온다.** 저쪽 문서는 그대로다.
 */
export function applyRemote(week, monday, remote, now = Date.now()) {
  const dates = {};
  WEEK_DAYS.forEach(k => { dates[dayDateISO(monday, k)] = k; });

  /* 지운 것 판정에는 kind='task' 전부가 필요하다 — 끝난 것도 "있는 것"이다.
     끝난 것을 거르는 일은 가져오는 자리에서만 한다. */
  const remoteIds = new Set();
  for (const { id, f } of remote) if (f.kind === CAL.kind) remoteIds.add(id);

  const days = { ...week.days };
  const graves = { ...week.graves };
  let changed = 0;

  for (const k of WEEK_DAYS) {
    const kept = [];
    for (const it of days[k]) {
      const id = String(it.id);
      if (id.startsWith('dc-') && !remoteIds.has(id.slice(3))) {
        graves[id] = now; changed++; continue;
      }
      kept.push(it);
    }
    if (kept.length !== days[k].length) days[k] = kept;
  }

  const have = new Set();
  for (const k of WEEK_DAYS) for (const it of days[k]) have.add(String(it.id));

  for (const { id, f } of remote) {
    if (f.kind !== CAL.kind || f.isRecurring) continue;
    if (f.task && f.task.status === 'done') continue;
    const key = dates[String(f.startDate || '')];
    if (!key) continue;
    const localId = 'dc-' + id;
    if (have.has(localId) || graves[localId]) continue;
    const text = String(f.title || '').trim();
    if (!text) continue;
    days[key] = [...days[key], {
      id: localId, text, struck: false,
      createdAt: now, updatedAt: now, strikes: [],
    }];
    have.add(localId);
    changed++;
  }

  return { week: changed ? { ...week, days, graves } : week, changed };
}

