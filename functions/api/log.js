/*
 * 방문자 행동로그 받는 곳 — 모아서 온 것을 Analytics Engine에 옮겨 적는다.
 *
 * 이 길은 **언제나 조용히 성공한다.** 로그가 앱을 망가뜨리는 일은 없어야 한다.
 * 바인딩이 없어도, 몸통이 깨졌어도 204를 돌려준다 —
 * 클라이언트는 로그가 켜져 있는지조차 알 필요가 없다 (spec §14).
 */
import { sanitizeBatch, toDataPoint, platformOf } from '../_log.js';

const noContent = () => new Response(null, {
  status: 204,
  headers: { 'cache-control': 'no-store' },
});

export async function onRequestPost({ request, env }) {
  /* 데이터셋을 안 묶었으면 **받을 자리가 없다고 분명히 말한다.**
     여기서 204(성공)를 돌려주면 클라이언트는 잘 간 줄 알고 5초마다 영원히
     보내고, 서버는 그걸 전부 버린다 — 아무도 안 보는 짐만 오간다.
     501을 받으면 클라이언트가 스스로 그만둔다 (spec §14). */
  if (!env.CLEARWEEK_LOG) {
    return new Response(null, { status: 501, headers: { 'cache-control': 'no-store' } });
  }

  let body = null;
  try { body = await request.json(); } catch (e) { return noContent(); }

  const events = sanitizeBatch(body);
  if (!events.length) return noContent();

  const cf = request.cf || {};
  const ctx = {
    country: typeof cf.country === 'string' ? cf.country.slice(0, 2).toLowerCase() : 'xx',
    platform: platformOf(request.headers.get('user-agent')),
  };

  /* IP는 담지 않는다. 나라와 갈래까지가 이 로그가 아는 전부다. */
  for (const e of events) {
    try { env.CLEARWEEK_LOG.writeDataPoint(toDataPoint(e, ctx)); } catch (err) { /* 조용히 */ }
  }
  return noContent();
}

/* POST만 내보낸다 — sendBeacon이 쓰는 방법이 그것뿐이고,
   Pages는 없는 방법에 알아서 405를 돌려준다. */
