/*
 * 로그인 — Firebase Auth REST. SDK를 넣지 않는다 (fetch 하나면 된다).
 *
 * 이메일+비밀번호, 없으면 자동으로 만든다 — 사용자는 자기가 계정을 만들었는지
 * 기억할 필요가 없다.
 *
 * **긴 것은 키체인에, 짧은 것은 메모리에.** refresh만 `expo-secure-store`에
 * 남기고 idToken은 들고 있지 않는다. 웹은 localStorage밖에 없어 refresh를
 * 거기 두었는데, 네이티브에는 키체인이 있다 — 웹보다 나아지는 몇 안 되는 자리다.
 */
import * as SecureStore from 'expo-secure-store';
import { FIREBASE, SYNC } from './config.js';

const REFRESH_KEY = 'clearweek.refresh';
const EMAIL_KEY = 'clearweek.email';
const UID_KEY = 'clearweek.uid';

export const state = {
  email: null, uid: null, refresh: null,
  token: null, tokenAt: 0,
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

async function land(out) {
  state.email = String(out.email || '').toLowerCase();
  state.uid = out.localId;
  state.refresh = out.refreshToken;
  state.token = out.idToken;
  state.tokenAt = Date.now();
  await SecureStore.setItemAsync(REFRESH_KEY, state.refresh);
  await SecureStore.setItemAsync(EMAIL_KEY, state.email);
  await SecureStore.setItemAsync(UID_KEY, String(state.uid || ''));
  announce();
}

export async function signIn(email, password) {
  const out = await post(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE.apiKey,
    { email, password, returnSecureToken: true });
  await land(out);
}

export async function signUp(email, password) {
  const out = await post(
    'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FIREBASE.apiKey,
    { email, password, returnSecureToken: true });
  await land(out);
}

export async function restore() {
  state.refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  state.email = await SecureStore.getItemAsync(EMAIL_KEY);
  state.uid = await SecureStore.getItemAsync(UID_KEY);
  announce();
  return !!state.refresh;
}

export async function logout() {
  state.email = null; state.uid = null; state.refresh = null;
  state.token = null; state.tokenAt = 0;
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(EMAIL_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(UID_KEY).catch(() => {});
  announce();
}

export const signedIn = () => !!state.refresh;

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
