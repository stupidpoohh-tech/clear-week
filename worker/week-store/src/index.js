/*
 * Clear Week — 주를 지키는 방 (Cloudflare Durable Object)
 *
 * **왜 방이 필요한가.** 예전에는 Pages Functions가 KV에서 주를 읽고, 합치고,
 * 다시 썼다. 두 기기가 같은 주를 동시에 밀면 둘 다 **옛 값을 읽은 뒤** 각자
 * 합쳐서 쓰므로, 나중 쓰기가 앞선 쓰기를 덮었다. 한쪽이 방금 적은 항목이
 * 소리 없이 사라진다. 클라이언트 재시도로는 못 막는다 — 다음 차례에 우연히
 * 회복될 뿐이고, 그 사이에 사람은 잃은 줄도 모른다.
 *
 * Durable Object는 **이름 하나에 방 하나**이고, 그 방의 코드는 한 번에 한
 * 갈래만 돈다. 읽기·합치기·쓰기를 그 안에서 하면 사이가 벌어지지 않는다.
 *
 * **`blockConcurrencyWhile`로 감싸는 이유.** 방의 기본 잠금(input gate)은
 * 저장소 작업이 도는 동안만 닫힌다. 우리 임계 구역에는 KV 쓰기(바깥 서비스)가
 * 끼어 있어서, 그 `await` 동안 다음 요청이 들어올 수 있다. 그래서 읽기부터
 * 거울 쓰기까지를 통째로 `blockConcurrencyWhile` 안에 넣는다.
 * **이 한 줄이 이 파일의 핵심이다.**
 *
 * **KV는 버리지 않는다.** 방이 원본이 되고 KV는 거울이다.
 *   - 방에 없는 주는 KV에서 **처음 닿을 때 한 번** 읽어 온다 (지연 이전).
 *   - 합친 결과는 방과 KV에 **함께** 쓴다. 그래서 방을 떼어내도 KV만으로
 *     예전처럼 돈다 — 되돌릴 길을 열어 둔 것이다.
 *
 * **합치기 규칙은 여기에 없다.** `functions/_lib.js`의 `mergeWeek` 하나를
 * Pages Functions와 이 워커가 같이 쓴다. 두 곳에 두면 갈라진다.
 */
import { sanitizeWeek, mergeWeek, blankWeek, ts, WEEK_ID_RE } from '../../../functions/_lib.js';

const MAX_WEEKS = 400;
const kvKey = (email, id) => 'week:' + email + ':' + id;
const cell = id => 'w:' + id;      // 방 안의 주
const seen = id => 's:' + id;      // KV에서 한 번 읽어 봤다는 표시

