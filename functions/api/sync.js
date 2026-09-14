/*
 * 한 주 밀어넣고 합쳐진 것을 받아온다. 밀기와 당기기가 한 번에 일어난다 —
 * 나눠 두면 그 사이에 갈라진다.
 *
 * **어디에 어떻게 적히는지는 여기서 모른다** (`_store.js`가 고른다).
 * 이 손잡이가 하는 일은 셋이다: 누구인지 확인하고, 주 이름을 검사하고, 넘긴다.
 */
import { json, firebaseEmail, WEEK_ID_RE } from '../_lib.js';
import { syncWeek } from '../_store.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await firebaseEmail(request);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const weekId = String(body.weekId || (body.week && body.week.weekId) || '');
  if (!WEEK_ID_RE.test(weekId)) return json({ error: 'bad-week' }, 400);

  return json(await syncWeek(env, email, weekId, body.week, body.resetAt));
}
