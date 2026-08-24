/*
 * Clear Week — 회귀 테스트
 *
 *   node tests/smoke.mjs
 *
 * 정적 서버를 직접 띄우고 크로미움으로 주요 흐름을 훑는다.
 * 손맛·소리·햅틱처럼 사람이 판단할 것은 검증 대상이 아니다.
 * 실기기(아이폰)에서만 확인 가능한 것: 키보드 밀어올림, 확대 차단, 진동, 소리.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
/* 합치기는 서버에만 있다. 모의 서버도 같은 함수를 쓴다 — 규칙이 갈라지지 않게 */
import { mergeWeek, sanitizeWeek, blankWeek } from '../functions/_lib.js';
/* 행동로그도 마찬가지 — 문지기는 서버에만 있다 */
import { sanitizeBatch } from '../functions/_log.js';

/* playwright는 전역 설치본도 허용한다 (PLAYWRIGHT_MODULE로 경로 지정 가능) */
const chromium = await (async () => {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright',
                 '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of tries) { try { return (await import(m)).chromium; } catch {} }
  throw new Error('playwright를 찾지 못했습니다. `npm i -D playwright` 또는 PLAYWRIGHT_MODULE에 경로를 지정하세요.');
})();

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 8231;
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* ── 모의 서버 — Pages Functions 자리를 대신한다 ─────────────
   KV·메일은 흉내만 낸다. 합치기와 주고받는 모양은 진짜와 같다. */
const api = { weeks: {}, sessions: new Map(), codes: new Map(), lastCode: null, resetAt: 0,
              log: [], logRaw: [], logOff: false, syncDelay: 0 };
const readBody = req => new Promise(r => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});
const cookieOf = req => {
  const m = /(?:^|;\s*)cw_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
};
const send = (res, code, data, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
};

