import { json, readCookie, setCookie, SESSION_COOKIE } from '../../_lib.js';

export async function onRequestPost({ request, env }) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token && env.CLEARWEEK) await env.CLEARWEEK.delete('session:' + token);
  return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
}
