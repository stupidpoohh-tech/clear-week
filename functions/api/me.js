import { json, sessionEmail } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  if (!env.CLEARWEEK) return json({ email: null, ready: false });
  const email = await sessionEmail(request, env);
  return json({ email: email || null, ready: true });
}