async function handleApi(req, res, url) {
  const email = api.sessions.get(cookieOf(req)) || null;

  if (url === '/api/me') return send(res, 200, { email, ready: true });

  /* 행동로그 — 진짜와 같이 언제나 204. 받은 것은 검사에서 들여다본다 */
  if (url === '/api/log') {
    if (api.logOff) { res.writeHead(404); return res.end(); }
    const b = await readBody(req);
    api.logRaw.push(b);                        // 클라이언트가 실제로 보낸 것
    api.log.push(...sanitizeBatch(b));         // 문지기를 통과한 것
    res.writeHead(204); return res.end();
  }

  if (url === '/api/auth/request') {
    const { email: to } = await readBody(req);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) return send(res, 400, { error: 'bad-email' });
    api.lastCode = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    api.codes.set(String(to).toLowerCase(), api.lastCode);
    return send(res, 200, { ok: true });
  }

  if (url === '/api/auth/verify') {
    const b = await readBody(req);
    const want = api.codes.get(String(b.email || '').toLowerCase());
    if (!want || want !== String(b.code)) return send(res, 400, { error: 'wrong-code' });
    api.codes.delete(String(b.email).toLowerCase());
    const token = 'a'.repeat(48) + api.sessions.size;
    api.sessions.set(token, String(b.email).toLowerCase());
    return send(res, 200, { ok: true, email: String(b.email).toLowerCase() },
      { 'set-cookie': `cw_session=${token}; Path=/; SameSite=Lax; Max-Age=999999` });
  }

  if (url === '/api/auth/logout') {
    api.sessions.delete(cookieOf(req));
    return send(res, 200, { ok: true }, { 'set-cookie': 'cw_session=; Path=/; Max-Age=0' });
  }

  if (!email) return send(res, 401, { error: 'unauthorized' });

  if (url === '/api/reset') {
    api.weeks = {};
    api.resetAt = Date.now();
    return send(res, 200, { ok: true, resetAt: api.resetAt });
  }

  if (url === '/api/sync') {
    const b = await readBody(req);
    const id = String(b.weekId || '');
    if (api.resetAt > 0 && (Number(b.resetAt) || 0) < api.resetAt) {
      return send(res, 200, { week: api.weeks[id] || blankWeek(id), resetAt: api.resetAt, dropped: true });
    }
    const merged = mergeWeek(sanitizeWeek(b.week, id),
      api.weeks[id] ? sanitizeWeek(api.weeks[id], id) : blankWeek(id));
    api.weeks[id] = merged;
    /* 느리게 대답하게 해서 "오가는 사이"를 넓힌다 */
    if (api.syncDelay) await new Promise(r => setTimeout(r, api.syncDelay));
    return send(res, 200, { week: merged, resetAt: api.resetAt });
  }

  if (url === '/api/sync/all') {
    /* GET은 보기만 한다 — 합치지도 쓰지도 않는다 */
    if (req.method === 'GET') return send(res, 200, { weeks: api.weeks, resetAt: api.resetAt });
    const b = await readBody(req);
    const stale = api.resetAt > 0 && (Number(b.resetAt) || 0) < api.resetAt;
    const incoming = stale ? {} : (b.weeks || {});
    const ids = new Set([...Object.keys(api.weeks), ...Object.keys(incoming)]);
    const weeks = {};
    for (const id of ids) {
      const merged = mergeWeek(sanitizeWeek(incoming[id], id),
        api.weeks[id] ? sanitizeWeek(api.weeks[id], id) : blankWeek(id));
      api.weeks[id] = merged;
      weeks[id] = merged;
    }
    return send(res, 200, { weeks, resetAt: api.resetAt, dropped: stale });
  }
  return send(res, 404, { error: 'not-found' });
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return handleApi(req, res, url);
  const path = join(ROOT, url === '/' ? 'index.html' : url);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(PORT, r));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` + (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(400);

const cell = i => page.locator('.days .cell').nth(i);
const days = key => page.evaluate(k => App.week.days[k].map(i => i.text), key);

/* 그 칸의 빈 곳을 누른다. 날짜를 눌러 만드는 기능은 없앴다 (spec §4-2) */
async function tapCell(i) {
  const b = await cell(i).boundingBox();
  await page.mouse.click(b.x + b.width * 0.6, b.y + b.height - 10);
  await page.waitForTimeout(150);
}
async function type(lines) {
  for (const t of lines) { await page.keyboard.type(t); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(180);
}
async function strikeFirst(key) {
  const r = await page.evaluate(k => {
    const el = App.cells[k].listEl.querySelector('.item-text');
    const q = document.createRange(); q.selectNodeContents(el);
    const x = Array.from(q.getClientRects()).filter(v => v.width > 1)[0];
    return { x: x.x, y: x.y, w: x.width, h: x.height };
  }, key);
  const y = r.y + r.h / 2;
  await page.mouse.move(r.x + 1, y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(r.x + 1 + r.w * 0.95 * (i / 14), y); await page.waitForTimeout(8); }
  await page.mouse.up(); await page.waitForTimeout(400);
}
console.log('\n── 첫 실행 안내 ──');
/* 버튼이 하나도 없는 화면이라 첫 단서가 필요하다. 단, 한 번 거절하면 다시 안 뜬다.
   표본 주를 그리고 셀로판지를 덧대던 방식은 물렸다 — 지금은 카드 한 장이다 (spec §4-4). */
check('첫 실행에 안내가 뜬다', await page.locator('#guide').isVisible(), true);
check('네 줄', await page.locator('.guide-list li:not([hidden])').count(), 4);
check('줄마다 표시 하나씩', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.guide-list li:not([hidden])'))
    .filter(li => !li.querySelector('.mark svg')).length), 0);

/* 줄바꿈(<br>)은 textContent에 공백을 남기지 않는다 — 한 칸으로 세운다 */
const 안내글 = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('.guide-list li:not([hidden]) p'))
    .map(e => e.innerHTML.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
                         .replace(/\s+/g, ' ').trim()));
check('네 가지를 이 차례로 말한다', await 안내글(), [
  '빈 곳을 눌러 생성 (요일 아래, 요일 칸, 노트)',
  '글자 위를 그어서 완료. 문지르면 지워져요',
  '꾹 누르면 삭제',
  '로그인하면 기기간 연동할 수 있습니다',
]);
check('중요한 말은 굵게', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.guide-list li:not([hidden]) b')).map(e => e.textContent)),
  ['생성', '완료', '삭제', '기기간 연동']);

/* 안내는 카드일 뿐이다 — 주간 표를 건드리지 않는다.
   예전에는 표본 주를 끼워 넣느라 저장·동기화를 멈춰 세워야 했다. */
check('주간 표를 건드리지 않는다', await page.evaluate(() =>
  Object.values(App.week.days).reduce((n, a) => n + a.length, 0)), 0);
check('안내가 떠 있어도 저장·동기화를 멈추지 않는다',
  await page.evaluate(() => App.currentWeek() !== null), true);
check('카드가 화면 안에 들어온다', await page.evaluate(() => {
  const c = document.querySelector('.guide-card').getBoundingClientRect();
  return c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth;
}), true);

/* 서버가 없으면 로그인 버튼이 아예 안 나타난다 (spec §13) — 그 줄도 빠진다 */
await page.evaluate(() => { Sync.ready = false; App.renderAuth(); });
await page.waitForTimeout(120);
check('서버가 없으면 로그인 줄이 빠진다',
  await page.locator('.guide-list li:not([hidden])').count(), 3);
check('서버가 없으면 로그인을 입에 담지 않는다',
  (await 안내글()).join(' ').includes('로그인'), false);
await page.evaluate(() => { Sync.ready = true; App.renderAuth(); });
await page.waitForTimeout(120);
check('서버가 있으면 로그인 줄이 돌아온다',
  await page.locator('.guide-list li:not([hidden])').count(), 4);

/* 한 번에 한 줄씩 짚는다. 끝까지 짚어야 닫을 수 있다 */
const 단계 = () => page.evaluate(() => ({
  또렷: Array.from(document.querySelectorAll('.guide-list li:not([hidden])'))
    .map(li => (li.classList.contains('on') ? 1 : 0)),
  닫기: !document.getElementById('guideClose').disabled,
  체크: !document.getElementById('guideNever').disabled,
}));
const 카드 = await page.locator('.guide-card').boundingBox();
const 넘기기 = async () => {
  await page.mouse.click(카드.x + 카드.width / 2, 카드.y + 18);
  await page.waitForTimeout(150);
};

check('처음엔 첫 줄만 또렷하다', await 단계(), { 또렷: [1, 0, 0, 0], 닫기: false, 체크: false });
await 넘기기();
check('한 번 누르면 둘째 줄', await 단계(), { 또렷: [0, 1, 0, 0], 닫기: false, 체크: false });
await 넘기기();
check('또 누르면 셋째 줄', await 단계(), { 또렷: [0, 0, 1, 0], 닫기: false, 체크: false });
await 넘기기();
check('끝 줄에 닿으면 닫을 수 있다', await 단계(), { 또렷: [0, 0, 0, 1], 닫기: true, 체크: true });
await 넘기기();
check('끝에서 더 눌러도 카드 안이면 안 닫힌다', await page.locator('#guide').isVisible(), true);

/* 끝까지 짚기 전에는 밖을 눌러도 닫히지 않고 다음 줄로 간다 */
await page.mouse.click(195, 30);
await page.waitForTimeout(200);
check('다 짚은 뒤에는 카드 밖을 눌러 닫는다', await page.locator('#guide').isVisible(), false);

await page.reload(); await page.waitForTimeout(400);
check('그냥 닫았으면 다음에 다시 뜬다', await page.locator('#guide').isVisible(), true);
check('다시 열면 첫 줄부터', await 단계(), { 또렷: [1, 0, 0, 0], 닫기: false, 체크: false });
await page.mouse.click(195, 30);        // 아직 첫 줄 — 밖을 눌러도 넘어가기만 한다
await page.waitForTimeout(200);
check('덜 짚었으면 밖을 눌러도 안 닫힌다', await page.locator('#guide').isVisible(), true);
check('대신 다음 줄로 간다', (await 단계()).또렷, [0, 1, 0, 0]);

const 끝까지 = async () => {
  for (let i = 0; i < 5; i++) {
    if ((await 단계()).닫기) return;
    await 넘기기();
  }
};
await 끝까지();
await page.locator('#guideClose').click();
await page.waitForTimeout(200);
check('닫기로도 닫힌다', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('체크하지 않았으면 또 뜬다', await page.locator('#guide').isVisible(), true);

/* 체크하고 닫아야 영영 안 뜬다 */
await 끝까지();
await page.locator('#guideNever').check();
await page.locator('#guideClose').click();
await page.waitForTimeout(200);
check('다시 보지 않기 — 그 자리에서 닫힘', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('다시 보지 않기 — 새로고침해도 안 뜸', await page.locator('#guide').isVisible(), false);

console.log('\n── 화면 ──');
check('8칸(요일 7 + note)', await page.locator('.cell').count(), 8);
check('페이지 스크롤 없음', await page.evaluate(() =>
  document.documentElement.scrollHeight <= document.documentElement.clientHeight), true);
check('상단 날짜 범위 형식', /^\d{4}\. \d{1,2}\.\d{1,2}-\d{1,2}\.\d{1,2}$/.test(
  await page.locator('#weekTitle').textContent()), true);
check('날짜 라벨 형식', /^\d{1,2}\.[MTWFS]$/.test(
  await page.locator('.cell-label').first().textContent()), true);
check('외곽선은 아래만', await page.evaluate(() => {
  const w = getComputedStyle(document.querySelector('.week'));
  return [w.borderTopWidth, w.borderLeftWidth, w.borderRightWidth, w.borderBottomWidth];
}), ['0px', '0px', '0px', '1px']);

console.log('\n── 오늘로 돌아오기 ──');
check('이번 주에는 나타나지 않는다', await page.locator('#today').isVisible(), false);
await page.locator('#prev').click();
await page.locator('#prev').click();
await page.waitForTimeout(300);
check('넘기면 나타난다', await page.locator('#today').isVisible(), true);
const away = await page.locator('#weekTitle').textContent();
await page.locator('#today').click();
await page.waitForTimeout(300);
check('누르면 이번 주로 돌아온다', await page.evaluate(() =>
  App.monday.getTime() === App.thisMonday.getTime()), true);
check('돌아오면 다시 사라진다', await page.locator('#today').isVisible(), false);
check('넘겼던 주와 다른 주다', (await page.locator('#weekTitle').textContent()) !== away, true);

console.log('\n── 적기 ──');
await tapCell(3);
await type(['멜팅의원', '웨비나']);
check('엔터로 연속 입력', await days('thu'), ['멜팅의원', '웨비나']);

await page.keyboard.type('낭만백수달');
await page.locator('#weekTitle').click();          // 엔터 없이 딴 데 누르기
await page.waitForTimeout(300);
check('엔터 없이 딴 데 눌러도 저장', await days('thu'), ['멜팅의원', '웨비나', '낭만백수달']);
check('입력창 닫힘', await page.locator('.entry').count(), 0);

/* 라벨만 과녁이면 너무 작다 — 칸의 빈 곳을 눌러도 그 칸에 적힌다 */
{
  const box = await cell(5).boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height - 8);
  await page.waitForTimeout(250);
  check('빈 곳을 눌러도 입력창이 열린다', await page.evaluate(() =>
    !!App.cells.sat.listEl.querySelector('.entry')), true);
  await page.keyboard.type('빈 곳에서 적음');
  await page.keyboard.press('Enter');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  check('빈 곳 탭으로 그 칸에 적힌다', await days('sat'), ['빈 곳에서 적음']);
}
/* 항목 행은 칸 너비만큼 넓은데 글자는 그보다 짧다.
   **글자 오른쪽의 빈 자리는 항목이 아니라 그 칸의 빈 곳이다** (spec §4-1) */
{
  const row = await cell(5).locator('.item').first().boundingBox();
  const txt = await cell(5).locator('.item-text').first().boundingBox();
  check('글자보다 행이 훨씬 넓다', row.width > txt.width + 60, true);
  await page.mouse.click(row.x + row.width - 8, row.y + row.height / 2);
  await page.waitForTimeout(450);
  check('글자 옆 빈 자리를 누르면 새 항목이 열린다',
    await page.evaluate(() => !!App.cells.sat.listEl.querySelector('.entry')), true);
  check('그때 편집이 열리지는 않는다', await page.evaluate(() =>
    App.cells.sat.items.some(i => i.el.hidden)), false);
  await page.keyboard.type('옆에서 적음');
  await page.keyboard.press('Enter');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  check('옆 빈 자리로 적은 것이 그 칸에 들어간다',
    await days('sat'), ['빈 곳에서 적음', '옆에서 적음']);
  await page.evaluate(() => { App.week.days.sat = App.week.days.sat.slice(0, 1); App.save(); App.render(); });
  await page.waitForTimeout(250);
}

/* `.cell-body`는 `overflow: hidden`이지만 **굴러가기는 한다.** 포커스를 주면
   브라우저가 입력창을 보이려고 칸을 굴려, 적힌 것들이 밀려 사라졌다.
   되돌릴 손잡이도 없다 — 적은 것이 사라진 것처럼 보인다 (spec §4-1). */
{
  await page.evaluate(() => {
    const n = Date.now();
    /* 한 열이 딱 차는 개수여야 한다 — 남으면 입력창이 다음 단에 들어가 안 드러난다 */
    App.week.days.sun = ['하나', '둘', '셋'].map((t, i) =>
      ({ id: 'full' + i, text: t, struck: false, createdAt: n + i, updatedAt: n + i, strikes: [] }));
    App.save(); App.render();
  });
  await page.waitForTimeout(400);
  const 보이는 = () => page.evaluate(() => {
    const c = App.cells.sun, box = c.listEl.getBoundingClientRect();
    return c.items.filter(i => {
      const r = i.el.getBoundingClientRect();
      return r.width > 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1 &&
             r.right > box.left + 1 && r.left < box.right - 1;
    }).length;
  });
  check('적기 전에는 셋 다 보인다', await 보이는(), 3);
  const r = await page.evaluate(() => {
    const b = App.cells.sun.items[0].el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  await page.mouse.click(r.x + r.w - 8, r.y + r.h / 2);
  await page.waitForTimeout(400);
  check('입력창을 열어도 적힌 것이 밀려나지 않는다', await 보이는(), 3);
  check('칸이 굴러가지 않는다', await page.evaluate(() =>
    [App.cells.sun.listEl.scrollTop, App.cells.sun.listEl.scrollLeft]), [0, 0]);
  check('입력창도 자리를 얻는다', await page.evaluate(() => {
    const c = App.cells.sun, box = c.listEl.getBoundingClientRect();
    const e = c.listEl.querySelector('.entry').getBoundingClientRect();
    return e.bottom <= box.bottom + 1 && e.right <= box.right + 1;
  }), true);
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => { App.week.days.sun = []; App.save(); App.render(); });
  await page.waitForTimeout(250);
}
{
  const it = await cell(5).locator('.item-text').first().boundingBox();
  await page.mouse.click(it.x + 3, it.y + it.height / 2);
  await page.waitForTimeout(450);
  check('글자 위를 누른 것은 편집이지 새 항목이 아니다',
    await page.evaluate(() => (App.cells.sat.listEl.querySelector('.entry') || {}).value),
    '빈 곳에서 적음');
  await page.keyboard.press('Escape');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  check('항목 수는 그대로', await days('sat'), ['빈 곳에서 적음']);
}
await page.evaluate(() => { App.week.days.sat = []; App.save(); App.render(); });
await page.waitForTimeout(250);

/* blur만 믿지 않는다 — 딴 데를 누르는 순간(pointerdown)에도 확정한다 */
{
  await tapCell(6);
  await page.keyboard.type('누르는 순간 저장');
  const box = await cell(5).boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height - 8);
  await page.mouse.down();            // 아직 떼지 않았는데도 확정돼야 한다
  await page.waitForTimeout(150);
  check('딴 데를 누르는 순간 확정된다', await days('sun'), ['누르는 순간 저장']);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.evaluate(() => { App.week.days.sun = []; App.week.days.sat = []; App.save(); App.render(); });
  await page.waitForTimeout(250);
}

/* note 칸은 라벨 높이(20px)만 과녁이었다 — 열 전체가 과녁이어야 한다 */
{
  const col = await page.locator('.free').boundingBox();
  const cell0 = await page.evaluate(() => {
    const r = App.cells.free.section.getBoundingClientRect();
    return { h: r.height };
  });
  check('note 칸이 열 전체를 차지한다', cell0.h > col.height - 8, true);
  await page.mouse.click(col.x + col.width / 2, col.y + col.height - 40);
  await page.waitForTimeout(400);
  check('note 아래 빈 곳을 누르면 note에 적힌다',
    await page.evaluate(() => !!App.cells.free.listEl.querySelector('.entry')), true);
  await page.keyboard.type('영어 단어');
  await page.keyboard.press('Enter');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  check('note에 들어간다', await days('free'), ['영어 단어']);
  await page.evaluate(() => { App.week.days.free = []; App.save(); App.render(); });
  await page.waitForTimeout(250);
}

/* 왼쪽 여백(날짜와 그 아래)은 **요일 아래 메모**의 자리다.
   날짜를 눌러 항목을 만들던 것과 꾹 눌러 끌어 메모를 열던 것은 둘 다 없앴다 —
   누르는 자리와 적히는 자리가 어긋나 있었다 (spec §4-2). */
{
  const g = await page.evaluate(() => {
    const el = App.cells.wed.section.querySelector('.cell-gutter');
    const r = el.getBoundingClientRect();
    const l = App.cells.wed.section.querySelector('.cell-label').getBoundingClientRect();
    const c = App.cells.wed.section.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, labelY: l.y, labelH: l.height, cellH: c.height };
  });
  check('여백이 칸 높이를 다 차지한다', g.h > g.cellH - 4, true);

  /* 날짜 아래 빈 곳 */
  await page.mouse.click(g.x + g.w / 2, g.y + g.h - 14);
  await page.waitForTimeout(300);
  check('날짜 아래 빈 곳을 누르면 메모가 열린다',
    await page.locator('.sublabel-entry').count(), 1);
  check('그때 항목 입력창은 열리지 않는다', await page.locator('.entry').count(), 0);
  await page.keyboard.type('황상필');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('메모가 요일 아래에 적힌다', await page.evaluate(() => App.week.notes.wed), '황상필');

  /* 날짜 자체를 눌러도 항목이 아니라 메모다 — 만들기는 없앴다 */
  const before = await days('wed');
  await page.mouse.click(g.x + g.w / 2, g.labelY + g.labelH / 2);
  await page.waitForTimeout(300);
  check('날짜를 눌러도 항목은 안 생긴다', await page.locator('.entry').count(), 0);
  check('날짜를 누르면 메모가 열린다', await page.locator('.sublabel-entry').count(), 1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('항목 수는 그대로', await days('wed'), before);

  await page.evaluate(() => { App.week.notes.wed = ''; App.week.noteAt.wed = Date.now(); App.save(); App.render(); });
  await page.waitForTimeout(250);
}

console.log('\n── 요일 아래 메모 긋기 ──');
/* 메모도 **긋는 몸**이다 — 항목과 같은 StrikeItem을 쓴다 (spec §4-6).
   긋기·지우개·자동 긋기·롱프레스가 그대로 따라오되, 항목으로 세어지지는 않는다. */
{
  const noteBox = key => page.evaluate(k => {
    const r = App.cells[k].sub.textEl.getClientRects()[0];
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, key);
  const setNote = async (key, text) => {
    await page.evaluate(([k, t]) => {
      App.week.notes[k] = t; App.week.noteAt[k] = Date.now();
      App.week.noteStrikes[k] = []; App.save(); App.render();
    }, [key, text]);
    await page.waitForTimeout(250);
  };
  const drawNote = async key => {
    const r = await noteBox(key);
    const y = r.y + r.h / 2;
    await page.mouse.move(r.x + 1, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(r.x + 1 + (r.w - 2) * (i / 12), y); await page.waitForTimeout(8); }
    await page.mouse.up(); await page.waitForTimeout(400);
  };

  await setNote('tue', '휴가');
  check('빈 메모는 자리를 차지하지 않는다', await page.evaluate(() => {
    App.week.notes.sat = ''; App.render();
    return App.cells.sat.sub.el.hidden;
  }), true);
  await page.waitForTimeout(200);

  await drawNote('tue');
  check('메모 글자 위를 그으면 획이 남는다',
    await page.evaluate(() => App.week.noteStrikes.tue.length), 1);
  check('그은 것은 메모의 시각을 올린다 — 합칠 때 쓴다',
    await page.evaluate(() => App.week.noteAt.tue > 0), true);
  check('글자는 그대로 남는다 — 취소선은 삭제가 아니다',
    await page.evaluate(() => App.week.notes.tue), '휴가');

  /* 획은 시드 + 줄 안에서의 비율로만 저장된다 — 새로고침해도 같은 자리에 온다 */
  await page.reload();
  await page.waitForTimeout(500);
  check('새로고침해도 메모의 획이 복원된다',
    await page.evaluate(() => App.cells.tue.sub.strokes.length), 1);

  /* 그어진 항목이 편집 불가인 것과 같은 규칙 */
  const r = await noteBox('tue');
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await page.waitForTimeout(450);
  check('그어진 메모는 탭해도 안 열린다', await page.locator('.sublabel-entry').count(), 0);
  check('그때 항목 입력창도 안 열린다', await page.locator('.entry').count(), 0);
  /* 글자 위만이 아니다 — 여백을 눌러도 열리면 안 된다.
     여백 탭은 "메모를 적는다"는 뜻인데, 그어진 메모는 고칠 수 없다 (spec §4-6) */
  {
    const q = await page.evaluate(() => {
      const b = App.cells.tue.gutter.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height - 6 };
    });
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(300);
    check('그어져 있으면 여백을 눌러도 안 열린다',
      await page.locator('.sublabel-entry').count(), 0);
  }

  /* 훑어 지우기는 **항목**의 것이다. 메모는 옷이 달라 끌려가지 않는다 */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.tue = ['가', '나'].map((t, i) => ({
      id: 'sweep' + i, text: t, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [],
    }));
    App.save(); App.render();
  });
  await page.waitForTimeout(300);
  {
    const first = await cell(1).locator('.item').first().boundingBox();
    const last = await cell(1).locator('.item').last().boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);                 // 롱프레스
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
    const g = await page.evaluate(() => {
      const q = App.cells.tue.gutter.getBoundingClientRect();
      return { x: q.x + q.width / 2, y: q.y + q.height / 2 };
    });
    await page.mouse.move(g.x, g.y, { steps: 8 });  // 메모 위까지 훑어 본다
    await page.mouse.up();
    await page.waitForTimeout(350);
    check('훑어 지우기가 항목을 지운다', await days('tue'), []);
    check('훑어도 메모는 남는다 — 메모는 항목이 아니다',
      await page.evaluate(() => App.week.notes.tue), '휴가');
  }

  /* 더블탭 = 남은 줄까지 자동으로 긋기. 메모에서도 같다 */
  await setNote('tue', '치과');
  const d = await noteBox('tue');
  await page.mouse.dblclick(d.x + d.w / 2, d.y + d.h / 2);
  await page.waitForTimeout(800);
  check('메모도 더블탭으로 그어진다',
    await page.evaluate(() => App.week.noteStrikes.tue.length), 1);

  /* 롱프레스 = 메모를 지운다. 글자와 획이 함께 사라진다 */
  await page.mouse.move(d.x + d.w / 2, d.y + d.h / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(350);
  check('꾹 누르면 메모가 지워진다', await page.evaluate(() =>
    [App.week.notes.tue, App.week.noteStrikes.tue.length, App.cells.tue.sub.el.hidden]),
    ['', 0, true]);

  /* 지운 자리는 다시 적을 수 있어야 한다 — 그어진 채로 막혀 있으면 안 된다 */
  {
    const q = await page.evaluate(() => {
      const b = App.cells.tue.gutter.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height - 6 };
    });
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(300);
    check('지운 뒤에는 다시 적을 수 있다', await page.locator('.sublabel-entry').count(), 1);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }

  await page.evaluate(() => {
    App.week.notes.tue = ''; App.week.noteStrikes.tue = []; App.week.noteAt.tue = Date.now();
    App.week.days.tue = []; App.save(); App.render();
  });
  await page.waitForTimeout(250);
}

console.log('\n── 편집 · 삭제 ──');
await cell(3).locator('.item').nth(1).locator('.item-text').click();
await page.waitForTimeout(420);
await page.locator('.entry').fill('웨비나 참석');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('탭 편집 — 자리 유지', await days('thu'), ['멜팅의원', '웨비나 참석', '낭만백수달']);

await cell(3).locator('.item').nth(1).locator('.item-text').click();
await page.waitForTimeout(420);
check('편집 중에는 원본이 안 보인다', await page.evaluate(() => {
  const hidden = Array.from(document.querySelectorAll('.item[hidden]'));
  return hidden.every(el => getComputedStyle(el).display === 'none');
}), true);
check('편집 중 같은 글이 두 번 보이지 않는다', await page.evaluate(() => {
  const shown = Array.from(App.cells.thu.listEl.querySelectorAll('.item'))
    .filter(el => getComputedStyle(el).display !== 'none')
    .map(el => el.textContent);
  const typed = App.cells.thu.listEl.querySelector('.entry').value;
  return shown.filter(v => v === typed).length;
}), 0);
await page.keyboard.press('Escape');
await page.locator('#weekTitle').click();
await page.waitForTimeout(300);
check('편집을 마치면 원본이 돌아온다', await days('thu'), ['멜팅의원', '웨비나 참석', '낭만백수달']);

const one = await cell(3).locator('.item').nth(2).boundingBox();
await page.mouse.move(one.x + 30, one.y + one.height / 2); await page.mouse.down();
await page.waitForTimeout(680); await page.mouse.up(); await page.waitForTimeout(300);
check('롱프레스 삭제', await days('thu'), ['멜팅의원', '웨비나 참석']);

console.log('\n── 긋기 · 지우기 ──');
await strikeFirst('thu');
check('가로 드래그로 긋기', await page.evaluate(() => App.week.days.thu.filter(i => i.struck).length), 1);
check('획은 시드+비율로 저장', await page.evaluate(() =>
  Object.keys(App.week.days.thu[0].strikes[0]).sort()), ['a', 'b', 'line', 'seed']);

console.log('\n── 여백에서 시작한 긋기 ──');
/* 실제 사용에서 사람들은 글자 왼쪽, 날짜가 있는 여백에서부터 손을 긋기 시작한다.
   거기서 시작한 손짓이 버려지면 "안 그어지는" 앱이 된다 (spec §4-2, 2026-08-24) */
{
  const seed = texts => page.evaluate(list => {
    const now = Date.now();
    App.week.days.sat = list.map((text, i) => ({
      id: 'gut' + i, text, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [],
    }));
    App.week.notes.sat = '회식'; App.week.noteAt.sat = now;
    App.week.noteStrikes.sat = [];
    App.save(); App.render();
  }, texts);
  const spot = i => page.evaluate(n => {
    const r = App.cells.sat.items[n].el.getBoundingClientRect();
    const g = App.cells.sat.gutter.getBoundingClientRect();
    return { x: g.x + 6, y: r.top + r.height / 2, endX: r.right - 6 };
  }, i);
  const strikes = () => page.evaluate(() => App.week.days.sat.map(i => i.strikes.length));

  await seed(['메일 보내기', '은행']);
  await page.waitForTimeout(350);
  {
    const g = await spot(0);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) { await page.mouse.move(g.x + (g.endX - g.x) * (i / 16), g.y); await page.waitForTimeout(8); }
    await page.mouse.up(); await page.waitForTimeout(400);
  }
  check('여백에서 시작해도 그어진다', await strikes(), [1, 0]);
  check('그때 항목 입력창도 메모도 안 열린다',
    await page.locator('.entry, .sublabel-entry').count(), 0);
  check('여백에서 시작해도 메모는 안 건드린다', await page.evaluate(() =>
    [App.week.notes.sat, App.week.noteStrikes.sat.length]), ['회식', 0]);

  /* **잉크는 글자에서부터 나온다.** 손가락이 지나온 여백까지 그려지면
     날짜 위로 줄이 지나간다. 자동 긋기와 같은 만큼(2px)만 삐져나간다. */
  check('잉크가 여백으로 넘어오지 않는다', await page.evaluate(() => {
    const it = App.cells.sat.items[0];
    const rec = it.data.strikes[0];
    const w = Math.max(1, it.textEl.getClientRects()[0].width);
    const pad = STROKE.overshoot / w + 0.001;
    return rec.a >= -pad && rec.b <= 1 + pad;
  }), true);

  /* 여백의 롱프레스는 **항목 삭제가 아니다** — 가로로 움직여야 넘긴다 */
  await seed(['메일 보내기', '은행']);
  await page.waitForTimeout(350);
  {
    const g = await spot(1);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up(); await page.waitForTimeout(350);
  }
  check('여백에서 꾹 눌러도 항목은 안 지워진다', await days('sat'), ['메일 보내기', '은행']);
  await page.keyboard.press('Escape');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);

  /* 넘겨받은 손짓은 **이미 긋기로 판정된 것**이다. 도중에 손이 멎어도
     삭제로 바뀌면 안 된다 — 판정 문턱(8px)을 갓 넘긴 자리에서 쉬는 경우다.
     넘길 때 롱프레스를 아예 걸지 않는 이유 (spec §4-2). */
  {
    const g = await spot(1);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    await page.mouse.move(g.x + 9, g.y);      // 문턱을 갓 넘긴다 — 넘어간다
    await page.waitForTimeout(800);           // 그 자리에서 쉰다
    await page.mouse.up(); await page.waitForTimeout(350);
  }
  check('넘겨받은 뒤 손이 멎어도 삭제로 바뀌지 않는다',
    await days('sat'), ['메일 보내기', '은행']);

  /* 세로 우세도 넘기지 않는다 — 이 방향은 아직 비어 있는 자리다 */
  {
    const g = await spot(0);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(g.x + 2, g.y + i * 4); await page.waitForTimeout(8); }
    await page.mouse.up(); await page.waitForTimeout(350);
  }
  check('여백에서 시작한 세로 드래그는 긋지 않는다', await strikes(), [0, 0]);

  /* 그어진 줄이면 지우개다. 여백에서 시작해도 같다 */
  await page.evaluate(() => {
    App.week.days.sat[0].strikes = [{ line: 0, a: 0.01, b: 0.98, seed: 1074304443 }];
    App.week.days.sat[0].struck = true;
    App.save(); App.render();
  });
  await page.waitForTimeout(350);
  {
    const g = await spot(0);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let n = 0; n < 5; n++) {
      for (let i = 1; i <= 14; i++) {
        const t = n % 2 ? 1 - i / 14 : i / 14;
        await page.mouse.move(g.x + (g.endX - g.x) * t, g.y); await page.waitForTimeout(5);
      }
    }
    await page.mouse.up(); await page.waitForTimeout(500);
  }
  check('여백에서 시작해도 지우개가 된다', await strikes(), [0, 0]);

  /* 나뉜 칸에서는 왼쪽 단부터 — 여백에서 오는 손이 먼저 닿는 쪽이다 */
  await seed(['하나', '둘', '셋', '넷', '다섯', '여섯']);
  await page.waitForTimeout(400);
  check('칸이 나뉘었다', await page.evaluate(() =>
    Number(App.cells.sat.listEl.style.columnCount) > 1), true);
  {
    const g = await page.evaluate(() => {
      const r = App.cells.sat.items[0].el.getBoundingClientRect();
      const q = App.cells.sat.gutter.getBoundingClientRect();
      return { x: q.x + 6, y: r.top + r.height / 2, endX: r.right - 4, left: r.left };
    });
    /* 같은 높이에 오른쪽 단 항목도 있다 — 왼쪽 것이 그어져야 한다 */
    check('같은 높이에 오른쪽 단 항목도 있다', await page.evaluate(y =>
      App.cells.sat.items.filter(it => {
        const r = it.el.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      }).length, g.y), 2);
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) { await page.mouse.move(g.x + (g.endX - g.x) * (i / 16), g.y); await page.waitForTimeout(8); }
    await page.mouse.up(); await page.waitForTimeout(400);
  }
  check('나뉜 칸에서는 왼쪽 단이 그어진다',
    await page.evaluate(() => App.week.days.sat.map(i => i.strikes.length)), [1, 0, 0, 0, 0, 0]);

  await page.evaluate(() => {
    App.week.days.sat = []; App.week.notes.sat = '';
    App.week.noteStrikes.sat = []; App.week.noteAt.sat = Date.now();
    App.save(); App.render();
  });
  await page.waitForTimeout(300);
}

console.log('\n── 지우개는 어중간한 상태를 남기지 않는다 ──');
/* 양 끝은 문대는 손이 되돌아가는 자리라 한 번밖에 안 지나간다.
   그래서 늘 잔흔이 남았다 — 손을 뗄 때 결판을 낸다. */
{
  const seedStruck = () => page.evaluate(() => {
    const now = Date.now();
    App.week.days.wed = [{ id: 'e1', text: '회의자료 정리하기', struck: true,
      createdAt: now, updatedAt: now,
      strikes: [{ line: 0, a: 0.01, b: 0.98, seed: 1074304443 }] }];
    App.save(); App.render();
  });
  const inkState = () => page.evaluate(() => {
    const it = App.cells.wed.items[0];
    return { 획: it ? it.strokes.length : 0,
             남은마스크: it ? it.strokes.filter(s => s.mask).length : 0,
             저장: App.week.days.wed.map(i => i.strikes.length) };
  });
  const rub = async span => {
    const r = await page.evaluate(() => {
      const el = App.cells.wed.listEl.querySelector('.item-text');
      const q = document.createRange(); q.selectNodeContents(el);
      const b = Array.from(q.getClientRects()).filter(v => v.width > 1)[0];
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const y = r.y + r.h / 2;
    const x0 = r.x + r.w * (1 - span) / 2, x1 = r.x + r.w * (1 - (1 - span) / 2);
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let n = 0; n < 2; n++) {
      const [a, b] = n % 2 === 0 ? [x0, x1] : [x1, x0];
      for (let i = 1; i <= 12; i++) { await page.mouse.move(a + (b - a) * (i / 12), y); await page.waitForTimeout(9); }
    }
    await page.mouse.up(); await page.waitForTimeout(400);
  };

  await seedStruck(); await page.waitForTimeout(400);
  await rub(1.0);
  check('전체를 문대면 획이 사라진다', await inkState(), { 획: 0, 남은마스크: 0, 저장: [0] });

  await seedStruck(); await page.waitForTimeout(400);
  await rub(0.12);
  check('덜 지웠으면 잉크가 온전히 돌아온다 (잔흔 없음)',
    await inkState(), { 획: 1, 남은마스크: 0, 저장: [1] });

  await page.evaluate(() => { App.week.days.wed = []; App.save(); App.render(); });
  await page.waitForTimeout(250);
}

console.log('\n── 지우개는 넓다 ──');
/* 손짓을 붙든 항목에만 갇혀 있어서, 넓게 문대도 한 줄씩밖에 안 지워졌다.
   지우개는 **손가락 아래에 있는 것**을 지운다 (spec §4-2, 2026-08-24) */
{
  const seed = () => page.evaluate(() => {
    const now = Date.now();
    App.week.days.wed = ['메일 보내기', 'J42 확인', 'G46', '반려 처리'].map((text, i) => ({
      id: 'rub' + i, text, struck: true, createdAt: now + i, updatedAt: now + i,
      strikes: [{ line: 0, a: 0.01, b: 0.99, seed: 1074304443 + i }],
    }));
    App.week.notes.wed = '회식'; App.week.noteAt.wed = now; App.week.noteStrikes.wed = [];
    App.save(); App.render();
  });
  const left = () => page.evaluate(() => App.week.days.wed.map(i => i.strikes.length));
  const masks = () => page.evaluate(() =>
    App.cells.wed.items.reduce((n, it) => n + it.strokes.filter(s => s.mask).length, 0));
  const band = () => page.evaluate(() => {
    const rs = App.cells.wed.items.map(i => i.el.getBoundingClientRect());
    return { top: rs[0].top + rs[0].height / 2,
             bot: rs[rs.length - 1].top + rs[rs.length - 1].height / 2,
             x0: rs[0].left + 4, x1: Math.max(...rs.map(r => r.right)) - 4 };
  });
  /* 좌우로 오가며, 패스마다 높이를 옮긴다 — 넓은 면을 문대는 손짓 */
  const wipe = async (b, passes, span = 1) => {
    await page.mouse.move(b.x0, b.top); await page.mouse.down();
    for (let n = 0; n < passes; n++) {
      const y = b.top + (b.bot - b.top) * ((n % 3) / 2);
      const w = (b.x1 - b.x0) * span, x0 = b.x0 + ((b.x1 - b.x0) - w) / 2;
      for (let i = 1; i <= 22; i++) {
        const t = i / 22;
        await page.mouse.move(n % 2 ? x0 + w - w * t : x0 + w * t, y);
        await page.waitForTimeout(5);
      }
    }
    await page.mouse.up(); await page.waitForTimeout(600);
  };

  await seed(); await page.waitForTimeout(450);
  check('네 항목이 다 그어져 있다', await left(), [1, 1, 1, 1]);
  await wipe(await band(), 6);
  check('넓게 문대면 한 손짓에 여러 줄이 지워진다', await left(), [0, 0, 0, 0]);
  check('그래도 요일 메모는 딸려 가지 않는다', await page.evaluate(() =>
    [App.week.notes.wed, App.week.noteStrikes.wed.length]), ['회식', 0]);

  /* 한 줄만 문대면 이웃은 그대로다 — 넓어진다고 흘러넘치면 안 된다 */
  await seed(); await page.waitForTimeout(450);
  {
    const r = await page.evaluate(() => {
      const q = App.cells.wed.items[1].el.getBoundingClientRect();
      return { y: q.top + q.height / 2, x0: q.left + 4, x1: q.right - 4 };
    });
    await page.mouse.move(r.x0, r.y); await page.mouse.down();
    for (let n = 0; n < 4; n++) {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        await page.mouse.move(n % 2 ? r.x1 - (r.x1 - r.x0) * t : r.x0 + (r.x1 - r.x0) * t, r.y);
        await page.waitForTimeout(5);
      }
    }
    await page.mouse.up(); await page.waitForTimeout(600);
  }
  check('한 줄만 문대면 그 줄만 지워진다', await left(), [1, 0, 1, 1]);

  /* 어중간한 상태를 남기지 않는 규칙은 **닿은 항목 전부**에 걸린다.
     손을 뗄 때 주인만 정리하면 남의 항목에 벗겨진 잉크가 남는다. */
  await seed(); await page.waitForTimeout(450);
  await wipe(await band(), 3, 0.12);
  check('여럿을 덜 문댔으면 전부 온전히 돌아온다', await left(), [1, 1, 1, 1]);
  check('닿았던 항목 어디에도 잔흔이 없다', await masks(), 0);

  await page.evaluate(() => {
    App.week.days.wed = []; App.week.notes.wed = '';
    App.week.noteStrikes.wed = []; App.week.noteAt.wed = Date.now();
    App.save(); App.render();
  });
  await page.waitForTimeout(250);
}

console.log('\n── 칸이 스스로 나뉜다 ──');
/* 한 열에 몇 줄이 들어가는지는 화면 높이가 정한다. 그래서 개수를 못 박고 검사하지 않고,
   "넘칠 때만 나뉜다"는 성질을 검사한다. */
const colsOf = key => page.evaluate(k => getComputedStyle(App.cells[k].listEl).columnCount, key);
const growth = await page.evaluate(() => {
  const out = [];
  for (let n = 1; n <= 20; n++) {
    App.week.days.fri = Array.from({ length: n }, (_, i) =>
      ({ id: 'f' + i, text: '항목 ' + (i + 1), struck: false, createdAt: 0, strikes: [] }));
    App.render(); App.relayoutAll();
    out.push({
      n,
      cols: Number(getComputedStyle(App.cells.fri.listEl).columnCount),
      hidden: App.hiddenCount(App.cells.fri),
      font: parseFloat(getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize),
    });
  }
  return out;
});
check('한 열로 시작한다', growth[0].cols, 1);
check('열 수는 줄어들지 않는다',
  growth.every((r, i) => i === 0 || r.cols >= growth[i - 1].cols), true);
check('한 열에 들어가는 동안은 나누지 않는다',
  growth.filter(r => r.cols === 1 && r.hidden > 0).length, 0);
check('넘치면 2단이 된다', growth.some(r => r.cols === 2), true);
check('2단으로도 모자라면 3단', growth.some(r => r.cols === 3), true);
check('3단이 되기 전에는 잘리지 않는다',
  growth.filter(r => r.cols < 3 && r.hidden > 0).length, 0);
check('나누면 그 칸 글씨가 작아짐',
  growth.find(r => r.cols === 2).font < growth[0].font, true);
check('더 나누면 더 작아짐',
  growth.find(r => r.cols === 3).font < growth.find(r => r.cols === 2).font, true);

await page.evaluate(() => { App.week.days.fri = App.week.days.fri.slice(0, 1); App.save(); App.render(); });
await page.waitForTimeout(400);
check('줄이면 다시 한 열', await colsOf('fri'), '1');
check('안 나눈 칸은 그대로', await page.evaluate(() =>
  getComputedStyle(App.cells.thu.listEl.querySelector('.item-text')).fontSize ===
  getComputedStyle(App.cells.fri.listEl.querySelector('.item-text')).fontSize), true);

check('세로선은 그리지 않는다', await page.evaluate(() =>
  document.querySelectorAll('.split-svg').length), 0);
await page.evaluate(() => {
  App.week.days.free = Array.from({ length: 12 }, (_, i) =>
    ({ id: 'v' + i, text: '단어 ' + i, struck: false, createdAt: 0, strikes: [] }));
  App.render();
});
await page.waitForTimeout(400);
check('note 칸은 나뉘지 않는다', await colsOf('free'), '1');
await page.evaluate(() => { App.week.days.free = []; App.week.days.fri = []; App.save(); App.render(); });
await page.waitForTimeout(300);

console.log('\n── 저장 · 주 이동 ──');
await page.reload(); await page.waitForTimeout(500);
check('새로고침 후 항목 유지', await days('thu'), ['멜팅의원', '웨비나 참석']);
check('새로고침 후 획 복원', await page.evaluate(() =>
  App.cells.thu.listEl.querySelectorAll('g path').length), 1);

const title = await page.locator('#weekTitle').textContent();
await page.locator('#next').click(); await page.waitForTimeout(300);
check('다음 주는 빈 주', await page.evaluate(() =>
  Object.values(App.week.days).reduce((n, a) => n + a.length, 0)), 0);
check('다음 주에도 빈 곳이 눌린다', await page.evaluate(() =>
  !!App.cells.mon.section), true);
await page.locator('#prev').click(); await page.locator('#prev').click(); await page.waitForTimeout(300);

await tapCell(0);
await type(['지난 주에 적기']);
check('지난 주에도 적힌다', await days('mon'), ['지난 주에 적기']);
check('머리말 아래 안내는 없다', await page.locator('#note').isVisible(), false);
await page.evaluate(() => { App.week.days.mon = []; App.save(); App.render(); });
await page.waitForTimeout(300);
await page.locator('#next').click(); await page.waitForTimeout(400);
check('원래 주로 복귀', await page.locator('#weekTitle').textContent(), title);

console.log('\n── 넘친 항목 ──');
/* 칸 높이가 고정이라 넘치면 잘린다. 잘렸다는 사실은 화면에 남아야 한다 */
await page.evaluate(() => {
  /* 3단으로 나뉘고도 남을 만큼 — 여기서부터가 진짜로 잘리는 구간 */
  App.week.days.tue = Array.from({ length: 24 }, (_, i) =>
    ({ id: 'ov' + i, text: '할 일 ' + (i + 1), struck: false, createdAt: 0, strikes: [] }));
  App.save(); App.render();
});
await page.waitForTimeout(500);
const markOf = key => page.evaluate(k => {
  const m = App.cells[k].section.querySelector('.overflow-mark');
  return m ? m.textContent : null;
}, key);
const over1 = await markOf('tue');
check('칸이 넘치면 잘렸다고 표시', /^\+\d+$/.test(over1 || ''), true);
check('넘치지 않는 칸엔 표시 없음', await markOf('mon'), null);
check('넘쳐도 3단까지는 자동으로 나뉜다', await page.evaluate(() =>
  getComputedStyle(App.cells.tue.listEl).columnCount), '3');
await page.evaluate(() => { App.week.days.tue = App.week.days.tue.slice(0, 3); App.save(); App.render(); });
await page.waitForTimeout(400);
check('항목을 줄이면 표시가 사라짐', await markOf('tue'), null);

console.log('\n── 백업 ──');
check('평소엔 계정 화면이 닫혀 있다', await page.locator('#account').isVisible(), false);
check('hidden을 건 것은 예외 없이 숨는다', await page.evaluate(() =>
  Array.from(document.querySelectorAll('[hidden]'))
    .every(el => getComputedStyle(el).display === 'none')), true);
check('머리말에 계정으로 들어가는 문이 있다', await page.locator('#acctBtn').isVisible(), true);
await page.locator('#acctBtn').click();
await page.waitForTimeout(250);
check('사람 표시를 누르면 열린다', await page.locator('#account').isVisible(), true);
/* 계정 화면은 머리말까지 덮으므로 사람 표시가 가려진다 — 닫는 문은 `닫기` 하나다 */
check('열려 있는 동안 사람 표시는 가려진다', await page.evaluate(() => {
  const b = document.getElementById('acctBtn').getBoundingClientRect();
  const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!(top && top.closest('#account'));
}), true);
await page.locator('#acctClose').click();
await page.waitForTimeout(250);
check('닫기로 닫힌다', await page.locator('#account').isVisible(), false);
const tbox = await page.locator('#weekTitle').boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
await page.waitForTimeout(300);
check('제목 롱프레스로 계정 화면이 열린다', await page.locator('#account').isVisible(), true);

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#exportBtn').click(),
]);
let dumpText = '';
for await (const chunk of await download.createReadStream()) dumpText += chunk;
const dump = JSON.parse(dumpText);
check('내보낸 파일 이름', /^clear-week-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), true);
check('저장된 주가 전부 파일에 들어감', Object.keys(dump.weeks).length, await page.evaluate(() =>
  Object.keys(localStorage).filter(k => /^clearweek:\d{4}-W\d{2}$/.test(k)).length));

/* 가져오기는 덮어쓰지 않는다 — 되돌리기가 없으므로 지우는 쪽으로 기울지 않는다 */
const brought = await page.evaluate(txt => {
  const data = JSON.parse(txt);
  const id = Object.keys(data.weeks)[0];
  data.weeks[id].days.mon = [{ id: 'zz', text: '덮어쓰기 시도', struck: false, createdAt: 0, strikes: [] }];
  data.weeks['2019-W01'] = {
    weekId: '2019-W01',
    days: { mon: [{ id: 'old', text: '옛 주', struck: false, createdAt: 0, strikes: [] }] },
    splits: {}, notes: {},
  };
  const before = localStorage.getItem('clearweek:' + id);
  const r = importBackup(JSON.stringify(data));
  return { r, untouched: localStorage.getItem('clearweek:' + id) === before,
           filled: localStorage.getItem('clearweek:2019-W01') !== null };
}, dumpText);
check('없던 주만 채움', brought.r.added, 1);
check('이미 있는 주는 그대로 둠', brought.untouched, true);
check('가져온 주가 실제로 생김', brought.filled, true);
check('백업 파일이 아니면 거절', await page.evaluate(() => importBackup('{"a":1}').error), 'Clear Week 백업 파일이 아님');
check('깨진 파일은 거절', await page.evaluate(() => importBackup('nope').error), '읽을 수 없는 파일');
check('안내 기록은 주 데이터가 아니다', await page.evaluate(() =>
  Object.keys(collectWeeks().weeks).some(id => id.indexOf('guide') >= 0)), false);
await page.locator('#guideBtn').click();
await page.waitForTimeout(250);
check('백업 줄에서 안내를 다시 열 수 있다', await page.locator('#guide').isVisible(), true);
check('안내를 열면 계정 화면은 닫힌다', await page.locator('#account').isVisible(), false);
check('다시 열면 첫 줄부터 짚는다', await page.evaluate(() => App.guideStep), 0);
/* 끝까지 짚어야 닫힌다 — 한 번 눌러서는 다음 줄로 갈 뿐이다 */
await 끝까지();
await page.locator('#guideClose').click();
await page.waitForTimeout(200);
check('다시 본 안내도 닫힌다', await page.locator('#guide').isVisible(), false);

console.log('\n── 삭제하면 아래가 위로 올라온다 ──');
/* 지운 자리가 비어 있으면 안 된다. 지운 경로가 여럿이라 전부 확인한다 */
const tops = key => page.evaluate(k => {
  const box = App.cells[k].listEl.getBoundingClientRect();
  return Array.from(App.cells[k].listEl.querySelectorAll('.item')).map(el => {
    const r = el.getBoundingClientRect();
    return el.textContent + '@' + Math.round(r.top - box.top) + ',' + Math.round(r.left - box.left);
  });
}, key);
const seedCell = (key, texts) => page.evaluate(([k, list]) => {
  const now = Date.now();
  App.week.days[k] = list.map((text, i) =>
    ({ id: k + i, text, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [] }));
  App.save(); App.render();
}, [key, texts]);

await seedCell('wed', ['하나', '둘', '셋']);
await page.waitForTimeout(400);
await page.evaluate(() => App.removeItem(App.cells.wed.items[1], 'wed'));
await page.waitForTimeout(300);
check('가운데를 지우면 아래가 올라온다', await tops('wed'), ['하나@0,0', '셋@26,0']);

await seedCell('wed', ['하나', '둘', '셋']);
await page.waitForTimeout(400);
await page.evaluate(() => {
  const it = App.cells.wed.items[0];
  it.data.struck = true;
  it.data.strikes = [{ line: 0, a: 0.02, b: 0.97, seed: 12345 }];
  it.clearStrokes(); it.restore();
});
await page.waitForTimeout(250);
await page.evaluate(() => App.removeItem(App.cells.wed.items[0], 'wed'));
await page.waitForTimeout(300);
check('그어진 것을 지워도 올라온다', await tops('wed'), ['둘@0,0', '셋@26,0']);
check('지운 항목의 획도 같이 사라진다', await page.evaluate(() =>
  App.cells.wed.listEl.querySelectorAll('svg path').length), 0);

await seedCell('wed', ['하나', '둘', '셋', '넷']);
await page.waitForTimeout(400);
{
  const b = await cell(2).locator('.item').nth(0).boundingBox();
  await page.mouse.move(b.x + 30, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(700);
  await page.mouse.move(b.x + 30, b.y + b.height * 1.5, { steps: 5 });
  await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(400);
}
check('훑어 지워도 남은 것이 맨 위로', await tops('wed'), ['셋@0,0', '넷@26,0']);
await page.evaluate(() => { App.week.days.wed = []; App.save(); App.render(); });
await page.waitForTimeout(300);

console.log('\n── 만든 사람은 계정 화면 안에 ──');
check('주간 화면에는 푸터가 없다', await page.locator('.made').isVisible(), false);
{
  const b = await page.locator('#weekTitle').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
  await page.waitForTimeout(250);
}
check('계정 화면 안에 있다', await page.locator('.made').isVisible(), true);
check('홈 링크', await page.locator('#homeLink').getAttribute('href'),
  'https://dada-portfolio.stupidpoohh.workers.dev/');
check('새 창으로 연다', await page.locator('#homeLink').getAttribute('rel'), 'noopener noreferrer');
check('계정 화면은 주간 표를 줄이지 않는다', await page.evaluate(() => {
  const w = document.querySelector('.week').getBoundingClientRect();
  return getComputedStyle(document.getElementById('account')).position === 'fixed' && w.height > 300;
}), true);
await page.locator('#acctClose').click();
await page.waitForTimeout(250);
check('닫기로 닫힌다', await page.locator('#account').isVisible(), false);

console.log('\n── 저장 실패 ──');
/* 사파리 사생활 모드처럼 저장이 막힌 상황 */
await page.evaluate(() => {
  window.origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('blocked'); };
});
await page.evaluate(() => App.save());
await page.waitForTimeout(150);
check('저장이 막히면 알린다', await page.locator('#note').isVisible(), true);
check('알림 문구', /^저장 안 됨/.test(await page.locator('#note').textContent()), true);

console.log('\n── 로그인 · 동기화 ──');
check('서버가 없으면 로그인 버튼을 내보이지 않는다', await page.evaluate(() => {
  const was = Sync.ready;
  Sync.ready = false; App.renderAuth();
  const hidden = document.getElementById('loginBtn').hidden;
  const msg = document.getElementById('authMsg').textContent;
  Sync.ready = was; App.renderAuth();
  return { hidden, msg };
}), { hidden: true, msg: '이 기기에만 저장됩니다' });
/* 로그아웃 상태의 앱은 예전과 완전히 같아야 한다 */
await page.evaluate(() => { Storage.prototype.setItem = origSetItem; });
await page.reload(); await page.waitForTimeout(500);
check('로그아웃 상태에서는 이 기기에만 저장', await page.evaluate(() => Sync.email), null);

async function openDrawer(pg) {
  const b = await pg.locator('#weekTitle').boundingBox();
  await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await pg.mouse.down(); await pg.waitForTimeout(680); await pg.mouse.up();
  await pg.waitForTimeout(250);
}
async function login(pg, mail) {
  await openDrawer(pg);
  await pg.locator('#loginBtn').click();
  await pg.locator('#loginEmail').fill(mail);
  await pg.locator('#sendCode').click();
  await pg.waitForTimeout(250);
  await pg.locator('#loginCode').fill(api.lastCode);
  await pg.locator('#authGo').click();
  await pg.waitForFunction(() => Sync.email !== null, null, { timeout: 5000 });
  await pg.waitForTimeout(400);
}

await login(page, 'me@example.com');
check('로그인하면 주소가 잡힌다', await page.evaluate(() => Sync.email), 'me@example.com');
check('로그인하면 사람 표시가 진해진다', await page.evaluate(() =>
  document.getElementById('acctBtn').classList.contains('on')), true);

/* 코드는 기기가 아니라 메일 주소에 묶인다 — 받은 코드를 다른 기기에 넣어도 된다 */
{
  const other = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
  await other.goto(`http://127.0.0.1:${PORT}/index.html`);
  await other.waitForTimeout(400);
  await other.evaluate(() => { markGuideSeen(); });
  await other.reload(); await other.waitForTimeout(500);
  await other.locator('#acctBtn').click();
  await other.waitForTimeout(200);
  await other.locator('#loginBtn').click();
  await other.locator('#loginEmail').fill('me@example.com');
  check('코드 칸은 코드 받기를 누르지 않아도 열려 있다',
    await other.locator('#loginCode').isVisible(), true);
  /* 이 기기에서 코드를 받지 않고, 다른 기기가 받아 둔 코드를 그대로 넣는다 */
  await other.locator('#sendCode').click();
  await other.waitForTimeout(250);
  const codeFromElsewhere = api.lastCode;
  await other.reload(); await other.waitForTimeout(500);
  await other.locator('#acctBtn').click();
  await other.waitForTimeout(200);
  await other.locator('#loginBtn').click();
  await other.locator('#loginEmail').fill('me@example.com');
  await other.locator('#loginCode').fill(codeFromElsewhere);
  await other.locator('#authGo').click();
  await other.waitForFunction(() => Sync.email !== null, null, { timeout: 5000 });
  check('다른 기기가 받은 코드로 로그인된다',
    await other.evaluate(() => Sync.email), 'me@example.com');
  await other.close();
}

