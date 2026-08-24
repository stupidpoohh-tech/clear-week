/*
 * 서버가 준비돼 있는지만 알린다. 계정은 클라이언트가 안다 —
 * Firebase가 브라우저에서 로그인 상태를 관리하기 때문이다 (spec §11, 2026-08-24).
 * 예전에는 여기서 쿠키를 읽어 email을 돌려주었으나, Firebase로 통일한 뒤로는
 * 서버가 세션을 들고 있지 않다.
 */
import { json } from '../_lib.js';

export async function onRequestGet({ env }) {
  return json({ ready: !!env.CLEARWEEK });
}
