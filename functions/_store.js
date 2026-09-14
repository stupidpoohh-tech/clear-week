/*
 * Clear Week — 주를 읽고 합쳐서 쓰는 자리.
 *
 * **저장 갈래를 고르는 곳은 여기 하나다.** 손잡이(`/api/sync`·`/api/sync/all`·
 * `/api/reset`)는 어디에 적히는지 모른다. 그래야 갈래를 바꿔도 손잡이가 그대로다.
 *
 * 갈래는 둘이다.
 *
 *   1. **Durable Object** (`env.WEEK_STORE`) — 사람 하나당 방 하나.
 *      같은 사람에게 오는 요청은 그 방에서 **한 줄로 세워** 처리된다.
 *      읽고·합치고·쓰는 동안 다른 요청이 끼어들지 못한다.
 *   2. **KV만** — 예전 방식. 방이 없으면 이리로 떨어진다.
 *      **읽고 쓰는 사이가 열려 있어 동시에 밀면 한쪽이 덮인다.**
 *      배포에 방이 붙기 전까지 앱이 멈추지 않게 하려고 남겨 둔 길이지,
 *      고쳐진 길이 아니다. `/api/me`가 `atomic: false`로 그 사실을 알린다.
 *
 * **합치기 규칙은 여기에 없다.** `_lib.js`의 `mergeWeek` 하나뿐이고,
 * 두 갈래와 Durable Object 워커가 전부 그것을 부른다 (spec §11).
 */
import { sanitizeWeek, mergeWeek, blankWeek, readResetAt, ts, WEEK_ID_RE } from './_lib.js';

export const MAX_WEEKS = 400;

const weekKey = (email, id) => 'week:' + email + ':' + id;

/* 이 요청이 한 줄로 세워지는가. `/api/me`가 이 값을 내보낸다 —
   **되는 척하지 않기 위해서다** */
export const isAtomic = env => !!env.WEEK_STORE;

/* ── KV 갈래 ────────────────────────────────────────────────── */

async function kvIds(env, email) {
  const prefix = 'week:' + email + ':';
  const ids = new Set();
  let cursor;
  do {
    const page = await env.CLEARWEEK.list({ prefix, cursor });
    page.keys.forEach(k => {
      const id = k.name.slice(prefix.length);
      if (WEEK_ID_RE.test(id)) ids.add(id);
    });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && ids.size < MAX_WEEKS);
  return ids;
}

async function kvSyncWeek(env, email, weekId, incoming, clientResetAt) {
  const serverReset = await readResetAt(env, email);
  const key = weekKey(email, weekId);
  /* ★ 여기가 벌어진 자리다 — 읽고, 합치고, 쓰는 사이에 다른 기기의 요청이
     통째로 지나갈 수 있다. 그쪽이 먼저 쓴 것을 이쪽 쓰기가 덮는다. */
  const stored = await env.CLEARWEEK.get(key, 'json');

  /* 비운 뒤로 아직 못 들은 기기가 올린 것은 받지 않는다 — 되살아나기 때문이다.
     그 기기는 응답의 resetAt을 보고 자기 사본을 비운다. */
  if (serverReset > 0 && ts(clientResetAt) < serverReset) {
    return {
      week: stored ? sanitizeWeek(stored, weekId) : blankWeek(weekId),
      resetAt: serverReset, dropped: true,
    };
  }

  const merged = mergeWeek(
    sanitizeWeek(incoming, weekId),
    stored ? sanitizeWeek(stored, weekId) : blankWeek(weekId));
  await env.CLEARWEEK.put(key, JSON.stringify(merged));
  return { week: merged, resetAt: serverReset, dropped: false };
}

async function kvSyncWeeks(env, email, incoming, clientResetAt) {
  const serverReset = await readResetAt(env, email);
  const stale = serverReset > 0 && ts(clientResetAt) < serverReset;
  const ids = await kvIds(env, email);
  if (!stale) Object.keys(incoming).forEach(id => { if (WEEK_ID_RE.test(id)) ids.add(id); });

  const weeks = {};
  for (const id of Array.from(ids).slice(0, MAX_WEEKS)) {
    const key = weekKey(email, id);
    const stored = await env.CLEARWEEK.get(key, 'json');
    const mine = stale ? null : incoming[id];
    if (!mine && stored) { weeks[id] = sanitizeWeek(stored, id); continue; }
    const merged = mergeWeek(
      sanitizeWeek(mine, id),
      stored ? sanitizeWeek(stored, id) : blankWeek(id));
    await env.CLEARWEEK.put(key, JSON.stringify(merged));
    weeks[id] = merged;
  }
  return { weeks, resetAt: serverReset, dropped: stale };
}