/* PC에서 적은 것이 서버로 올라간다 */
await page.locator('#acctClose').click();      // 계정 화면 닫기
await page.waitForTimeout(200);
await tapCell(0);
await type(['PC에서 적음']);
await page.locator('#weekTitle').click();      // 입력 끝내기
await page.waitForTimeout(1400);
check('적은 것이 서버에 올라간다',
  Object.values(api.weeks).some(w => w.days.mon.some(i => i.text === 'PC에서 적음')), true);

/* 폰 = 저장소가 다른 새 브라우저 */
const phone = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
await phone.goto(`http://127.0.0.1:${PORT}/index.html`);
await phone.waitForTimeout(400);
await phone.evaluate(() => { markGuideSeen(); document.getElementById('guide').hidden = true; App.closeGuide && App.closeGuide(); });
await phone.reload(); await phone.waitForTimeout(500);
check('폰은 처음엔 비어 있다', await phone.evaluate(() => App.week.days.mon.length), 0);

await login(phone, 'me@example.com');
check('폰에서 로그인하면 받아온다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);

/* 양쪽에서 따로 적으면 둘 다 남는다 */
await phone.locator('#acctClose').click();
await phone.waitForTimeout(200);
await phone.evaluate(() => {
  const now = Date.now();
  App.week.days.mon.push({ id: 'phone-1', text: '폰에서 적음', struck: false,
    createdAt: now, updatedAt: now, strikes: [] });
  App.save();
});
await phone.waitForTimeout(1500);
await page.evaluate(() => Sync.push());
await page.waitForTimeout(600);
check('양쪽에서 적은 것이 둘 다 남는다',
  await page.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음', '폰에서 적음']);

/* 한쪽에서 지우면 다른 쪽에서도 지워진다 (되살아나지 않는다) */
await page.evaluate(() => {
  const item = App.cells.mon.items.find(i => i.data.text === '폰에서 적음');
  App.removeItem(item, 'mon');
});
await page.waitForTimeout(1500);
await phone.evaluate(() => Sync.push());
await phone.waitForTimeout(600);
check('지운 것은 다른 기기에서도 사라진다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);
await phone.evaluate(() => Sync.push());
await phone.waitForTimeout(600);
check('지운 것이 되살아나지 않는다',
  await phone.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);

/* 요일 메모의 획도 기기 사이를 건넌다 — 글자와 한 몸으로 (spec §4-6) */
{
  await page.evaluate(() => {
    App.week.notes.thu = '월말 정산';
    App.week.noteAt.thu = Date.now();
    App.week.noteStrikes.thu = [];
    App.save(); App.render();
  });
  await page.waitForTimeout(1500);
  await phone.evaluate(() => Sync.push());
  await phone.waitForTimeout(700);
  check('메모가 다른 기기로 건너간다',
    await phone.evaluate(() => App.week.notes.thu), '월말 정산');

  await page.evaluate(() => {
    App.week.noteStrikes.thu.push({ line: 0, a: 0.02, b: 0.98, seed: 4242 });
    App.cells.thu.sub.data.struck = true;
    App.week.noteAt.thu = Date.now();
    App.save();
  });
  await page.waitForTimeout(1500);
  await phone.evaluate(() => Sync.push());
  await phone.waitForTimeout(700);
  check('메모에 그은 획도 건너간다', await phone.evaluate(() =>
    [App.week.noteStrikes.thu.length, App.week.notes.thu]), [1, '월말 정산']);
  check('받은 쪽에서도 실제로 그어져 보인다',
    await phone.evaluate(() => App.cells.thu.sub.strokes.length), 1);
}

/* 밀어 올리는 중에 그은 획이 사라지던 일 (2026-08-20).
   올린 것에는 없는 획이 응답에 없으니, 그 응답을 그대로 받으면 획이 지워졌다.
   연달아 그을 때 두 번째부터 사라지던 것이 이것이다. */
{
  api.syncDelay = 700;
  /* mon은 뒤의 로그아웃 검사가 들여다본다 — 건드리지 않는 칸에서 잰다 */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.tue = ['하나', '둘', '셋'].map((text, i) => ({
      id: 'race-' + i, text, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [],
    }));
    App.save(); App.render();
  });
  await page.waitForTimeout(1800);

  /* 앞 절이 tue에 남긴 것이 있을 수 있다 — 내가 넣은 것만 골라 잰다 */
  const strikeById = async id => {
    const r = await page.evaluate(want => {
      const it = App.cells.tue.items.find(v => v.data.id === want);
      const q = document.createRange(); q.selectNodeContents(it.textEl);
      const x = Array.from(q.getClientRects()).filter(v => v.width > 1)[0];
      return { x: x.x, y: x.y, w: x.width, h: x.height };
    }, id);
    const y = r.y + r.h / 2;
    await page.mouse.move(r.x + 1, y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(r.x + 1 + r.w * 0.95 * (i / 12), y); await page.waitForTimeout(6); }
    await page.mouse.up();
  };
  const strikeCounts = () => page.evaluate(() =>
    App.week.days.tue.filter(i => String(i.id).startsWith('race-')).map(i => i.strikes.length));

  await strikeById('race-0');
  await page.waitForTimeout(950);       // 올리기가 막 떠난 시점
  await strikeById('race-1');           // 응답이 오기 전에 다음 획
  await strikeById('race-2');
  check('연달아 그으면 그 자리에 다 남는다', await strikeCounts(), [1, 1, 1]);
  await page.waitForTimeout(3000);      // 응답 도착 + 다시 올리기까지
  check('올리는 중에 그은 획이 응답에 지워지지 않는다', await strikeCounts(), [1, 1, 1]);
  check('그 획들이 서버에도 올라간다',
    Object.values(api.weeks).some(w =>
      w.days.tue.filter(i => String(i.id).startsWith('race-') && i.strikes.length).length === 3), true);
  api.syncDelay = 0;
}

await openDrawer(page);
await page.locator('#logoutBtn').click();
await page.waitForTimeout(300);
check('로그아웃해도 이 기기 기록은 남는다',
  await page.evaluate(() => App.week.days.mon.map(i => i.text)), ['PC에서 적음']);
check('로그아웃하면 더 이상 올리지 않는다', await page.evaluate(() => Sync.email), null);
check('로그아웃하면 사람 표시도 옅어진다', await page.evaluate(() =>
  document.getElementById('acctBtn').classList.contains('on')), false);
await phone.close();
await page.locator('#acctClose').click();
await page.waitForTimeout(200);

console.log('\n── 처음 이을 때 · 전부 비우기 ──');
/* 앞 절이 서버에 남긴 것을 치우고 빈 서버에서 시작한다 */
api.weeks = {}; api.resetAt = 0;
/* 양쪽에 다 기록이 있으면 합치기 전에 물어본다 */
const fresh = async (mail, seedText) => {
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/index.html`);
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { markGuideSeen(); });
  await pg.reload(); await pg.waitForTimeout(500);
  if (seedText) {
    await pg.evaluate(txt => {
      const now = Date.now();
      App.week.days.mon.push({ id: txt, text: txt, struck: false,
        createdAt: now, updatedAt: now, strikes: [] });
      App.save();
    }, seedText);
    await pg.waitForTimeout(200);
  }
  return pg;
};
const startLogin = async (pg, mail) => {
  await pg.locator('#acctBtn').click();
  await pg.waitForTimeout(200);
  await pg.locator('#loginBtn').click();
  await pg.locator('#loginEmail').fill(mail);
  await pg.locator('#sendCode').click();
  await pg.waitForTimeout(250);
  await pg.locator('#loginCode').fill(api.lastCode);
  await pg.locator('#authGo').click();
  await pg.waitForTimeout(700);
};

const devA = await fresh('me@example.com', 'A가 적은 것');
await startLogin(devA, 'me@example.com');
check('서버가 비어 있으면 묻지 않는다', await devA.locator('#linkRow').isVisible(), false);
await devA.waitForTimeout(400);

const devB = await fresh('me@example.com', 'B가 적은 것');
await startLogin(devB, 'me@example.com');
check('양쪽에 다 있으면 물어본다', await devB.locator('#linkRow').isVisible(), true);
check('묻는 동안에는 아직 합치지 않는다',
  await devB.evaluate(() => App.week.days.mon.map(i => i.text)), ['B가 적은 것']);

await devB.locator('#linkMine').click();
await devB.waitForTimeout(900);
check('이 기기 것으로 — 내 것만 남는다',
  await devB.evaluate(() => App.week.days.mon.map(i => i.text)), ['B가 적은 것']);
check('이 기기 것으로 — 서버도 그렇게 바뀐다',
  Object.values(api.weeks).flatMap(w => w.days.mon.map(i => i.text)), ['B가 적은 것']);

await devA.evaluate(() => Sync.push());
await devA.waitForTimeout(600);
check('비운 뒤 다른 기기가 옛것을 되살리지 못한다',
  await devA.evaluate(() => App.week.days.mon.map(i => i.text)), ['B가 적은 것']);

/* 전부 비우기 — 두 번 눌러야 한다 */
await devB.locator('#wipeBtn').click();
await devB.waitForTimeout(200);
check('한 번 누르면 확인만 한다', await devB.evaluate(() =>
  document.getElementById('wipeBtn').textContent), '정말 비웁니다');
check('아직 지워지지 않았다', Object.keys(api.weeks).length > 0, true);
await devB.locator('#wipeBtn').click();
await devB.waitForTimeout(700);
check('두 번째에 서버가 비워진다', Object.keys(api.weeks).length, 0);
check('이 기기도 비워진다',
  await devB.evaluate(() => App.week.days.mon.length), 0);

await devA.evaluate(() => Sync.push());
await devA.waitForTimeout(600);
check('다른 기기도 다음 차례에 비워진다',
  await devA.evaluate(() => App.week.days.mon.length), 0);
check('비운 뒤에도 서버가 다시 차지 않는다', Object.keys(api.weeks).length, 0);
await devA.close();
await devB.close();
api.resetAt = 0;

console.log('\n── 손이 닿아 있는 동안은 다시 그리지 않는다 ──');
/* 고치고 0.9초 뒤 올린 응답이 도착해 render()가 돌면 그리던 획이 통째로 사라진다.
   "지운 직후에는 선이 잘 안 그어진다"가 이것이었다. */
{
  await page.evaluate(() => {
    window.__renders = 0;
    const r = App.render.bind(App);
    App.render = function () { window.__renders++; return r(); };
    const now = Date.now();
    App.week.days.sun = ['회의자료 정리하기', '지울 것'].map((text, i) =>
      ({ id: 'g' + i, text, struck: false, createdAt: now + i, updatedAt: now + i, strikes: [] }));
    App.save(); App.render();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { App.removeItem(App.cells.sun.items[1], 'sun'); window.__renders = 0; });
  await page.waitForTimeout(750);        // 올리기까지 0.9초 — 응답이 긋는 도중에 온다
  const r = await page.evaluate(() => {
    const el = App.cells.sun.listEl.querySelector('.item-text');
    const q = document.createRange(); q.selectNodeContents(el);
    const x = Array.from(q.getClientRects()).filter(v => v.width > 1)[0];
    return { x: x.x, y: x.y, w: x.width, h: x.height };
  });
  const y = r.y + r.h / 2;
  await page.mouse.move(r.x + 1, y); await page.mouse.down();
  for (let i = 1; i <= 16; i++) { await page.mouse.move(r.x + 1 + r.w * 0.95 * (i / 16), y); await page.waitForTimeout(14); }
  await page.mouse.up(); await page.waitForTimeout(500);
  check('긋는 동안에는 다시 그리지 않는다', await page.evaluate(() => window.__renders), 0);
  check('지운 직후에도 획이 남는다', await page.evaluate(() =>
    App.week.days.sun.filter(i => i.struck).map(i => i.text)), ['회의자료 정리하기']);
  await page.evaluate(() => { App.week.days.sun = []; App.save(); App.render(); });
  await page.waitForTimeout(250);
}

console.log('\n── 안드로이드(터치) ──');
/* 터치에서는 브라우저가 click 시점에 버튼에 포커스를 준다. 입력창을 pointerup에서
   열면 그 click에 포커스를 빼앗겨 곧바로 닫힌다 — 갤럭시에서 생성이 안 되던 이유다. */
{
  const touch = await (await browser.newContext({
    viewport: { width: 393, height: 727 }, hasTouch: true, isMobile: true,
    deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  })).newPage();
  await touch.goto(`http://127.0.0.1:${PORT}/index.html`);
  await touch.evaluate(() => { markGuideSeen(); });
  await touch.reload(); await touch.waitForTimeout(600);

  const lb = await touch.locator('.days .cell').nth(0).boundingBox();
  await touch.touchscreen.tap(lb.x + lb.width * 0.6, lb.y + lb.height - 10);
  await touch.waitForTimeout(350);
  check('터치로 빈 곳을 눌러도 입력창이 열린다', await touch.locator('.entry').count(), 1);
  check('입력창이 포커스를 지킨다', await touch.evaluate(() =>
    document.activeElement && document.activeElement.className), 'entry');
  await touch.keyboard.type('터치로 적음');
  await touch.keyboard.press('Enter');
  await touch.waitForTimeout(300);
  check('터치로 적힌다', await touch.evaluate(() => App.week.days.mon.map(i => i.text)), ['터치로 적음']);

  const box = await touch.locator('.days .cell').nth(4).boundingBox();
  await touch.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height - 8);
  await touch.waitForTimeout(350);
  check('터치로 빈 곳을 눌러도 열린다', await touch.evaluate(() =>
    !!App.cells.fri.listEl.querySelector('.entry')), true);
  await touch.close();
}

