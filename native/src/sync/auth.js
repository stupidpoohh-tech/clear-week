/*
 * 로그인 — Firebase Auth REST. SDK를 넣지 않는다 (fetch 하나면 된다).
 *
 * 이메일+비밀번호, 없으면 자동으로 만든다 — 사용자는 자기가 계정을 만들었는지
 * 기억할 필요가 없다.
 *
 * **긴 것은 키체인에, 짧은 것은 메모리에.** refresh만 `expo-secure-store`에
 * 남기고 idToken은 들고 있지 않는다. 웹은 localStorage밖에 없어 refresh를
 * 거기 두었는데, 네이티브에는 키체인이 있다 — 웹보다 나아지는 몇 안 되는 자리다.
 *
 * **새 계정은 메일 인증을 마쳐야 서버와 이어진다** (spec §18-1, 웹과 같은 규칙).
 * 서버는 Firebase가 메일 주인을 확인한 계정만 받는다(`email_verified`).
 * 그런데 가입만 하고 인증 메일을 보내지 않으면 그 사람은 영영 이어지지 않는데
 * 화면은 이어진 것처럼 보인다. 그래서 **여기서 메일까지 보낸다.**
 * 서버 검증을 낮추는 방식은 쓰지 않는다.
 *
 * **인증 상태를 화면 여기저기에 두지 않는다.** 이 파일 하나가 들고,
 * 화면은 `state.verified`를 읽기만 한다.
 */
import * as SecureStore from 'expo-secure-store';
import { FIREBASE, SYNC } from './config.js';
import { resendLeft, canSend, deniedMeans } from './verify.js';

const REFRESH_KEY = 'clearweek.refresh';
const EMAIL_KEY = 'clearweek.email';
const UID_KEY = 'clearweek.uid';
const VERIFIED_KEY = 'clearweek.verified';

export const state = {
  email: null, uid: null, refresh: null,
  token: null, tokenAt: 0,
  verified: false,          // 메일 인증이 끝났는지 — 끝나야 서버로 나간다
  mailAt: 0, mailBusy: false,
};

const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const announce = () => listeners.forEach(fn => fn());

async function post(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error('network'); err.code = 'network'; throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const e = (data && data.error) || {};
    const err = new Error(e.message || String(res.status));
    err.status = res.status; err.code = e.message || '';
    throw err;
  }
  return data || {};
}

const fb = path => 'https://identitytoolkit.googleapis.com/v1/accounts:' + path +
  '?key=' + FIREBASE.apiKey;

async function land(out, fresh) {
  state.email = String(out.email || '').toLowerCase();
  state.uid = out.localId;
  state.refresh = out.refreshToken;
  state.token = out.idToken;
  state.tokenAt = Date.now();
  state.verified = false;
  state.mailAt = 0;
  await remember();
  announce();
  /* 방금 만든 계정 — 메일부터 보낸다. 이어지는 것은 인증 뒤의 일이다 */
  if (fresh) return { sent: await sendVerifyMail(true) };
  return { verified: await confirm({ quiet: true }) };
}

async function remember() {
  await SecureStore.setItemAsync(REFRESH_KEY, state.refresh || '');
  await SecureStore.setItemAsync(EMAIL_KEY, state.email || '');
  await SecureStore.setItemAsync(UID_KEY, String(state.uid || ''));
  await SecureStore.setItemAsync(VERIFIED_KEY, state.verified ? '1' : '0');
}

export async function signIn(email, password) {
  return land(await post(fb('signInWithPassword'),
    { email, password, returnSecureToken: true }));
}

export async function signUp(email, password) {
  return land(await post(fb('signUp'),
    { email, password, returnSecureToken: true }), true);
}

export async function restore() {
  state.refresh = await SecureStore.getItemAsync(REFRESH_KEY) || null;
  state.email = await SecureStore.getItemAsync(EMAIL_KEY) || null;
  state.uid = await SecureStore.getItemAsync(UID_KEY) || null;
  /* 이 자리가 없는 것은 이 변경 전에 저장된 기기다. 그때는 인증된 계정만
     서버에 닿을 수 있었으므로 쓰던 사람으로 본다 — 틀렸으면 서버가 401로
     알려 주고 `denied()`가 바로잡는다 (spec §18-1). */
  const mark = await SecureStore.getItemAsync(VERIFIED_KEY);
  state.verified = !!state.refresh && mark !== '0';
  announce();
  return !!state.refresh;
}

export async function logout() {
  state.email = null; state.uid = null; state.refresh = null;
  state.token = null; state.tokenAt = 0;
  state.verified = false; state.mailAt = 0;
  for (const k of [REFRESH_KEY, EMAIL_KEY, UID_KEY, VERIFIED_KEY]) {
    await SecureStore.deleteItemAsync(k).catch(() => {});
  }
  announce();
}

