/*
 * Clear Week — 서버 저장 갈래 검사
 *
 *   node tests/server.mjs
 *
 * 브라우저도 Cloudflare도 필요 없다. 검사하는 것은 **같은 주에 두 요청이
 * 겹칠 때 무엇이 남는가**다 (spec §11, 2026-09-14).
 *
 * 두 갈래를 같은 시나리오로 돌린다.
 *   - **KV만** — 예전 갈래. 읽고 쓰는 사이가 벌어져 **한쪽이 사라진다.**
 *     이 검사는 그 사실을 못박아 둔다. 폴백은 고쳐진 길이 아니다.
 *   - **방(Durable Object)** — 같은 사람에게 오는 요청을 한 줄로 세운다.
 *     둘 다 남아야 한다.
 *
 * 방의 대역은 `blockConcurrencyWhile`을 **정말로 직렬화**한다. 그것이
 * Cloudflare가 보장하는 것이고, 여기서 검사하는 것은 우리 코드가 읽기·합치기·
 * 쓰기를 **그 임계 구역 안에서** 하느냐다. 밖에서 읽으면 방이 있어도 샌다.
 */
import { syncWeek, syncWeeks, listWeeks, wipeAll, deleteUser } from '../functions/_store.js';
import { WeekStore } from '../worker/week-store/src/index.js';
import { blankWeek } from '../functions/_lib.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` +
    (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

/* **지금에서 얼마 안 떨어진 시각을 쓴다.** 서버는 60일이 지난 지운 표시를
   정리하므로(`GRAVE_DAYS`), 옛날 시각을 쓰면 지움 검사가 그 정리에 걸린다 */
const T = Date.now() - 60_000;
const tick = () => new Promise(r => setTimeout(r, 1));

/* ── 대역 ───────────────────────────────────────────────────── */

/* KV는 느리다. 그 느림이 이 문제의 전부다 — get과 put 사이가 벌어진다 */
function fakeKV(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async get(key, type) {
      await tick();
      const v = map.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { await tick(); map.set(key, String(value)); },
    async delete(key) { await tick(); map.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      await tick();
      const keys = [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true, cursor };
    },
  };
}

/* 방 하나의 저장소. 진짜 DO의 storage와 같은 모양만 갖춘다 */
function fakeStorage() {
  const map = new Map();
  return {
    async get(k) { await tick(); return map.get(k); },
    async put(k, v) { await tick(); map.set(k, v); },
    async delete(keys) {
      await tick();
      (Array.isArray(keys) ? keys : [keys]).forEach(k => map.delete(k));
    },
    async list({ prefix = '' } = {}) {
      await tick();
      const out = new Map();
      for (const [k, v] of map) if (k.startsWith(prefix)) out.set(k, v);
      return out;
    },
  };
}

/* **여기가 이 검사의 뼈대다.** blockConcurrencyWhile은 앞의 것이 끝나기 전에는
   다음 것을 시작하지 않는다. Cloudflare가 방에 대해 보장하는 것이 이것이다. */
function fakeState() {
  let chain = Promise.resolve();
  return {
    storage: fakeStorage(),
    blockConcurrencyWhile(fn) {
      const run = chain.then(() => fn());
      chain = run.then(() => {}, () => {});
      return run;
    },
  };
}

function envWithRooms(kv) {
  const env = { CLEARWEEK: kv };
  const rooms = new Map();
  env.WEEK_STORE = {
    idFromName: name => ({ name }),
    get(id) {
      return {
        fetch: (url, init) => {
          if (!rooms.has(id.name)) rooms.set(id.name, new WeekStore(fakeState(), env));
          return rooms.get(id.name).fetch(new Request(url, init));
        },
      };
    },
  };
  return env;
}

const item = (id, text, at) =>
  ({ id, text, struck: false, createdAt: at, updatedAt: at, strikes: [] });
const weekWith = (id, items) => ({ ...blankWeek(id), days: { ...blankWeek(id).days, mon: items } });
const textsOf = w => (w && w.days ? w.days.mon.map(i => i.text) : []);
const kvWeek = (kv, email, id) => {
  const raw = kv.map.get('week:' + email + ':' + id);
  return raw ? JSON.parse(raw) : null;
};

const WID = '2026-W38';
const ME = 'me@example.com';

/* ── 1. 같은 주에 동시에 밀기 ───────────────────────────────── */

console.log('\n── KV만 있을 때 — 읽고 쓰는 사이가 벌어진다 ──');
{
  const kv = fakeKV();
  const env = { CLEARWEEK: kv };          // 방이 없다
  await Promise.all([
    syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0),
    syncWeek(env, ME, WID, weekWith(WID, [item('b', '은행', T + 1)]), 0),
  ]);
  const left = textsOf(kvWeek(kv, ME, WID));
  /* **이것이 P0-3의 문제다.** 둘 다 옛 값을 읽고 각자 합쳐 써서 하나가 덮인다.
     고쳐진 것이 아니라 폴백이므로, 이 검사는 "여전히 샌다"를 못박아 둔다 —
     누군가 이 갈래를 두고 해결됐다고 적으면 여기서 걸린다. */
  check('한쪽이 사라진다 (그래서 폴백은 해결이 아니다)', left.length, 1);
}