console.log('\n── 소리 ──');
check('타자 소리와 깨우기가 있다', await page.evaluate(() =>
  [typeof Sound.key, typeof Sound.unlock]), ['function', 'function']);
{
  await page.evaluate(() => { window.__keys = 0; Sound.key = () => { window.__keys++; }; });
  await tapCell(6);
  await page.keyboard.type('소리');
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => window.__keys);
  check('글자를 넣을 때마다 한 번씩 운다', n > 0 && n <= 6, true);
  await page.evaluate(() => { window.__keys = 0; });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  check('글자가 안 바뀌는 키는 울지 않는다', await page.evaluate(() => window.__keys), 0);
  await page.keyboard.press('Enter');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { App.week.days.sun = []; App.save(); App.render(); });
  await page.waitForTimeout(200);
}

/* 톡과 사각사각의 균형 — 적힌 숫자는 두 소리를 비교해 주지 않는다.
   `keyVolume`이 `volume`보다 큰데도 18 dB 작게 들리던 적이 있다(spec §4-5).
   그래서 신호를 실제로 돌려, 귀가 한 덩어리로 듣는 200ms 창으로 잰다.
   여기 신호 경로는 index.html의 `Sound`를 베낀 것이다 — 한쪽을 고치면 같이 고칠 것. */
{
  const gap = await page.evaluate(async () => {
    const SR = 48000;
    const cut = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const noise = ctx => {
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        brown = (brown + 0.02 * w) / 1.02;
        d[i] = cut(w * 0.75 + brown * 2.5, -1, 1);
      }
      return buf;
    };
    /* 200ms 창에서 가장 큰 실효값 — 짧은 소리는 창을 다 못 채워 작게 나온다 */
    const loud = a => {
      const n = Math.floor(SR * 0.2);
      let best = 0;
      for (let i = 0; i + n <= a.length; i += Math.floor(n / 8)) {
        let e = 0;
        for (let j = i; j < i + n; j++) e += a[j] * a[j];
        best = Math.max(best, Math.sqrt(e / n));
      }
      return best;
    };

    /* 사각사각 — 가장 빠르게 그을 때 */
    const sc = new OfflineAudioContext(1, SR, SR);
    const scSrc = sc.createBufferSource();
    scSrc.buffer = noise(sc); scSrc.loop = true;
    const scF = sc.createBiquadFilter();
    scF.type = 'bandpass'; scF.frequency.value = SOUND.bandHz * 1.25; scF.Q.value = SOUND.bandQ;
    const scG = sc.createGain();
    scG.gain.value = SOUND.volume;                       // s = 1
    scSrc.connect(scF); scF.connect(scG); scG.connect(sc.destination); scSrc.start();

    /* 톡 — 한 번 */
    const ky = new OfflineAudioContext(1, Math.floor(SR * 0.4), SR);
    const kySrc = ky.createBufferSource();
    kySrc.buffer = noise(ky);
    const kyF = ky.createBiquadFilter();
    kyF.type = 'bandpass'; kyF.frequency.value = SOUND.keyHz; kyF.Q.value = SOUND.keyQ;
    const kyG = ky.createGain();
    const len = SOUND.keyMs / 1000;
    kyG.gain.setValueAtTime(0, 0.01);
    kyG.gain.linearRampToValueAtTime(SOUND.keyVolume, 0.012);
    kyG.gain.exponentialRampToValueAtTime(0.0001, 0.01 + len);
    kySrc.connect(kyF); kyF.connect(kyG); kyG.connect(ky.destination);
    kySrc.start(0.01, 0.3, len + 0.02); kySrc.stop(0.01 + len + 0.02);

    const [a, b] = await Promise.all([sc.startRendering(), ky.startRendering()]);
    const dB = v => 20 * Math.log10(Math.max(v, 1e-9));
    return dB(loud(b.getChannelData(0))) - dB(loud(a.getChannelData(0)));
  });
  /* 위: 톡이 사각사각보다 크면 적는 내내 시끄럽다.
     아래: 8 dB 넘게 벌어지면 톡이 사각사각에 묻힌다. */
  check(`톡이 사각사각에 묻히지 않는다 (${gap.toFixed(1)} dB)`, gap > -8 && gap < 0, true);
  check('두 소리가 다치지 않는다 (잘림 없음)', await page.evaluate(() =>
    SOUND.volume * 1 < 1 && SOUND.keyVolume * 0.45 < 1), true);
}

