/* 코드 보내기 — 링크가 아니라 6자리 코드다.
   홈 화면 앱과 사파리는 저장소를 따로 쓴다. 메일의 링크를 누르면 사파리가 열리고
   홈 화면 앱은 여전히 로그아웃 상태다. 코드는 앱을 벗어나지 않는다. */
import {
  json, sixDigitCode, sha256, normalizeEmail, EMAIL_RE,
  allowedEmail, CODE_TTL_SEC, CODE_TRIES,
} from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email)) return json({ error: 'bad-email' }, 400);

  const allowed = allowedEmail(env, email);
  if (allowed === null) return json({ error: 'allowlist-unconfigured' }, 503);
  if (!allowed) return json({ error: 'not-allowed' }, 403);
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return json({ error: 'mail-unconfigured' }, 503);

  /* 1분에 세 번까지 */
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  for (const key of ['rl:mail:' + email, 'rl:ip:' + ip]) {
    const n = Number(await env.CLEARWEEK.get(key)) || 0;
    if (n >= 3) return json({ error: 'too-many' }, 429);
    await env.CLEARWEEK.put(key, String(n + 1), { expirationTtl: 60 });
  }

  const code = sixDigitCode();
  await env.CLEARWEEK.put('code:' + email,
    JSON.stringify({ hash: await sha256(email + ':' + code), tries: CODE_TRIES }),
    { expirationTtl: CODE_TTL_SEC });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.RESEND_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: 'Clear Week 로그인 코드 ' + code,
      text: code + '\n\n앱에 이 여섯 자리를 넣으세요. 10분 뒤에 만료됩니다.\n'
          + '요청한 적이 없다면 그냥 두세요.',
    }),
  });
  if (!res.ok) {
    await env.CLEARWEEK.delete('code:' + email);
    return json({ error: 'mail-failed' }, 502);
  }
  return json({ ok: true });
}