export const signedIn = () => !!state.refresh;
/* **이어져 있다 = 로그인 + 인증.** 화면은 이 하나만 보면 된다 */
export const linked = () => !!state.refresh && state.verified;

/* 짧은 idToken은 필요할 때 새로 받는다.
   refresh가 죽었으면 통째로 로그아웃한다 — **이어져 있는 척하면 안 된다.** */
export async function idToken() {
  if (state.token && Date.now() - state.tokenAt < SYNC.tokenTtlMs) return state.token;
  if (!state.refresh) { const e = new Error('no-refresh'); e.status = 401; throw e; }
  let out;
  try {
    out = await post('https://securetoken.googleapis.com/v1/token?key=' + FIREBASE.apiKey,
      { grant_type: 'refresh_token', refresh_token: state.refresh });
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      await logout();
      const err = new Error('expired'); err.status = 401; throw err;
    }
    throw e;
  }
  state.token = out.id_token;
  state.tokenAt = Date.now();
  state.uid = out.user_id || state.uid;
  if (out.refresh_token && out.refresh_token !== state.refresh) {
    state.refresh = out.refresh_token;
    await SecureStore.setItemAsync(REFRESH_KEY, state.refresh);
  }
  return state.token;
}

/* ── 메일 인증 ──────────────────────────────────────────────── */

/* 언제 다시 보낼 수 있나 (초). 규칙은 `verify.js`에 있다 */
export const resendIn = (now = Date.now()) => resendLeft(state.mailAt, now);

/*
 * 인증 메일 보내기. **중복 요청을 막는다** — 두 번 눌러도 한 번만 나가고,
 * 보낸 지 얼마 안 됐으면 남은 시간을 알린다. Firebase 쪽 한도에 걸려 아무 말
 * 없이 안 나가는 것보다 이쪽이 낫다.
 * 돌려주는 것: { ok, reason, sec }
 */
export async function sendVerifyMail(first) {
  const gate = canSend({ first, busy: state.mailBusy, mailAt: state.mailAt });
  if (!gate.ok) return gate;
  state.mailBusy = true;
  try {
    const token = await idToken();
    await post(fb('sendOobCode'), { requestType: 'VERIFY_EMAIL', idToken: token });
    state.mailAt = Date.now();
    return { ok: true, first: !!first };
  } catch (e) {
    return { ok: false, reason: 'failed', code: e.code || '' };
  } finally {
    state.mailBusy = false;
  }
}

/*
 * 인증이 끝났는지 **Firebase에 직접 물어본다.**
 * 끝났으면 토큰을 새로 받는다 — 서버가 보는 것은 토큰 안의 `email_verified`라,
 * 인증 전에 받은 토큰을 계속 쓰면 서버는 여전히 아니라고 한다.
 */
export async function lookupVerified() {
  const token = await idToken();
  const out = await post(fb('lookup'), { idToken: token });
  const user = (out.users && out.users[0]) || {};
  if (!user.emailVerified) return false;
  state.token = null; state.tokenAt = 0;
  await idToken();
  return true;
}

/* 인증 확인 — 끝났으면 그때부터 이어진다. `quiet`면 아직이어도 다그치지 않는다 */
export async function confirm({ quiet = false } = {}) {
  let ok;
  try { ok = await lookupVerified(); }
  catch (e) {
    if (quiet) return false;
    throw e;
  }
  const changed = ok !== state.verified;
  state.verified = ok;
  await SecureStore.setItemAsync(VERIFIED_KEY, ok ? '1' : '0');
  if (changed) announce();
  return ok;
}

/*
 * 서버가 거절했다(401). **인증 전인 것과 로그인이 죽은 것은 다르다** —
 * 인증 전이라고 로그아웃시키면 이 기기에 적은 것과의 연결이 끊긴다.
 */
export async function denied() {
  let ok = null;
  try { ok = await lookupVerified(); } catch (e) { ok = null; }
  const how = deniedMeans(ok);
  if (how === 'logged-out') { await logout(); return how; }
  if (how === 'unverified') {
    state.verified = false;
    await SecureStore.setItemAsync(VERIFIED_KEY, '0');
    announce();
  }
  return how;
}

/* ── 계정 삭제 (P1-5) ───────────────────────────────────────── */

/*
 * **Firebase 계정 자체를 지운다.** 서버(Clear Week)의 주는 `server.js`가
 * 따로 지운다 — 순서가 중요하다: 서버 것을 먼저 지우고, 그다음 계정을 지운다.
 * 계정을 먼저 지우면 토큰이 죽어 서버 것을 지울 수 없다.
 *
 * 오래 로그인해 둔 계정은 Firebase가 최근 로그인을 요구한다
 * (`CREDENTIAL_TOO_OLD_LOGIN_AGAIN`). 그때는 다시 로그인한 뒤에 하면 된다 —
 * **말없이 실패하지 않는다.**
 */
export async function deleteAccount() {
  const token = await idToken();
  await post(fb('delete'), { idToken: token });
  await logout();
}