export class WeekStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let body = {};
    try { body = await request.json(); } catch (e) { /* 빈 몸통 */ }
    /* **한 줄로 세운다.** 이 안에서는 다른 요청이 배달되지 않는다 */
    const out = await this.state.blockConcurrencyWhile(() => this.run(body));
    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  async run(b) {
    const email = String(b.email || '');
    const serverReset = ts(b.serverReset);
    if (!email) return { error: 'bad-request' };

    /* 비운 시각이 방이 아는 것보다 나중이면, 방이 든 것부터 버린다.
       안 버리면 다음 요청에서 방이 옛 주를 도로 내놓아 되살아난다. */
    await this.applyReset(email, serverReset);

    if (b.op === 'wipe') return { resetAt: serverReset };
    if (b.op === 'sync') return this.syncOne(email, b, serverReset);
    if (b.op === 'all') return this.syncAll(email, b, serverReset);
    if (b.op === 'list') return this.list(email, serverReset);
    return { error: 'bad-op' };
  }

  async applyReset(email, serverReset) {
    const known = ts(await this.state.storage.get('resetAt'));
    if (!serverReset || serverReset <= known) return;
    const all = await this.state.storage.list({ prefix: 'w:' });
    const marks = await this.state.storage.list({ prefix: 's:' });
    await this.state.storage.delete([...all.keys(), ...marks.keys()]);
    await this.state.storage.put('resetAt', serverReset);
  }

  /* 방에 없는 주는 KV에서 한 번만 읽어 온다. 없으면 없는 것으로 표시해 두고
     다시 묻지 않는다 — 매번 KV를 두드리면 방을 둔 뜻이 없다. */
  async load(email, id) {
    const held = await this.state.storage.get(cell(id));
    if (held) return sanitizeWeek(held, id);
    if (await this.state.storage.get(seen(id))) return null;
    await this.state.storage.put(seen(id), 1);
    if (!this.env.CLEARWEEK) return null;
    const stored = await this.env.CLEARWEEK.get(kvKey(email, id), 'json');
    if (!stored) return null;
    const week = sanitizeWeek(stored, id);
    await this.state.storage.put(cell(id), week);
    return week;
  }

  /* 방에 쓰고 거울에도 쓴다. 거울이 늦으면 되돌릴 길이 막힌다 */
  async store(email, id, week) {
    await this.state.storage.put(cell(id), week);
    await this.state.storage.put(seen(id), 1);
    if (this.env.CLEARWEEK) {
      await this.env.CLEARWEEK.put(kvKey(email, id), JSON.stringify(week));
    }
  }

  async syncOne(email, b, serverReset) {
    const id = String(b.weekId || '');
    if (!WEEK_ID_RE.test(id)) return { error: 'bad-week' };
    const held = await this.load(email, id);

    if (serverReset > 0 && ts(b.clientResetAt) < serverReset) {
      return { week: held || blankWeek(id), resetAt: serverReset, dropped: true };
    }
    const merged = mergeWeek(sanitizeWeek(b.week, id), held || blankWeek(id));
    await this.store(email, id, merged);
    return { week: merged, resetAt: serverReset, dropped: false };
  }

  async syncAll(email, b, serverReset) {
    const incoming = b.weeks && typeof b.weeks === 'object' ? b.weeks : {};
    const stale = serverReset > 0 && ts(b.clientResetAt) < serverReset;
    const ids = await this.ids(email);
    if (!stale) Object.keys(incoming).forEach(id => { if (WEEK_ID_RE.test(id)) ids.add(id); });

    const weeks = {};
    for (const id of Array.from(ids).slice(0, MAX_WEEKS)) {
      const held = await this.load(email, id);
      const mine = stale ? null : incoming[id];
      if (!mine && held) { weeks[id] = held; continue; }
      const merged = mergeWeek(sanitizeWeek(mine, id), held || blankWeek(id));
      await this.store(email, id, merged);
      weeks[id] = merged;
    }
    return { weeks, resetAt: serverReset, dropped: stale };
  }

  /* 보기만 한다 — 합치지도 쓰지도 않는다 (기기를 처음 이을 때 물어보려고) */
  async list(email, serverReset) {
    const weeks = {};
    for (const id of Array.from(await this.ids(email)).slice(0, MAX_WEEKS)) {
      const held = await this.load(email, id);
      if (held) weeks[id] = held;
    }
    return { weeks, resetAt: serverReset };
  }

  /* 방이 아는 주 + 아직 안 옮겨진 KV의 주 */
  async ids(email) {
    const out = new Set();
    const held = await this.state.storage.list({ prefix: 'w:' });
    for (const k of held.keys()) {
      const id = k.slice(2);
      if (WEEK_ID_RE.test(id)) out.add(id);
    }
    if (!this.env.CLEARWEEK) return out;
    const prefix = 'week:' + email + ':';
    let cursor;
    do {
      const page = await this.env.CLEARWEEK.list({ prefix, cursor });
      page.keys.forEach(k => {
        const id = k.name.slice(prefix.length);
        if (WEEK_ID_RE.test(id)) out.add(id);
      });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor && out.size < MAX_WEEKS);
    return out;
  }
}

/*
 * 이 워커 자체로는 아무것도 하지 않는다. Pages가 바인딩으로 방만 빌려 쓴다 —
 * 방 밖에서 이 주소를 두드려 봐야 아무 문도 없다.
 */
export default {
  async fetch() {
    return new Response('week-store', { status: 404 });
  },
};