console.log('\n── 방문자 행동로그 ──');
/* 이 로그가 지켜야 할 선은 하나다: 적은 글자는 나가지 않는다.
   서버의 문지기(`_log.js`)는 tests/log.mjs가 따로 검사한다.
   여기서는 **클라이언트가 애초에 무엇을 보내는지**를 본다 — 문지기에 기대지 않는다. */
{
  /* 배포본에서는 꺼 둔 상태로 나간다 — 읽을 길이 없는 기록은 짐일 뿐이다.
     장치 자체는 성해야 하므로, 여기서는 켜고 잰다. */
  check('배포본에서는 행동로그가 꺼져 있다', await page.evaluate(() => LOG.enabled), false);
  check('꺼져 있으면 아무것도 모으지 않는다', await page.evaluate(() => {
    Log.ev('today'); return Log.q.length;
  }), 0);
  await page.evaluate(() => { LOG.enabled = true; Log.start(); });
  await page.waitForTimeout(200);

  const SECRET = '치과예약비밀번호1234';       // 이 글자가 로그에 나오면 실패다

  /* 여기 오기까지 쌓인 것을 먼저 다 비운다. 한 번에 40개씩만 나가므로
     비우지 않으면 이 절에서 만든 이벤트가 다음 묶음으로 밀린다. */
  await page.evaluate(() => { while (Log.q.length) Log.flush(); });
  await page.waitForTimeout(300);
  check('앱을 연 것이 남는다', api.log.some(e => e.ev === 'open'), true);
  api.log.length = 0; api.logRaw.length = 0;

  /* 앞 절들이 thu에 남긴 것을 치운다. 이미 그어진 항목이 첫 줄에 있으면
     그 위의 드래그는 긋기가 아니라 지우개가 된다 — 재던 것이 달라진다. */
  await page.evaluate(() => { App.week.days.thu = []; App.save(); App.render(); });
  await page.waitForTimeout(200);
  await tapCell(3);
  await type([SECRET, '두번째']);
  await strikeFirst('thu');
  await page.evaluate(() => { while (Log.q.length) Log.flush(); });
  await page.waitForTimeout(300);

  const names = api.log.map(e => e.ev);
  check('적은 것·그은 것이 로그에 남는다',
    ['add', 'strike'].every(n => names.includes(n)), true);

  /* 가장 중요한 검사 */
  const raw = JSON.stringify(api.logRaw);
  check('적은 글자가 나가지 않는다', raw.includes(SECRET) || raw.includes('치과'), false);
  check('두 번째 항목 글자도 나가지 않는다', raw.includes('두번째'), false);

  /* 문지기에 기대지 않고, 클라이언트가 보내는 자리 자체를 못박는다.
     새 필드를 늘리려면 이 목록과 `_log.js`를 같이 고쳐야 한다. */
  const allowed = ['ev', 'd', 'did', 'sid', 'n1', 'n2', 'w', 'h', 'signed'];
  const strayKeys = new Set();
  for (const batch of api.logRaw)
    for (const e of (batch.events || []))
      Object.keys(e).forEach(k => { if (!allowed.includes(k)) strayKeys.add(k); });
  check('약속한 자리 밖으로는 아무것도 안 보낸다', [...strayKeys], []);

  /* 글자 대신 길이만 — 길이는 내용이 아니다 */
  const add1 = api.log.find(e => e.ev === 'add' && e.n1 === SECRET.length);
  check('글자 대신 길이만 담긴다', !!add1, true);
  check('어느 칸인지는 day/free로만 담긴다', add1 && add1.d, 'day');

  const did = await page.evaluate(() => Log.did);
  const sid = await page.evaluate(() => Log.sid);
  check('기기 ID는 무작위 열여섯 자', /^[a-z0-9]{16}$/.test(did), true);
  check('기기 ID에 메일 주소가 섞이지 않는다', did.includes('@'), false);

  /* 다시 열면 — 기기는 그대로, 방문은 새로.
     다시 연 창은 배포본 그대로 꺼져 있으므로 여기서도 켜고 잰다. */
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => { LOG.enabled = true; Log.start(); });
  await page.waitForTimeout(150);
  check('기기 ID는 다시 열어도 그대로', await page.evaluate(() => Log.did), did);
  check('세션 ID는 열 때마다 새로 난다',
    (await page.evaluate(() => Log.sid)) === sid, false);

  /* 서버가 없어도 앱은 완전히 동작해야 한다 (spec §13).
     받을 자리가 없으면 한 번 두드려 보고 스스로 그만둔다. */
  api.logOff = true;
  await tapCell(4);
  await type(['서버 없이도 적힌다']);
  await page.evaluate(() => Log.flush());
  await page.waitForTimeout(500);
  check('로그가 404여도 적히는 데 지장이 없다',
    await days('fri'), ['서버 없이도 적힌다']);
  check('받을 자리가 없으면 스스로 그만둔다', await page.evaluate(() => Log.off), true);
  check('그만둔 뒤에는 모아 두지도 않는다', await page.evaluate(() => {
    for (let i = 0; i < 50; i++) Log.ev('today');
    return Log.q.length;
  }), 0);
  api.logRaw.length = 0;
  await page.evaluate(() => Log.flush());
  await page.waitForTimeout(300);
  check('그만둔 뒤에는 더 두드리지 않는다', api.logRaw.length, 0);
  /* 404는 브라우저가 남기는 자원 로드 기록이지 앱의 오류가 아니다.
     일부러 없는 곳을 두드려 본 절이므로 여기서만 걷어낸다. */
  for (let i = errors.length - 1; i >= 0; i--)
    if (/404/.test(errors[i])) errors.splice(i, 1);
  api.logOff = false;

  /* 큐가 무한히 자라지 않는다 — 서버가 죽어 있어도 메모리는 안전하다 */
  check('모아 두는 양에 한계가 있다', await page.evaluate(() => {
    Log.off = false;                       // 방금 스스로 껐으므로 되살려서 본다
    for (let i = 0; i < 500; i++) Log.ev('today');
    const n = Log.q.length;
    Log.q.length = 0;
    return n <= LOG.maxQueue;
  }), true);

  await page.evaluate(() => {
    LOG.enabled = false; Log.stop();          // 잰 뒤에는 배포본과 같은 상태로 되돌린다
    App.week.days.thu = []; App.week.days.fri = []; App.save(); App.render();
  });
  await page.waitForTimeout(200);
}