async function kvListWeeks(env, email) {
  const weeks = {};
  for (const id of Array.from(await kvIds(env, email)).slice(0, MAX_WEEKS)) {
    const stored = await env.CLEARWEEK.get(weekKey(email, id), 'json');
    if (stored) weeks[id] = sanitizeWeek(stored, id);
  }
  return { weeks, resetAt: await readResetAt(env, email) };
}

/* 비우기는 두 갈래 모두에서 KV를 지운다 — KV는 방의 거울이기도 하다 */
async function kvWipe(env, email) {
  const prefix = 'week:' + email + ':';
  let cursor;
  do {
    const page = await env.CLEARWEEK.list({ prefix, cursor });
    for (const k of page.keys) await env.CLEARWEEK.delete(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

/* ── Durable Object 갈래 ────────────────────────────────────── */

/*
 * 방은 **사람 하나당 하나**다 (`idFromName(email)`).
 *
 * 주마다 방을 따로 두면 더 잘게 갈라지지만, `/api/sync/all`이 주 수만큼
 * 바깥 요청을 내야 한다 — Pages Functions의 서브요청 한도(무료 50)에 걸린다.
 * 사람 하나당 방 하나면 어떤 손잡이도 **바깥 요청 하나**로 끝난다.
 * 다른 사람끼리는 완전히 독립이고, 한 사람 안에서 주가 서로 기다리는 시간은
 * 저장 한 번 값이다. 한 사람이 정말로 붐비면 그때 주 단위로 쪼개면 된다.
 */
async function callRoom(env, email, payload) {
  const id = env.WEEK_STORE.idFromName(email);
  const room = env.WEEK_STORE.get(id);
  const res = await room.fetch('https://week-store/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, ...payload }),
  });
  if (!res.ok) throw new Error('week-store ' + res.status);
  return res.json();
}

/* ── 밖에서 쓰는 것 ─────────────────────────────────────────── */

export async function syncWeek(env, email, weekId, incoming, clientResetAt) {
  if (!isAtomic(env)) return kvSyncWeek(env, email, weekId, incoming, clientResetAt);
  return callRoom(env, email, {
    op: 'sync', weekId, week: incoming,
    clientResetAt: ts(clientResetAt),
    serverReset: await readResetAt(env, email),
  });
}

export async function syncWeeks(env, email, incoming, clientResetAt) {
  if (!isAtomic(env)) return kvSyncWeeks(env, email, incoming, clientResetAt);
  return callRoom(env, email, {
    op: 'all', weeks: incoming,
    clientResetAt: ts(clientResetAt),
    serverReset: await readResetAt(env, email),
  });
}

export async function listWeeks(env, email) {
  if (!isAtomic(env)) return kvListWeeks(env, email);
  return callRoom(env, email, {
    op: 'list', serverReset: await readResetAt(env, email),
  });
}

/*
 * 계정을 지운다 (P1-5). 비우기와 다른 점 하나: **비운 시각도 남기지 않는다.**
 * 계정이 사라지므로 "이보다 오래된 기기는 막아라"를 남겨 둘 대상이 없다.
 * 같은 주소로 다시 가입하면 빈 서버에서 새로 시작한다.
 *
 * Firebase 계정 자체는 여기서 지우지 않는다 — 그것은 기기가 자기 토큰으로 한다.
 * 서버가 남의 계정을 지울 권한을 갖지 않게 두는 편이 낫다.
 */
export async function deleteUser(env, email) {
  await kvWipe(env, email);
  await env.CLEARWEEK.delete('reset:' + email);
  if (isAtomic(env)) await callRoom(env, email, { op: 'wipe', serverReset: Date.now() });
  return { ok: true };
}

/*
 * 전부 비우기 — **방과 거울을 함께 비운다.**
 * 방만 두고 KV만 지우면 다음 요청에서 방이 옛 주를 도로 내놓는다.
 * 비운 시각은 KV에 남는다 (`reset:<email>`) — 방이 없는 갈래도 그것을 읽는다.
 */
export async function wipeAll(env, email, now = Date.now()) {
  await kvWipe(env, email);
  await env.CLEARWEEK.put('reset:' + email, String(now));
  if (isAtomic(env)) await callRoom(env, email, { op: 'wipe', serverReset: now });
  return { resetAt: now };
}
