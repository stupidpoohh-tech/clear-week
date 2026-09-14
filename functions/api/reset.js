/*
 * 전부 비우기 — 서버의 모든 주를 지우고, 비운 시각을 남긴다.
 * 시각을 남기지 않으면 다른 기기가 자기 사본을 다시 밀어 올려 되살아난다.
 * 방(Durable Object)이 붙어 있으면 방도 함께 비운다 — `_store.js`가 맡는다.
 */
import { json, firebaseEmail } from '../_lib.js';
import { wipeAll } from '../_store.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await firebaseEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  const out = await wipeAll(env, email);
  return json({ ok: true, resetAt: out.resetAt });
}
