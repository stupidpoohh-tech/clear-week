/*
 * Clear Week — 행동로그 문지기 검사
 *
 *   node tests/log.mjs
 *
 * 이 검사가 지키는 것은 하나다: **적은 글자는 절대 나가지 않는다.**
 * 나머지는 그 선을 지키기 위한 곁가지다. 브라우저는 필요 없다.
 */
import {
  sanitizeEvent, sanitizeBatch, toDataPoint, platformOf,
  LOG_EVENTS, LOG_DETAILS, LOG_MAX_BATCH,
} from '../functions/_log.js';
/* 받는 곳도 함께 본다 — 문지기만 성해도 문이 잘못 대답하면 소용없다 */
import { onRequestPost } from '../functions/api/log.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` +
    (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

const ev = (over = {}) => ({
  ev: 'add', d: 'day', did: 'a1b2c3d4e5f60718', sid: '00112233445566aa',
  n1: 5, n2: 2, w: 390, h: 760, signed: 0, ...over,
});

console.log('\n── 적은 글자는 나가지 않는다 ──');
/* 이 검사가 이 파일의 존재 이유다. 클라이언트가 실수로 실어 보내도
   화이트리스트 밖의 자리는 통째로 사라져야 한다. */
{
  const dirty = sanitizeEvent({
    ...ev(),
    text: '치과 예약 14:00',            // 항목 글자
    email: 'someone@example.com',
    note: '8/20 마감',
    d: '치과 예약 14:00',               // detail 자리에 밀어 넣어도
  });
  check('모르는 자리는 통째로 사라진다', Object.keys(dirty).sort(),
    ['d', 'did', 'ev', 'h', 'n1', 'n2', 'sid', 'signed', 'w']);
  check('detail에 넣은 글자는 버려진다', dirty.d, '');
  check('통과한 값에 글자가 하나도 없다',
    JSON.stringify(dirty).includes('치과') || JSON.stringify(dirty).includes('@'), false);
}
check('데이터포인트에도 남지 않는다', JSON.stringify(
  toDataPoint(sanitizeEvent({ ...ev(), d: '치과 예약' }), { country: 'kr', platform: 'ios' })
).includes('치과'), false);

console.log('\n── 이벤트 이름 ──');
check('모르는 이름은 버린다', sanitizeEvent({ ...ev(), ev: 'keystroke' }), null);
check('이름이 없으면 버린다', sanitizeEvent({ d: 'day' }), null);
check('이벤트가 아니면 버린다', [sanitizeEvent(null), sanitizeEvent('add'), sanitizeEvent(42)],
  [null, null, null]);
/* 프로토타입에서 물려받은 이름을 이벤트로 착각하면 안 된다 */
check('물려받은 이름은 이벤트가 아니다',
  [sanitizeEvent({ ev: 'toString' }), sanitizeEvent({ ev: 'constructor' })], [null, null]);
check('아는 이름은 전부 통과한다',
  Object.keys(LOG_EVENTS).filter(k => !sanitizeEvent({ ...ev(), ev: k, d: '' })), []);

console.log('\n── detail은 목록에 있는 값만 ──');
check('허용된 값은 지킨다', sanitizeEvent({ ...ev(), ev: 'week', d: 'prev' }).d, 'prev');
check('다른 이벤트의 값은 안 된다', sanitizeEvent({ ...ev(), ev: 'week', d: 'free' }).d, '');
check('목록이 없는 이벤트는 늘 빈 값', sanitizeEvent({ ...ev(), ev: 'today', d: 'prev' }).d, '');
check('detail 목록은 전부 아는 이벤트의 것',
  Object.keys(LOG_DETAILS).filter(k => !Object.hasOwn(LOG_EVENTS, k)), []);

console.log('\n── 숫자 ──');
check('NaN·Infinity는 0이 된다',
  [sanitizeEvent({ ...ev(), n1: NaN }).n1, sanitizeEvent({ ...ev(), n2: Infinity }).n2], [0, 0]);
check('터무니없는 값은 잘린다', sanitizeEvent({ ...ev(), n1: 1e300 }).n1, 100000);
check('음수도 잘린다', sanitizeEvent({ ...ev(), n1: -1e300 }).n1, -100000);
check('소수는 정수로', sanitizeEvent({ ...ev(), n1: 3.7 }).n1, 4);
check('숫자가 아니면 0', sanitizeEvent({ ...ev(), n1: '치과' }).n1, 0);
check('화면 크기도 잘린다', sanitizeEvent({ ...ev(), w: 999999 }).w, 20000);

console.log('\n── 기기·세션 ID ──');
check('모양이 맞으면 지킨다', sanitizeEvent(ev()).did, 'a1b2c3d4e5f60718');
check('짧으면 버린다', sanitizeEvent({ ...ev(), did: 'abc' }).did, '');
check('대문자·기호는 버린다',
  [sanitizeEvent({ ...ev(), did: 'ABCDEF0123456789' }).did,
   sanitizeEvent({ ...ev(), did: 'a1b2-c3d4-e5f6' }).did], ['', '']);
/* 메일 주소를 ID 자리에 넣어도 통과하지 못한다 */
check('메일 주소는 ID가 아니다', sanitizeEvent({ ...ev(), did: 'me@example.com' }).did, '');
check('너무 길면 버린다', sanitizeEvent({ ...ev(), did: 'a'.repeat(64) }).did, '');
check('로그인 여부는 0 또는 1',
  [sanitizeEvent({ ...ev(), signed: 'yes' }).signed, sanitizeEvent({ ...ev(), signed: 0 }).signed],
  [1, 0]);

console.log('\n── 묶음 ──');
check('빈 몸통은 빈 묶음', [sanitizeBatch(null).length, sanitizeBatch({}).length], [0, 0]);
check('events가 배열이 아니면 빈 묶음', sanitizeBatch({ events: 'add' }).length, 0);
check('나쁜 것만 골라 버린다',
  sanitizeBatch({ events: [ev(), { ev: 'nope' }, null, ev()] }).length, 2);
check(`한 번에 ${LOG_MAX_BATCH}개까지만 받는다`,
  sanitizeBatch({ events: Array.from({ length: 500 }, () => ev()) }).length, LOG_MAX_BATCH);

console.log('\n── 데이터포인트 ──');
{
  const dp = toDataPoint(sanitizeEvent(ev()), { country: 'kr', platform: 'ios' });
  check('index는 이벤트 이름 하나', dp.indexes, ['add']);
  check('blob 스무 개를 넘지 않는다', dp.blobs.length <= 20, true);
  check('double 스무 개를 넘지 않는다', dp.doubles.length <= 20, true);
  check('나라와 갈래가 담긴다', [dp.blobs[5], dp.blobs[6]], ['kr', 'ios']);
  check('세는 값 1이 맨 앞', dp.doubles[0], 1);
  check('짐작할 수 없으면 xx/other', toDataPoint(sanitizeEvent(ev()), {}).blobs.slice(5),
    ['xx', 'other']);
}

console.log('\n── 브라우저 갈래는 다섯으로만 ──');
check('아이폰', platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), 'ios');
check('아이패드', platformOf('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)'), 'ios');
check('안드로이드', platformOf('Mozilla/5.0 (Linux; Android 14; Pixel 8)'), 'android');
check('맥', platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
check('윈도우', platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win');
check('모르면 other', [platformOf(''), platformOf(null), platformOf('curl/8.4')],
  ['other', 'other', 'other']);
/* 브라우저 문자열을 통째로 담으면 그것만으로 지문이 된다 */
check('원래 문자열은 남지 않는다',
  platformOf('Mozilla/5.0 (iPhone) 아주 긴 고유 문자열').length < 10, true);

console.log('\n── 받는 곳 ──');
{
  const fakeReq = events => ({
    json: async () => ({ events }),
    cf: { country: 'KR' },
    headers: { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)' },
  });

  /* 데이터셋을 안 묶었으면 성공이라고 대답하면 안 된다.
     204를 주면 클라이언트가 5초마다 영원히 보내고 서버는 전부 버린다. */
  const noBinding = await onRequestPost({ request: fakeReq([ev()]), env: {} });
  check('바인딩이 없으면 501 — 클라이언트가 그만둘 수 있게', noBinding.status, 501);

  const written = [];
  const env = { CLEARWEEK_LOG: { writeDataPoint: d => written.push(d) } };
  const ok = await onRequestPost({ request: fakeReq([ev(), ev({ ev: 'strike', d: '' })]), env });
  check('묶여 있으면 204', ok.status, 204);
  check('받은 만큼 적는다', written.length, 2);
  check('나라와 갈래를 요청에서 채운다', [written[0].blobs[5], written[0].blobs[6]], ['kr', 'ios']);

  written.length = 0;
  const junk = await onRequestPost({ request: fakeReq([{ ev: 'nope', text: '치과' }]), env });
  check('모르는 이벤트만 오면 아무것도 안 적는다', [junk.status, written.length], [204, 0]);

  const broken = await onRequestPost({
    request: { json: async () => { throw new Error('bad json'); }, cf: {}, headers: { get: () => '' } }, env });
  check('몸통이 깨져도 조용히 204', broken.status, 204);

  /* 로그가 앱을 멈추는 일은 없어야 한다 — 쓰다가 터져도 응답은 나간다 */
  const boom = { CLEARWEEK_LOG: { writeDataPoint: () => { throw new Error('boom'); } } };
  const survived = await onRequestPost({ request: fakeReq([ev()]), env: boom });
  check('적다가 터져도 응답은 나간다', survived.status, 204);
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
