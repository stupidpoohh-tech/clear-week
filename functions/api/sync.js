/*
 * 한 주 밀어넣고 합쳐진 것을 받아온다. 밀기와 당기기가 한 번에 일어난다 —
 * 나눠 두면 그 사이에 갈라진다.
 */
import { json, sessionEmail, sanitizeWeek, mergeWeek, blankWeek, WEEK_ID_RE } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.CLEARWEEK) return json({ error: 'storage-unconfigured' }, 503);
  const email = await sessionEmail(request, env);
  if (!email) return json({ error: 'unauthorized' }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
  const weekId = String(body.weekId || (body.week && body.week.weekId) || '');
  if (!WEEK_ID_RE.test(weekId)) return json({ error: 'bad-week' }, 400);

  const key = 'week:' + email + ':' + weekId;
  const stored = await env.CLEARWEEK.get(key, 'json');
  const merged = mergeWeek(
    sanitizeWeek(body.week, weekId),
    stored ? sanitizeWeek(stored, weekId) : blankWeek(weekId));

  await env.CLEARWEEK.put(key, JSON.stringify(merged));
  return json({ week: merged });
}
