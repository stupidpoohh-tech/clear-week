/*
 * 기기를 새로 잇거나 로그인한 직후 — 가진 주를 전부 올리고 전부 받아온다.
 * 한 번에 끝내야 그 사이에 어긋나지 않는다.
 */
import { json, sessionEmail, sanitizeWeek, mergeWeek, blankWeek, readResetAt, ts, WEEK_ID_RE } from '../../_lib.js';

const MAX_WEEKS = 400;

async function listIds(env, prefix) {
  const ids = new Set();
  let cursor;
  do {
    const page = await env.CLEARWEEK.list({ prefix, cursor });
    page.keys.forEach(k => ids.add(k.name.slice(prefix.length)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && ids.size < MAX_WEEKS);
  return ids;
}

/* 서버에 무엇이 있는지 보기만 한다 — 합치지도 쓰지도 않는다.
   기기를 처음 이을 때 "양쪽에 다 있는지"를 먼저 알아야 물어볼 수 있다. */
export async function onRequestGet({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);

  const prefix = 'week:' + email + ':';
  const weeks = {};
  for (const id of Array.from(await listIds(env, prefix)).slice(0, MAX_WEEKS)) {
    if (!WEEK_ID_RE.test(id)) continue;
    const stored = await env.CLEARWEEK.get(prefix + id, 'json');
    if (stored) weeks[id] = sanitizeWeek(stored, id);
  }
  return json({ weeks, resetAt: await readResetAt(env, email) });
}

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const incoming = body.weeks && typeof body.weeks === 'object' ? body.weeks : {};

  const prefix = 'week:' + email + ':';
  const serverReset = await readResetAt(env, email);
  const stale = serverReset > 0 && ts(body.resetAt) < serverReset;
  const ids = await listIds(env, prefix);

  if (!stale) Object.keys(incoming).forEach(id => { if (WEEK_ID_RE.test(id)) ids.add(id); });

  const weeks = {};
  for (const id of Array.from(ids).slice(0, MAX_WEEKS)) {
    if (!WEEK_ID_RE.test(id)) continue;
    const key = prefix + id;
    const stored = await env.CLEARWEEK.get(key, 'json');
    const mine = stale ? null : incoming[id];
    if (!mine && stored) { weeks[id] = sanitizeWeek(stored, id); continue; }
    const merged = mergeWeek(
      sanitizeWeek(mine, id),
      stored ? sanitizeWeek(stored, id) : blankWeek(id));
    await env.CLEARWEEK.put(key, JSON.stringify(merged));
    weeks[id] = merged;
  }
  return json({ weeks, resetAt: serverReset, dropped: stale });
}
