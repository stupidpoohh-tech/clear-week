/*
 * 서버가 준비돼 있는지만 알린다. 계정은 클라이언트가 안다 —
 * Firebase가 브라우저에서 로그인 상태를 관리하기 때문이다 (spec §11, 2026-08-24).
 *
 * `atomic`은 **같은 주에 동시에 밀 때 한 줄로 세워지는지**다 (spec §11, 2026-09-14).
 * 방(Durable Object)이 안 붙어 있으면 false로 나간다 — **되는 척하지 않는다.**
 */
import { json } from '../_lib.js';
import { isAtomic } from '../_store.js';

export async function onRequestGet({ env }) {
  return json({ ready: !!env.CLEARWEEK, atomic: isAtomic(env) });
}
