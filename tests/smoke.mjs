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
              log: [], logRaw: [], logOff: false };
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

async function tapLabel(i) {
  const b = await cell(i).locator('.cell-label').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
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
/* 버튼이 하나도 없는 화면이라 첫 단서가 필요하다. 단, 한 번 거절하면 다시 안 뜬다 */
check('첫 실행에 안내가 뜬다', await page.locator('#guide').isVisible(), true);
check('설명은 다섯 마디', await page.locator('.guide-hint').count(), 5);
check('설명이 서로 겹치지 않는다', await page.evaluate(() => {
  const rs = Array.from(document.querySelectorAll('.guide-hint')).map(e => e.getBoundingClientRect());
  let hit = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hit++;
  }
  return hit;
}), 0);
check('설명이 요일 열을 넘지 않는다', await page.evaluate(() => {
  const right = document.querySelector('.days').getBoundingClientRect().right;
  return Array.from(document.querySelectorAll('.guide-hint'))
    .filter(e => e.getBoundingClientRect().right > right + 1).length;
}), 0);
check('표본 주가 그려진다', await page.evaluate(() => App.week.days.thu.map(i => i.text)),
  ['낭만백수달', '영상편집']);
check('표본은 저장하지 않는다', await page.evaluate(() =>
  localStorage.getItem('clearweek:' + App.week.weekId)), null);
check('셀로판지가 주간 표를 덮는다', await page.evaluate(() => {
  const s = document.getElementById('guideSheet').getBoundingClientRect();
  const b = document.getElementById('weekBody').getBoundingClientRect();
  return s.left <= b.left && s.right >= b.right && s.top <= b.top && s.height > 100;
}), true);
check('모서리가 접혀 있다', await page.evaluate(() =>
  (document.querySelector('#guideSheet .flap').getAttribute('d') || '').length > 10), true);
await page.mouse.click(195, 120);
await page.waitForTimeout(200);
check('아무 데나 누르면 닫힌다', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('닫기만 했으면 다음에 다시 뜬다', await page.locator('#guide').isVisible(), true);
await page.locator('#guideNever').click();
await page.waitForTimeout(200);
check('다시 보지 않기 — 그 자리에서 닫힘', await page.locator('#guide').isVisible(), false);
await page.reload(); await page.waitForTimeout(400);
check('다시 보지 않기 — 새로고침해도 안 뜸', await page.locator('#guide').isVisible(), false);
check('닫으면 표본이 사라진다', await page.evaluate(() =>
  Object.values(App.week.days).reduce((n, a) => n + a.length, 0)), 0);

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
await tapLabel(3);
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
{
  const it = await cell(5).locator('.item').first().boundingBox();
  await page.mouse.click(it.x + 10, it.y + it.height / 2);
  await page.waitForTimeout(450);
  check('항목 위를 누른 것은 편집이지 새 항목이 아니다',
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
  await tapLabel(6);
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

console.log('\n── 편집 · 삭제 ──');
await cell(3).locator('.item').nth(1).click();
await page.waitForTimeout(420);
await page.locator('.entry').fill('웨비나 참석');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('탭 편집 — 자리 유지', await days('thu'), ['멜팅의원', '웨비나 참석', '낭만백수달']);

await cell(3).locator('.item').nth(1).click();
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
check('다음 주도 편집 가능', await page.locator('.cell-label').first().evaluate(e => e.tagName), 'BUTTON');
await page.locator('#prev').click(); await page.locator('#prev').click(); await page.waitForTimeout(300);
check('지난 주도 편집 가능', await page.locator('.cell-label').first().evaluate(e => e.tagName), 'BUTTON');
await tapLabel(0);
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
await page.mouse.click(195, 700);
await page.waitForTimeout(200);

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
await tapLabel(0);
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

  const lb = await touch.locator('.days .cell').nth(0).locator('.cell-label').boundingBox();
  await touch.touchscreen.tap(lb.x + lb.width / 2, lb.y + lb.height / 2);
  await touch.waitForTimeout(350);
  check('터치로 라벨을 눌러도 입력창이 열린다', await touch.locator('.entry').count(), 1);
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
  await tapLabel(6);
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
  await tapLabel(3);
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

  /* 다시 열면 — 기기는 그대로, 방문은 새로 */
  await page.reload();
  await page.waitForTimeout(400);
  check('기기 ID는 다시 열어도 그대로', await page.evaluate(() => Log.did), did);
  check('세션 ID는 열 때마다 새로 난다',
    (await page.evaluate(() => Log.sid)) === sid, false);

  /* 서버가 없어도 앱은 완전히 동작해야 한다 (spec §13).
     받을 자리가 없으면 한 번 두드려 보고 스스로 그만둔다. */
  api.logOff = true;
  await tapLabel(4);
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

  await page.evaluate(() => { App.week.days.thu = []; App.week.days.fri = []; App.save(); App.render(); });
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
  await dnt.evaluate(() => { Log.ev('today'); Log.flush(); });
  await dnt.waitForTimeout(300);
  check('추적 거부를 켜면 로그가 꺼진다', await dnt.evaluate(() => Log.off), true);
  check('추적 거부를 켜면 한 줄도 안 보낸다', api.logRaw.length, 0);
  check('그래도 앱은 그대로 쓸 수 있다', await dnt.evaluate(() => !!App.week), true);
  await ctx.close();
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
