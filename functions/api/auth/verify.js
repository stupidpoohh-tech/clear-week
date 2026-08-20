/* 코드 확인 → 세션 쿠키. 쿠키는 HttpOnly라 스크립트가 읽지 못한다 */
import {
  json, sha256, safeEqual, randomHex, normalizeEmail, EMAIL_RE,
  setCookie, SESSION_DAYS,
} from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ error: 'bad-code' }, 400);

  const key = 'code:' + email;
  const rec = await env.CLEARWEEK.get(key, 'json');
  if (!rec) return json({ error: 'expired' }, 400);

  if (!safeEqual(rec.hash, await sha256(email + ':' + code))) {
    const tries = (rec.tries | 0) - 1;
    if (tries <= 0) await env.CLEARWEEK.delete(key);
    else await env.CLEARWEEK.put(key, JSON.stringify({ ...rec, tries }), { expirationTtl: 600 });
    return json({ error: 'wrong-code', left: Math.max(0, tries) }, 400);
  }

  await env.CLEARWEEK.delete(key);            // 코드는 한 번만 쓰인다
  const token = randomHex(32);
  await env.CLEARWEEK.put('session:' + token, email,
    { expirationTtl: SESSION_DAYS * 86400 });

  return json({ ok: true, email },
    200, { 'set-cookie': setCookie(token, SESSION_DAYS * 86400) });
}
