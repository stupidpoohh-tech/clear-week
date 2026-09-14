/*
 * 기기를 새로 잇거나 로그인한 직후 — 가진 주를 전부 올리고 전부 받아온다.
 * 한 번에 끝내야 그 사이에 어긋나지 않는다.
 *
 * GET은 보기만 한다 — 합치지도 쓰지도 않는다. 기기를 처음 이을 때
 * "양쪽에 다 있는지"를 먼저 알아야 물어볼 수 있다.
 */
import { json, firebaseEmail } from '../../_lib.js';
import { listWeeks, syncWeeks } from '../../_store.js';

export async function onRequestGet({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await firebaseEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  return json(await listWeeks(env, email));
}

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await firebaseEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const incoming = body.weeks && typeof body.weeks === 'object' ? body.weeks : {};
  return json(await syncWeeks(env, email, incoming, body.resetAt));
}