/* 추적을 거부해 둔 브라우저에는 한 줄도 보내지 않는다 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
  });
  const dnt = await ctx.newPage();
  await dnt.goto(`http://127.0.0.1:${PORT}/index.html`);
  await dnt.evaluate(() => { markGuideSeen(); });
  await dnt.reload();
  await dnt.waitForTimeout(400);
  api.logRaw.length = 0;
  /* 켜 두어도 추적 거부가 이긴다 — start()가 아예 물러난다 */
  await dnt.evaluate(() => { LOG.enabled = true; Log.start(); Log.ev('today'); Log.flush(); });
  await dnt.waitForTimeout(300);
  check('추적 거부를 켜면 로그가 꺼진다', await dnt.evaluate(() => Log.off), true);
  check('추적 거부를 켜면 한 줄도 안 보낸다', api.logRaw.length, 0);
  check('그래도 앱은 그대로 쓸 수 있다', await dnt.evaluate(() => !!App.week), true);
  await ctx.close();
}

/* 사파리에만 있는 `interrupted` — 다른 앱이 소리를 가져가거나 화면이 꺼지면
   여기로 빠진다. `suspended`만 보고 깨우면 한 번 끊긴 뒤로 영영 조용하다.
   크로미움은 이 상태를 만들지 않으므로 흉내 낸 상자로 잰다 (spec §4-5). */
{
  const 깨우나 = state => page.evaluate(st => {
    const real = Sound.ctx;
    let called = 0;
    Sound.ctx = { state: st, resume() { called++; return Promise.resolve(); } };
    Sound.resume();
    Sound.ctx = real;
    return called;
  }, state);
  check('suspended면 깨운다', await 깨우나('suspended'), 1);
  check('interrupted면 깨운다 — 사파리가 여기로 빠진다', await 깨우나('interrupted'), 1);
  check('closed여도 두드려는 본다', await 깨우나('closed'), 1);
  check('이미 running이면 건드리지 않는다', await 깨우나('running'), 0);
  check('상자가 없으면 조용히 넘어간다', await page.evaluate(() => {
    const real = Sound.ctx; Sound.ctx = null;
    let threw = false;
    try { Sound.resume(); } catch (e) { threw = true; }
    Sound.ctx = real; return threw;
  }), false);
  /* 한 번 깨웠다고 귀를 떼면 나중에 끊겼을 때 되살릴 사람이 없다 */
  check('깨어난 뒤에도 손짓마다 다시 깨울 채비가 되어 있다', await page.evaluate(() => {
    const real = Sound.resume;
    let called = 0;
    Sound.resume = () => { called++; };
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    Sound.resume = real;
    return called >= 2;
  }), true);
  /* 기기 무음은 무시한다 — 대신 머리말에 끄는 손잡이를 내놓았다 (spec §4-5) */
  check('기기 무음은 무시한다', await page.evaluate(() => SOUND.ignoreSilent), true);
}