console.log('\n── 방이 있을 때 — 한 줄로 세워진다 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  const [r1, r2] = await Promise.all([
    syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0),
    syncWeek(env, ME, WID, weekWith(WID, [item('b', '은행', T + 1)]), 0),
  ]);
  check('둘 다 남는다', textsOf(kvWeek(kv, ME, WID)).sort(), ['은행', '장보기']);
  check('나중에 끝난 응답에는 둘 다 들어 있다',
    (r1.week.days.mon.length === 2 || r2.week.days.mon.length === 2), true);
  check('거울(KV)에도 같은 것이 적힌다 — 되돌릴 길을 막지 않는다',
    textsOf(kvWeek(kv, ME, WID)).length, 2);
}

console.log('\n── 셋이 겹쳐도, 스무 번을 겹쳐도 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    syncWeek(env, ME, WID, weekWith(WID, [item('i' + i, '항목' + i, T + i)]), 0)));
  check('스무 개가 모두 남는다', textsOf(kvWeek(kv, ME, WID)).length, 20);
}

/* ── 2. 다른 사람·다른 주는 서로를 막지 않는다 ──────────────── */

console.log('\n── 다른 사람·다른 주 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await Promise.all([
    syncWeek(env, ME, WID, weekWith(WID, [item('a', '내 것', T)]), 0),
    syncWeek(env, 'you@example.com', WID, weekWith(WID, [item('b', '남의 것', T)]), 0),
  ]);
  check('사람이 다르면 방도 다르다', textsOf(kvWeek(kv, ME, WID)), ['내 것']);
  check('남의 방에 내 것이 섞이지 않는다',
    textsOf(kvWeek(kv, 'you@example.com', WID)), ['남의 것']);
}
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await Promise.all([
    syncWeek(env, ME, '2026-W38', weekWith('2026-W38', [item('a', '이번 주', T)]), 0),
    syncWeek(env, ME, '2026-W39', weekWith('2026-W39', [item('b', '다음 주', T)]), 0),
  ]);
  check('같은 방 안에서도 주는 서로 덮지 않는다',
    [textsOf(kvWeek(kv, ME, '2026-W38')), textsOf(kvWeek(kv, ME, '2026-W39'))],
    [['이번 주'], ['다음 주']]);
}

/* ── 3. 지운 것과 고친 것이 겹칠 때 ─────────────────────────── */

console.log('\n── 한쪽은 지우고 한쪽은 고칠 때 (graves · updatedAt 규칙) ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0);

  const deleted = { ...blankWeek(WID), graves: { a: T + 50 } };
  const edited = weekWith(WID, [{ ...item('a', '장보기 · 우유', T), updatedAt: T + 20 }]);
  await Promise.all([
    syncWeek(env, ME, WID, deleted, 0),
    syncWeek(env, ME, WID, edited, 0),
  ]);
  check('지운 표시가 더 나중이면 지워진 채로 남는다', textsOf(kvWeek(kv, ME, WID)), []);
  check('지운 표시는 보관된다', Object.keys(kvWeek(kv, ME, WID).graves), ['a']);
}
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0);
  const deleted = { ...blankWeek(WID), graves: { a: T + 20 } };
  const edited = weekWith(WID, [{ ...item('a', '장보기 · 우유', T), updatedAt: T + 50 }]);
  await Promise.all([
    syncWeek(env, ME, WID, deleted, 0),
    syncWeek(env, ME, WID, edited, 0),
  ]);
  check('지운 뒤에 고쳤으면 살아남는다', textsOf(kvWeek(kv, ME, WID)), ['장보기 · 우유']);
}

/* ── 4. 예전 KV 데이터는 그대로 읽힌다 (점진 이전) ──────────── */

