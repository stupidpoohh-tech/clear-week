/*
 * 데이터 모델 — 웹과 **똑같이** (HANDOFF §5). 서버가 이 모양을 받는다.
 *
 * {
 *   weekId, days: { mon:[{id,text,struck,createdAt,updatedAt,strikes}], …, free:[] },
 *   notes:{mon:''}, noteAt:{mon:0}, noteStrikes:{mon:[]}, graves:{ id: 지운시각 }
 * }
 *
 * 규칙 넷:
 *   1. graves가 없으면 한쪽에서 지운 것이 다른 쪽에서 되살아난다.
 *   2. 메모는 글자와 획이 한 몸이다 — noteAt 하나로 이긴 쪽을 통째로 가져온다.
 *   3. 열 수는 저장하지 않는다. 매번 계산한다.
 *   4. **합치기 규칙은 한 곳에만 둔다** — 서버의 `functions/_lib.js`다.
 *      네이티브는 합치지 않는다. 올리고, 서버가 합쳐 준 것을 받는다.
 *
 * 시각은 1e12를 넘으므로 `|0`을 쓰면 안 된다.
 */
import { DAY_KEYS } from './week.js';

export const ts = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

let seq = 0;
export function newId() {
  seq = (seq + 1) % 1e6;
  return Date.now().toString(36) + '-' + seq.toString(36) +
    '-' + Math.floor(Math.random() * 1e6).toString(36);
}

export const newSeed = () => (Math.random() * 2147483647) | 0;

export function blankWeek(weekId) {
  const days = {}, notes = {}, noteAt = {}, noteStrikes = {};
  DAY_KEYS.forEach(k => {
    days[k] = []; notes[k] = ''; noteAt[k] = 0; noteStrikes[k] = [];
  });
  return { weekId, days, notes, noteAt, noteStrikes, graves: {} };
}

const strikeList = (raw, max) => (Array.isArray(raw) ? raw.slice(0, max).map(s => ({
  line: Number(s && s.line) || 0,
  a: Number(s && s.a) || 0,
  b: Number(s && s.b) || 0,
  seed: Number(s && s.seed) || 0,
})) : []);

/* 저장·서버·백업에서 들어온 것은 모양을 믿지 않는다 */
export function sanitizeWeek(raw, weekId) {
  const w = blankWeek(weekId || (raw && raw.weekId) || '');
  if (!raw || typeof raw !== 'object') return w;
  DAY_KEYS.forEach(k => {
    const list = raw.days && Array.isArray(raw.days[k]) ? raw.days[k] : [];
    w.days[k] = list.slice(0, 500).map(it => ({
      id: String((it && it.id) || ''),
      text: String((it && it.text) || '').slice(0, 500),
      struck: !!(it && it.struck),
      createdAt: ts(it && it.createdAt),
      updatedAt: ts(it && it.updatedAt) || ts(it && it.createdAt),
      strikes: strikeList(it && it.strikes, 40),
    })).filter(it => it.id);
    w.notes[k] = raw.notes && typeof raw.notes[k] === 'string' ? raw.notes[k].slice(0, 200) : '';
    w.noteAt[k] = ts(raw.noteAt && raw.noteAt[k]);
    w.noteStrikes[k] = strikeList(raw.noteStrikes && raw.noteStrikes[k], 8);
  });
  const graves = raw.graves && typeof raw.graves === 'object' ? raw.graves : {};
  for (const id of Object.keys(graves).slice(0, 2000)) {
    const t = ts(graves[id]);
    if (t) w.graves[String(id)] = t;
  }
  return w;
}

export const isEmptyWeek = w => DAY_KEYS.every(k =>
  (!w.days[k] || !w.days[k].length) && !(w.notes && w.notes[k]));

/* ── 손질 함수들 — 전부 **새 객체를 돌려준다** ──────────────────
   화면이 다시 그려져야 할 것과 아닌 것을 참조로 가릴 수 있게, 바꾼 자리만
   새 객체로 만든다. 그은 획이 들어와도 다른 칸은 그대로다. */

const touch = (w, k, list) => ({ ...w, days: { ...w.days, [k]: list } });

export function addItem(w, key, text, at = Date.now()) {
  const item = {
    id: newId(), text: String(text).slice(0, 500), struck: false,
    createdAt: at, updatedAt: at, strikes: [],
  };
  return { week: touch(w, key, [...w.days[key], item]), item };
}

export function editItem(w, key, id, text, at = Date.now()) {
  return touch(w, key, w.days[key].map(it =>
    it.id === id ? { ...it, text: String(text).slice(0, 500), updatedAt: at } : it));
}

/* 지운 표시를 남긴다. 없으면 다른 기기에서 되살아난다 */
export function removeItem(w, key, id, at = Date.now()) {
  return {
    ...w,
    days: { ...w.days, [key]: w.days[key].filter(it => it.id !== id) },
    graves: { ...w.graves, [id]: at },
  };
}

/* 획 하나를 남긴다 — 좌표가 아니라 시드 + 줄 안에서의 비율 (HANDOFF §4-6) */
export function addStrike(w, key, id, rec, at = Date.now()) {
  return touch(w, key, w.days[key].map(it => it.id === id
    ? { ...it, strikes: [...it.strikes, rec], struck: true, updatedAt: at }
    : it));
}

/* 그어진 획 하나를 지운다. 다 지워지면 struck도 내려간다 */
export function removeStrike(w, key, id, index, at = Date.now()) {
  return touch(w, key, w.days[key].map(it => {
    if (it.id !== id) return it;
    const strikes = it.strikes.filter((_, i) => i !== index);
    return { ...it, strikes, struck: strikes.length > 0, updatedAt: at };
  }));
}

/* 메모 — 글자와 획이 한 몸이므로 noteAt을 함께 올린다 */
export function setNote(w, key, text, at = Date.now()) {
  return {
    ...w,
    notes: { ...w.notes, [key]: String(text).slice(0, 200) },
    noteAt: { ...w.noteAt, [key]: at },
  };
}

export function setNoteStrikes(w, key, strikes, at = Date.now()) {
  return {
    ...w,
    noteStrikes: { ...w.noteStrikes, [key]: strikes.slice(0, 8) },
    noteAt: { ...w.noteAt, [key]: at },
  };
}

/* 메모 삭제 — 글자와 획이 함께 사라진다 */
export function clearNote(w, key, at = Date.now()) {
  return {
    ...w,
    notes: { ...w.notes, [key]: '' },
    noteStrikes: { ...w.noteStrikes, [key]: [] },
    noteAt: { ...w.noteAt, [key]: at },
  };
}