/* 머리말의 스피커 — 사람이 앱 안에서 끄고 켠다 */
{
  const 상태 = () => page.evaluate(() => {
    const b = document.getElementById('soundBtn');
    return {
      on: Sound.on, live: Sound.live(), 진하게: b.classList.contains('on'),
      물결: getComputedStyle(b.querySelector('.wave')).display !== 'none',
      가위표: getComputedStyle(b.querySelector('.mute')).display !== 'none',
      말: b.getAttribute('aria-label'),
    };
  });
  /* 글자 없는 표시가 첫 자식이 되면 기준선이 지어져 머리말이 두꺼워진다 */
  check('머리말이 두꺼워지지 않았다', await page.evaluate(() =>
    Math.round(document.querySelector('header').getBoundingClientRect().height) <= 45), true);
  check('스피커는 계정 표시 왼쪽에 있다', await page.evaluate(() => {
    const s = document.getElementById('soundBtn').getBoundingClientRect();
    const a = document.getElementById('acctBtn').getBoundingClientRect();
    return s.right <= a.left + 1;
  }), true);
  check('주 이동 화살표는 날짜 옆으로 옮겼다', await page.evaluate(() => {
    const t = document.getElementById('weekTitle').getBoundingClientRect();
    const n = document.getElementById('next').getBoundingClientRect();
    const a = document.getElementById('acctBtn').getBoundingClientRect();
    return n.left >= t.right - 1 && n.right < a.left - 40;
  }), true);

  check('처음엔 켜져 있다', await 상태(),
    { on: true, live: true, 진하게: true, 물결: true, 가위표: false, 말: '소리 끄기' });
  await page.locator('#soundBtn').click();
  await page.waitForTimeout(200);
  check('누르면 꺼진다 — 표시도 ✕로 바뀐다', await 상태(),
    { on: false, live: false, 진하게: false, 물결: false, 가위표: true, 말: '소리 켜기' });
  check('꺼 두면 기억한다', await page.evaluate(() => localStorage['clearweek:sound']), 'off');

  /* 꺼져 있으면 아무 소리도 만들지 않는다 */
  check('꺼져 있으면 소리 상자를 만들지도 않는다', await page.evaluate(() => {
    const real = Sound.ctx;           // 꺼져 있으면 init()으로는 못 되살린다 — 손에 쥐고 돌려준다
    Sound.ctx = null;
    Sound.init();
    const made = !!Sound.ctx;
    Sound.ctx = real;
    return made;
  }), false);

  /* 껐는데 다음 손짓이 다시 깨우면 재생 갈래를 붙든 채로 남는다 */
  check('꺼 둔 동안에는 손짓이 깨우지 않는다', await page.evaluate(() => {
    const real = Sound.ctx;
    let resumed = 0;
    Sound.ctx = { state: 'suspended', resume() { resumed++; return Promise.resolve(); } };
    Sound.resume();                                    // 곧바로 불러도
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));   // 손짓으로도
    document.dispatchEvent(new Event('touchend', { bubbles: true }));
    Sound.ctx = real;
    return resumed;
  }), 0);

  await page.reload();
  await page.waitForTimeout(500);
  check('새로고침해도 꺼진 채', (await 상태()).on, false);
  await page.locator('#soundBtn').click();
  await page.waitForTimeout(200);
  check('다시 누르면 켜진다', (await 상태()).on, true);
  check('켜면 손짓이 다시 깨운다', await page.evaluate(() => {
    const real = Sound.ctx;
    let resumed = 0;
    Sound.ctx = { state: 'suspended', resume() { resumed++; return Promise.resolve(); } };
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    Sound.ctx = real;
    return resumed;
  }), 1);
  /* 켠 순간의 톡은 깨어난 뒤에 나야 한다 — 사파리는 곧바로 running이 아니다 */
  check('켜기는 깨어남을 기다릴 약속을 돌려준다', await page.evaluate(() =>
    typeof Sound.setOn(true).then === 'function'), true);
  check('켜면 기억도 바뀐다', await page.evaluate(() => localStorage['clearweek:sound']), 'on');
}

console.log('\n── 펜으로 바로 쓰기 ──');
/* 아이패드 손글씨 변환은 **텍스트 입력창 위에서만** 돈다. 탭해서 입력창을
   만든 다음에 쓰라고 하면 손이 한 번 더 간다 — 그래서 칸마다 투명한 입력창을
   **미리 깔아 둔다.** 펜을 대는 순간 이미 거기 있다 (spec §4-7). */
{
  const cdp = await page.context().newCDPSession(page);
  const penTap = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', clickCount: 1, pointerType: 'pen',
        force: type === 'mousePressed' ? 0.5 : 0,
      });
    }
    await page.waitForTimeout(300);
  };
  const emptySpot = key => page.evaluate(k => {
    const r = App.cells[k].listEl.getBoundingClientRect();
    return { x: r.x + r.width * 0.4, y: r.y + r.height - 14 };
  }, key);
  const awake = key => page.evaluate(k => App.cells[k].layer.classList.contains('on'), key);
  const texts = key => page.evaluate(k => App.week.days[k].map(i => i.text), key);
  const clear = async () => {
    await page.evaluate(() => {
      DAY_KEYS.forEach(k => { App.week.days[k] = []; });
      App.week.graves = {}; App.save(); App.render();
    });
    await page.waitForTimeout(300);
  };

  await clear();

  check('칸마다 판이 깔려 있다', await page.evaluate(() =>
    DAY_KEYS.filter(k => !App.cells[k].layer).length), 0);
  check('평소에는 보이지 않는다', await page.evaluate(() => {
    const c = getComputedStyle(App.cells.thu.layer);
    return [c.color, c.caretColor, parseFloat(c.fontSize) <= 2];
  }), ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', true]);
  /* 자판을 부르지 않는다 — 잘못 눌려도 화면이 덜컹거리지 않게 */
  check('잠든 판은 자판을 부르지 않는다', await page.evaluate(() =>
    App.cells.thu.layer.inputMode), 'none');

  /* 판은 **적히는 자리**를 덮는다. 날짜 여백은 덮지 않는다 */
  check('판이 적히는 자리를 덮는다', await page.evaluate(() => {
    const l = App.cells.thu.layer.getBoundingClientRect();
    const b = App.cells.thu.listEl.getBoundingClientRect();
    const g = App.cells.thu.gutter.getBoundingClientRect();
    return [Math.abs(l.left - b.left) < 2, Math.abs(l.width - b.width) < 2,
            Math.abs(l.height - b.height) < 2, l.left >= g.right - 1];
  }), [true, true, true, true]);

  /* 항목보다 아래에 깔린다 — 글자 위는 여전히 긋기의 자리다 */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.thu = [{ id: 'z1', text: '글자 위', struck: false,
      createdAt: now, updatedAt: now, strikes: [] }];
    App.save(); App.render();
  });
  await page.waitForTimeout(300);
  check('글자 위를 짚으면 판이 아니라 항목이 잡힌다', await page.evaluate(() => {
    const t = App.cells.thu.items[0].textEl.getBoundingClientRect();
    const el = document.elementFromPoint(t.x + t.width / 2, t.y + t.height / 2);
    return !!(el && el.closest('.item'));
  }), true);
  check('빈 곳을 짚으면 판이 잡힌다', await page.evaluate(() => {
    const r = App.cells.thu.listEl.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width * 0.4, r.bottom - 14);
    return !!(el && el.classList.contains('pad-layer'));
  }), true);
  await clear();

  /* **여기가 이 절의 핵심이다.** 스크리블은 포인터 없이 포커스만 준다 —
     탭이 없어도 깨어나야 "그냥 바로 쓰는" 것이 된다. */
  await page.evaluate(() => App.cells.thu.layer.focus());
  await page.waitForTimeout(250);
  check('탭 없이 포커스만 와도 깨어난다 (스크리블)', await awake('thu'), true);
  check('깨어나면 글자가 커진다', await page.evaluate(() =>
    parseFloat(getComputedStyle(App.cells.thu.layer).fontSize) >= 20), true);
  check('깨어나면 자판도 부를 수 있다', await page.evaluate(() =>
    App.cells.thu.layer.inputMode), 'text');
  check('그때 작은 줄은 안 열린다', await page.locator('.entry').count(), 0);

  await page.keyboard.type('매트하이브');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('엔터로 그 요일에 항목이 된다', await texts('thu'), ['매트하이브']);
  check('엔터 뒤에도 깨어 있다 — 이어서 쓴다', await awake('thu'), true);
  check('적은 것은 보통 크기로 남는다', await page.evaluate(() =>
    parseFloat(getComputedStyle(App.cells.thu.items[0].textEl).fontSize) < 20), true);
  await page.keyboard.type('두 번째');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check('이어서 쓴 것도 들어간다', await texts('thu'), ['매트하이브', '두 번째']);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('빈 채로 엔터를 치면 잠든다', await awake('thu'), false);
  check('잠들면 자판도 다시 안 부른다', await page.evaluate(() =>
    App.cells.thu.layer.inputMode), 'none');

  /* 펜으로 톡 눌러도 같은 자리로 들어온다 */
  let at = await emptySpot('fri');
  await penTap(at.x, at.y);
  check('펜으로 눌러도 깨어난다', await awake('fri'), true);
  await page.keyboard.type('펜으로 톡');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(350);
  check('딴 데를 누르면 적은 것이 남고 잠든다',
    [await texts('fri'), await awake('fri')], [['펜으로 톡'], false]);

  /* 손가락은 예전 그대로 — 판이 깔려 있어도 작은 줄이 열려야 한다 */
  at = await emptySpot('sun');
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(350);
  check('손가락으로 누르면 판이 안 깨어난다', await awake('sun'), false);
  check('손가락은 예전처럼 작은 줄이 열린다', await page.locator('.entry').count(), 1);
  await page.keyboard.type('손가락으로 적음');
  await page.keyboard.press('Enter');
  await page.locator('#weekTitle').click();
  await page.waitForTimeout(300);
  check('손가락으로 적은 것도 들어간다', await texts('sun'), ['손가락으로 적음']);

  /* note 칸도 같다 */
  await page.evaluate(() => App.cells.free.layer.focus());
  await page.waitForTimeout(250);
  check('note 칸에도 판이 깔려 있다', await awake('free'), true);
  await page.keyboard.type('노트에 크게');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('note에 들어간다', await texts('free'), ['노트에 크게']);

  /* 판은 항목이 아니다 — 세는 곳에 끼어들면 안 된다 */
  check('판은 항목으로 세어지지 않는다', await page.evaluate(() =>
    [document.querySelectorAll('.pad-layer.entry').length,
     document.querySelectorAll('.pad-layer.item').length,
     App.cells.thu.listEl.contains(App.cells.thu.layer)]), [0, 0, false]);

  await cdp.detach();
  await clear();
}

