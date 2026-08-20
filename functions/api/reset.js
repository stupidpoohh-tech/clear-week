/*
 * 전부 비우기 — 서버의 모든 주를 지우고, 비운 시각을 남긴다.
 * 시각을 남기지 않으면 다른 기기가 자기 사본을 다시 밀어 올려 되살아난다.
 */
import { json, sessionEmail } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);

  const prefix = 'week:' + email + ':';
  let cursor;
  do {
    const page = await env.CLEARWEEK.list({ prefix, cursor });
    for (const k of page.keys) await env.CLEARWEEK.delete(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const now = Date.now();
  await env.CLEARWEEK.put('reset:' + email, String(now));
  return json({ ok: true, resetAt: now });
}
