/*
 * 캘린더(Dada Calendar)에서 **받아만 온다** (spec §15).
 *
 * **한 방향이다.** 이쪽에서 적은 것도 지운 것도 저쪽으로 안 간다.
 * 일정의 원본은 캘린더에 있고, 주간표는 그것을 종이 위에 펼쳐 보는 자리다 —
 * **종이에 그은 것이 원본을 바꾸면 안 된다.**
 * 그래서 이 파일에는 쓰기가 없다. 읽기(runQuery) 하나뿐이다.
 *
 * SDK를 넣지 않는다. REST에 그냥 fetch한다 (CORS도 중계 서버도 필요 없다).
 */
import { idToken, state } from './auth.js';
import { FIREBASE } from './config.js';
import { WEEK_DAYS } from '../core/week.js';
import { applyRemote, dayDateISO } from './rules.js';

export { applyRemote, dayDateISO, dateISO } from './rules.js';

function fsRead(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsRead);
  if ('mapValue' in v) return fsPlain(v.mapValue.fields || {});
  return null;
}
const fsPlain = fields => {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = fsRead(fields[k]);
  return out;
};

const base = () => 'https://firestore.googleapis.com/v1/projects/' + FIREBASE.projectId +
  '/databases/(default)/documents/users/' + state.uid;

async function fetchMonths(months, token) {
  const res = await fetch(base() + ':runQuery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'entries' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'ymSpan' },
            op: 'ARRAY_CONTAINS_ANY',
            value: { arrayValue: { values: months.map(m => ({ stringValue: m })) } },
          },
        },
      },
    }),
  });
  if (!res.ok) throw Object.assign(new Error('calendar'), { status: res.status });
  const rows = await res.json().catch(() => []);
  const found = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row && row.document;
    if (!doc || !doc.name) continue;
    found.push({
      id: doc.name.slice(doc.name.lastIndexOf('/') + 1),
      f: fsPlain(doc.fields || {}),
    });
  }
  return found;
}

/* 받아 오기 — 이 주에 걸린 달을 물어보고, 위 규칙으로 반영한다.
   **받아 오는 때는 주 이동과 로그인 직후뿐이다** (spec §15) */
export async function pull(week, monday, now = Date.now()) {
  const token = await idToken();
  const months = Array.from(new Set(
    WEEK_DAYS.map(k => dayDateISO(monday, k).slice(0, 7))));
  const remote = await fetchMonths(months, token);
  return applyRemote(week, monday, remote, now);
}