console.log('\n── 캘린더 연결 ──');
/* 같은 사람이 만든 다른 웹앱(Dada Calendar)과 **새로 적은 일정만** 오간다 (spec §15).
   저쪽은 Firebase다. 여기서는 그 REST 세 곳을 가로채 흉내 낸다 —
   진짜 프로젝트 없이도 오가는 모양과 규칙을 전부 잴 수 있다. */
{
  const cal = { entries: new Map(), created: [], queries: [], token: 0, refreshed: 0, fail: null };
  const doc = (id, f) => ({ name: 'projects/p/databases/(default)/documents/users/u1/entries/' + id,
                            fields: f });
  /* 이 앱이 보내는 모양 그대로 되읽는다 — 타입 표기를 진짜처럼 벗긴다 */
  const unwrap = v => {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrap);
    if ('mapValue' in v) return plain(v.mapValue.fields || {});
    return null;
  };
  const plain = f => Object.fromEntries(Object.keys(f).map(k => [k, unwrap(f[k])]));
  const wrap = v => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return { integerValue: String(v) };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(wrap) } };
    return { mapValue: { fields: Object.fromEntries(Object.keys(v).map(k => [k, wrap(v[k])])) } };
  };
  const seed = (id, over = {}) => cal.entries.set(id, Object.assign({
    kind: 'task', title: '', color: 'blue', tags: [], note: '', location: '',
    startDate: '', startTime: null, endDate: null, endTime: null,
    recurrence: null, ymSpan: [], isRecurring: false,
    task: { status: 'planned', important: false, urgent: false, order: 0 },
    money: null, createdAt: '', updatedAt: '',
  }, over));

  const json = (route, body, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' },
  });

  await page.route('https://identitytoolkit.googleapis.com/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.password !== 'good') return json(route, { error: { message: 'INVALID_PASSWORD' } }, 400);
    return json(route, { localId: 'u1', email: body.email,
                         idToken: 'tok0', refreshToken: 'ref0', expiresIn: '3600' });
  });
  await page.route('https://securetoken.googleapis.com/**', async route => {
    cal.refreshed++;
    return json(route, { id_token: 'tok' + (++cal.token), refresh_token: 'ref0' });
  });
  await page.route('https://firestore.googleapis.com/**', async route => {
    const url = route.request().url();
    const body = JSON.parse(route.request().postData() || '{}');
    if (cal.fail) { const s = cal.fail; cal.fail = null; return json(route, { error: { message: 'nope' } }, s); }

    if (url.includes(':runQuery')) {
      const want = body.structuredQuery.where.fieldFilter.value.arrayValue.values.map(v => v.stringValue);
      cal.queries.push({ want, auth: route.request().headers().authorization || '' });
      const out = [];
      for (const [id, f] of cal.entries) {
        if ((f.ymSpan || []).some(m => want.includes(m))) out.push({ document: doc(id, Object.fromEntries(Object.keys(f).map(k => [k, wrap(f[k])]))) });
      }
      return json(route, out.length ? out : [{ readTime: 'x' }]);
    }
    const m = /documentId=([^&]+)/.exec(url);
    const id = m ? decodeURIComponent(m[1]) : '?';
    if (cal.entries.has(id)) {
      return json(route, { error: { message: 'ALREADY_EXISTS: ' + id, status: 'ALREADY_EXISTS' } }, 409);
    }
    const f = plain(body.fields || {});
    cal.entries.set(id, f);
    cal.created.push({ id, f });
    return json(route, { name: 'projects/p/databases/(default)/documents/users/u1/entries/' + id });
  });

  const wipeWeek = () => page.evaluate(() => {
    DAY_KEYS.forEach(k => { App.week.days[k] = []; App.week.notes[k] = ''; });
    App.week.graves = {};
    App.save(); App.render();
  });
  /* 이 주 월요일 기준 날짜 — 검사는 실제로 도는 날에 맞춰 스스로 계산한다 */
  const isoOf = key => page.evaluate(k => dayDateISO(App.monday, k), key);
  const dayTexts = key => page.evaluate(k => App.week.days[k].map(i => i.text), key);
  const settle = () => page.evaluate(() => Cal.run());

  /* 설정이 없으면 이 기능은 없는 것이다 (spec §13과 같은 규칙) */
  await page.locator('#acctBtn').click();
  await page.waitForTimeout(250);
  check('설정이 없으면 캘린더 줄이 아예 없다', await page.evaluate(() =>
    [document.getElementById('calRow').hidden, document.getElementById('calAuthRow').hidden]),
    [true, true]);

  await page.evaluate(() => { CAL.apiKey = 'test-key'; CAL.projectId = 'test-proj'; App.renderCal(); });
  await page.waitForTimeout(150);
  check('설정이 있으면 캘린더 줄이 나타난다', await page.evaluate(() =>
    document.getElementById('calRow').hidden), false);
  check('잇기 전 안내', await page.evaluate(() =>
    document.getElementById('calMsg').textContent), '이으면 새로 적은 일정이 오갑니다');

  /* 틀린 비밀번호는 사람 말로 알린다 — 조용히 실패하지 않는다 */
  await page.locator('#calBtn').click();
  await page.locator('#calEmail').fill('me@example.com');
  await page.locator('#calPw').fill('nope');
  await page.locator('#calGo').click();
  await page.waitForTimeout(400);
  check('틀린 비밀번호는 사람 말로', await page.evaluate(() =>
    document.getElementById('calMsg').textContent), '비밀번호가 다릅니다');
  check('그때 이어지지 않는다', await page.evaluate(() => Cal.linked()), false);

  /* 이 주에 있는 캘린더 항목들을 심어 둔다 */
  await wipeWeek();
  const tueISO = await isoOf('tue');
  const wedISO = await isoOf('wed');
  await page.evaluate(() => { App.week.days.mon = []; App.save(); });
  seed('e-real', { title: '캘린더에서 적음', startDate: tueISO, ymSpan: [tueISO.slice(0, 7)] });
  seed('e-done', { title: '이미 끝낸 일', startDate: tueISO, ymSpan: [tueISO.slice(0, 7)],
                   task: { status: 'done', important: false, urgent: false, order: 0 } });
  seed('e-idea', { kind: 'idea', title: '아이디어 단문', startDate: wedISO, ymSpan: [wedISO.slice(0, 7)] });
  seed('e-money', { kind: 'money', title: '월세', startDate: wedISO, ymSpan: [wedISO.slice(0, 7)] });
  seed('e-rep', { title: '매주 회의', startDate: wedISO, ymSpan: [wedISO.slice(0, 7)], isRecurring: true,
                  recurrence: { freq: 'weekly', interval: 1, until: null, count: null } });

  /* Clear Week 쪽에도 하나 적어 둔다 — 양방향을 한 번에 잰다 */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.mon = [{ id: 'a1', text: 'Clear Week에서 적음', struck: false,
      createdAt: now, updatedAt: now, strikes: [] }];
    App.save(); App.render();
  });
  await page.waitForTimeout(250);

  await page.locator('#calPw').fill('good');
  await page.locator('#calGo').click();
  await page.waitForFunction(() => Cal.linked(), null, { timeout: 5000 });
  await page.waitForTimeout(700);
  check('이으면 주소가 잡힌다', await page.evaluate(() => [Cal.linked(), Cal.email]),
    [true, 'me@example.com']);

  check('캘린더의 할 일이 그 요일에 생긴다', await dayTexts('tue'), ['캘린더에서 적음']);
  check('끝낸 일·아이디어·가계부·반복은 안 온다', await dayTexts('wed'), []);
  check('Clear Week에서 적은 것이 캘린더에 생긴다',
    cal.created.map(c => [c.id, c.f.title, c.f.startDate]),
    [['cw-a1', 'Clear Week에서 적음', await isoOf('mon')]]);
  check('저쪽 규칙이 요구하는 자리를 다 채운다', (() => {
    const f = cal.created[0].f;
    return [f.kind, f.isRecurring, Array.isArray(f.tags), Array.isArray(f.ymSpan),
            f.ymSpan[0], f.task.status, f.money, f.endDate];
  })(), ['task', false, true, true, (await isoOf('mon')).slice(0, 7), 'planned', null, null]);
  check('그 주가 걸친 달만 묻는다', cal.queries[0].want,
    Array.from(new Set([await isoOf('mon'), await isoOf('sun')].map(d => d.slice(0, 7)))));
  check('토큰을 달고 묻는다', /^Bearer /.test(cal.queries[0].auth), true);

  /* 몇 번을 맞춰도 같은 것이 두 번 생기지 않는다 — id를 서로에게서 유도하기 때문 */
  const madeOnce = cal.created.length;
  await settle(); await settle();
  await page.waitForTimeout(300);
  check('두 번 맞춰도 캘린더에 두 번 안 생긴다', cal.created.length, madeOnce);
  check('두 번 맞춰도 Clear Week에 두 번 안 생긴다', await dayTexts('tue'), ['캘린더에서 적음']);
  check('저쪽에서 온 것은 되돌려 보내지 않는다',
    cal.created.some(c => c.id.startsWith('cw-dc-')), false);

  /* 지운 것은 되살아나지 않는다 — 무덤이 그래서 있다 */
  await page.evaluate(() => {
    const it = App.cells.tue.items.find(i => String(i.data.id).startsWith('dc-'));
    App.removeItem(it, 'tue');
  });
  await page.waitForTimeout(250);
  await settle();
  await page.waitForTimeout(300);
  check('Clear Week에서 지운 것은 다시 안 생긴다', await dayTexts('tue'), []);

  /* 그어진 것은 안 보낸다 — 끝난 일을 저쪽에 "할 일"로 새로 만들 이유가 없다.
     이게 없으면 지난 주를 열어 보기만 해도 다 끝낸 일이 우수수 생긴다. */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.thu = [{ id: 'struck1', text: '이미 그은 것', struck: true,
      createdAt: now, updatedAt: now, strikes: [{ line: 0, a: 0, b: 1, seed: 1 }] }];
    App.save(); App.render();
  });
  await page.waitForTimeout(250);
  await settle(); await page.waitForTimeout(300);
  check('그어진 항목은 캘린더로 안 간다',
    cal.created.some(c => c.id === 'cw-struck1'), false);

  /* note 칸은 날짜가 없어서 갈 곳이 없다 */
  await page.evaluate(() => {
    const now = Date.now();
    App.week.days.free = [{ id: 'free1', text: '날짜 없는 것', struck: false,
      createdAt: now, updatedAt: now, strikes: [] }];
    App.save(); App.render();
  });
  await page.waitForTimeout(250);
  await settle(); await page.waitForTimeout(300);
  check('note 칸은 캘린더로 안 간다', cal.created.some(c => c.id === 'cw-free1'), false);

  /* 토큰은 저장하지 않는다 — 저장하는 것은 refresh 하나뿐 */
  check('짧은 토큰은 저장하지 않는다', await page.evaluate(() => {
    const raw = JSON.parse(localStorage['clearweek:cal']);
    return [Object.keys(raw).sort(), raw.uid];
  }), [['email', 'refresh', 'uid'], 'u1']);

  /* 닿지 못하면 조용히 실패하지 않는다 */
  cal.fail = 500;
  await settle(); await page.waitForTimeout(300);
  check('닿지 못하면 알린다', await page.evaluate(() =>
    document.getElementById('calMsg').textContent), '캘린더에 닿지 못했습니다');
  check('그래도 이어진 채로 둔다', await page.evaluate(() => Cal.linked()), true);

  /* 토큰이 죽었으면 끊고 알린다 — 조용히 안 되는 채로 두지 않는다 */
  cal.fail = 401;
  await settle(); await page.waitForTimeout(300);
  check('토큰이 죽으면 끊고 알린다', await page.evaluate(() =>
    [Cal.linked(), document.getElementById('calMsg').textContent]),
    [false, '다시 연결해 주세요']);

  /* 일부러 거절받아 본 절이다 — 400(틀린 비밀번호)·409(이미 있음)·500·401은
     브라우저가 남기는 자원 로드 기록이지 앱의 오류가 아니다. **여기서만** 걷어낸다.
     `Failed to load resource`가 아닌 진짜 오류는 그대로 남아 아래에서 걸린다. */
  for (let i = errors.length - 1; i >= 0; i--) {
    if (/^Failed to load resource.* status of (400|401|409|500)\b/.test(errors[i])) errors.splice(i, 1);
  }

  /* 연결을 끊으면 이 기기 기록은 그대로 둔다 */
  await page.evaluate(() => { CAL.apiKey = ''; CAL.projectId = ''; App.renderCal(); });
  await page.evaluate(() => { DAY_KEYS.forEach(k => { App.week.days[k] = []; }); App.week.graves = {}; App.save(); App.render(); });
  await page.locator('#acctClose').click();
  await page.waitForTimeout(250);
}

console.log('\n── 확대 차단 ──');
check('확대 제스처 preventDefault', await page.evaluate(() =>
  ['gesturestart', 'gesturechange', 'gestureend'].every(t => {
    const e = new Event(t, { cancelable: true, bubbles: true });
    document.dispatchEvent(e); return e.defaultPrevented;
  })), true);
check('문서 touch-action: none', await page.evaluate(() =>
  getComputedStyle(document.body).touchAction), 'none');

check('콘솔 오류 없음', errors, []);

await browser.close();
server.close();
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
