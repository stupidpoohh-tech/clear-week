/*
 * 말 (P1-3) — **양쪽에 같은 열쇠가 있어야 한다.**
 * 하나가 빠지면 그 자리만 영어로 튀어나오는데, 검사가 없으면 아무도 모른다.
 */
import { check, ok, done } from './_harness.mjs';
import { t, setLocale, pick, getLang, rangeLabel, dayInitial, PACKS } from '../src/i18n/index.js';

const ko = Object.keys(PACKS.ko), en = Object.keys(PACKS.en);

console.log('\n── 열쇠 ──');
check('한국어에만 있는 것', ko.filter(k => !en.includes(k)), []);
check('영어에만 있는 것', en.filter(k => !ko.includes(k)), []);
ok('말이 비어 있지 않다', ko.length > 40);
ok('빈 값이 없다', [...ko].every(k => PACKS.ko[k] && PACKS.en[k]));

console.log('\n── 기기 말 고르기 ──');
check('ko-KR은 한국어', pick(['ko-KR']), 'ko');
check('en-GB는 영어', pick(['en-GB']), 'en');
check('모르는 말은 영어로 떨어진다', pick(['fr-FR']), 'en');
check('첫 번째로 아는 말을 고른다', pick(['fr-FR', 'ko-KR', 'en']), 'ko');
check('빈 것도 영어로', pick([]), 'en');

console.log('\n── 꺼내기 ──');
setLocale(['ko-KR']);
check('지금 말', getLang(), 'ko');
check('자리를 채운다', t('verify.tooSoon', { sec: 42 }).includes('42'), true);
check('없는 열쇠는 열쇠를 그대로 — 화면이 비지 않게', t('없는.열쇠'), '없는.열쇠');
const koLine = t('account.title');
setLocale(['en-US']);
ok('말을 바꾸면 글도 바뀐다', t('account.title') !== koLine);

console.log('\n── 날짜와 요일 ──');
const monday = new Date(2026, 8, 14);       // 2026-09-14 월요일
setLocale(['ko-KR']);
check('한국어 날짜', rangeLabel(monday), '2026. 9.14-9.20');
check('한국어 요일', dayInitial(new Date(2026, 8, 15)), '화');
setLocale(['en-US']);
check('영어 날짜', rangeLabel(monday), '9/14–9/20, 2026');
check('영어 요일', dayInitial(new Date(2026, 8, 15)), 'T');
ok('해를 넘겨도 만들어진다', !!rangeLabel(new Date(2026, 11, 28)));

/* 검사 뒤에는 한국어로 돌려 둔다 — 뒤따르는 검사가 영향을 받지 않게 */
setLocale(['ko-KR']);
done('말');