console.log('\n── 예전 KV에 있던 주 ──');
{
  const old = weekWith(WID, [item('old', '예전에 적은 것', T)]);
  const kv = fakeKV({ ['week:' + ME + ':' + WID]: JSON.stringify(old) });
  const env = envWithRooms(kv);
  const out = await syncWeek(env, ME, WID, weekWith(WID, [item('new', '방금 적은 것', T + 5)]), 0);
  check('방이 처음 열릴 때 KV에서 읽어 온다', textsOf(out.week).sort(),
    ['방금 적은 것', '예전에 적은 것']);
  check('KV 거울도 함께 갱신된다', textsOf(kvWeek(kv, ME, WID)).length, 2);
}
{
  const old = weekWith('2026-W20', [item('old', '지난 봄', T)]);
  const kv = fakeKV({ ['week:' + ME + ':2026-W20']: JSON.stringify(old) });
  const env = envWithRooms(kv);
  const seen = await listWeeks(env, ME);
  check('아직 방에 안 옮겨진 주도 목록에 나온다', Object.keys(seen.weeks), ['2026-W20']);
  const all = await syncWeeks(env, ME, { '2026-W21': weekWith('2026-W21', [item('n', '올봄', T)]) }, 0);
  check('전부 맞추기에도 예전 주가 함께 온다', Object.keys(all.weeks).sort(),
    ['2026-W20', '2026-W21']);
}

/* ── 5. 전부 비우기 — 방이 옛것을 도로 내놓으면 안 된다 ─────── */

console.log('\n── 전부 비우기 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0);
  const { resetAt } = await wipeAll(env, ME, T + 100);
  check('비운 시각이 남는다', kv.map.get('reset:' + ME), String(T + 100));
  check('KV에서 사라진다', kvWeek(kv, ME, WID), null);

  const after = await listWeeks(env, ME);
  check('**방도 함께 비워진다** — 안 그러면 되살아난다', Object.keys(after.weeks), []);

  const stale = await syncWeek(env, ME, WID, weekWith(WID, [item('a', '장보기', T)]), 0);
  check('비운 것을 못 들은 기기가 올린 것은 받지 않는다', stale.dropped, true);
  check('그 기기의 것이 되살아나지도 않는다', textsOf(kvWeek(kv, ME, WID)), []);

  const fresh = await syncWeek(env, ME, WID,
    weekWith(WID, [item('b', '비운 뒤에 적은 것', T + 200)]), resetAt);
  check('비운 것을 아는 기기의 새 기록은 받는다', textsOf(fresh.week), ['비운 뒤에 적은 것']);
}

/* ── 6. 전부 맞추기도 한 줄로 ───────────────────────────────── */

console.log('\n── 전부 맞추기와 한 주 밀기가 겹칠 때 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await Promise.all([
    syncWeeks(env, ME, { [WID]: weekWith(WID, [item('a', '가진 것 전부', T)]) }, 0),
    syncWeek(env, ME, WID, weekWith(WID, [item('b', '방금 적은 것', T + 1)]), 0),
  ]);
  check('둘 다 남는다', textsOf(kvWeek(kv, ME, WID)).sort(), ['가진 것 전부', '방금 적은 것']);
}

/* ── 7. 계정 삭제 (P1-5) ────────────────────────────────────── */

console.log('\n── 계정 삭제 ──');
{
  const kv = fakeKV();
  const env = envWithRooms(kv);
  await syncWeek(env, ME, WID, weekWith(WID, [item('a', '내 것', T)]), 0);
  await syncWeek(env, 'you@example.com', WID, weekWith(WID, [item('b', '남의 것', T)]), 0);

  await deleteUser(env, ME);
  check('내 주가 서버에서 사라진다', kvWeek(kv, ME, WID), null);
  check('**방에서도 사라진다** — 안 그러면 다음 요청에 되살아난다',
    Object.keys((await listWeeks(env, ME)).weeks), []);
  check('남의 것은 그대로다', textsOf(kvWeek(kv, 'you@example.com', WID)), ['남의 것']);

  /* 비우기와 다른 점: **비운 시각도 남기지 않는다.** 계정이 사라졌으므로
     "이보다 오래된 기기를 막아라"를 남겨 둘 대상이 없다 */
  check('비운 시각도 남지 않는다', kv.map.get('reset:' + ME), undefined);

  /* 같은 주소로 다시 가입하면 빈 서버에서 새로 시작한다 */
  const again = await syncWeek(env, ME, WID,
    weekWith(WID, [item('c', '다시 시작', T + 100)]), 0);
  check('다시 가입하면 빈 자리에서 시작한다', textsOf(again.week), ['다시 시작']);
  check('지워진 것이 되살아나지 않는다',
    textsOf(kvWeek(kv, ME, WID)), ['다시 시작']);
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
