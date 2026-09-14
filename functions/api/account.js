/*
 * 계정 삭제 (P1-5) — **서버에 있는 이 사람의 주를 전부 지운다.**
 *
 * Firebase 계정 자체는 기기가 자기 토큰으로 지운다(`accounts:delete`).
 * 서버가 남의 계정을 지울 권한을 들고 있지 않게 두는 편이 낫다 —
 * 여기 있는 힘은 "내 토큰으로 내 데이터를 지운다"까지다.
 *
 * 순서는 기기가 지킨다: **서버 것을 먼저, 계정을 나중에.**
 * 계정을 먼저 지우면 토큰이 죽어 서버 것을 지울 수 없다.
 */
import { json, firebaseEmail } from '../_lib.js';
import { deleteUser } from '../_store.js';

export async function onRequestDelete({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await firebaseEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  await deleteUser(env, email);
  return json({ ok: true });
}
