/*
 * 구매 (P1-4) — **한 번 내고 소장한다.**
 * 스토어가 돌려주는 모양은 조금씩 다르고, 오류는 취소와 섞여 온다.
 * 여기서 보는 것은 그 둘을 우리가 어떻게 읽느냐다.
 */
import { check, ok, done } from './_harness.mjs';
import {
  PRODUCT_ID, GATE, ownsProduct, isLocked, outcomeOf, MESSAGE,
} from '../src/core/entitlement.js';

console.log('\n── 샀는가 ──');
ok('빈 목록은 산 것이 아니다', !ownsProduct([]));
ok('모양이 아닌 것도 견딘다', !ownsProduct(null) && !ownsProduct([null, undefined]));
ok('productId로 알아본다', ownsProduct([{ productId: PRODUCT_ID }]));
ok('id로도 알아본다', ownsProduct([{ id: PRODUCT_ID }]));
ok('sku로도 알아본다', ownsProduct([{ sku: PRODUCT_ID }]));
ok('남의 상품은 아니다', ownsProduct([{ productId: 'dev.other.thing' }]) === false);
ok('**환불된 것은 소유가 아니다**', !ownsProduct([{ productId: PRODUCT_ID, isCanceled: true }]));
ok('회수된 것도 아니다', !ownsProduct([{ productId: PRODUCT_ID, revoked: true }]));
ok('실패한 거래도 아니다',
  !ownsProduct([{ productId: PRODUCT_ID, transactionState: 'failed' }]));
ok('여럿 중에 있으면 산 것이다',
  ownsProduct([{ productId: 'x' }, { productId: PRODUCT_ID }]));

console.log('\n── 무엇이 잠기나 ──');
check('지금 잠그는 자리', GATE, 'sync');
ok('사기 전에는 이어짐이 잠긴다', isLocked('sync', false));
ok('사고 나면 열린다', !isLocked('sync', true));
ok('**적고 긋는 것은 잠그지 않는다**', !isLocked('write', false) && !isLocked('strike', false));

console.log('\n── 스토어가 던진 것 ──');
check('사용자가 그만둠', outcomeOf({ code: 'E_USER_CANCELLED' }), 'canceled');
check('이미 가지고 있음', outcomeOf({ code: 'E_ALREADY_OWNED' }), 'already');
check('스토어에 못 닿음', outcomeOf({ code: 'E_NOT_PREPARED' }), 'unavailable');
check('네트워크', outcomeOf({ code: 'E_NETWORK_ERROR' }), 'unavailable');
check('승인 대기', outcomeOf({ code: 'E_DEFERRED_PAYMENT' }), 'pending');
check('그 밖', outcomeOf({ code: 'E_UNKNOWN' }), 'failed');
check('아무것도 없으면', outcomeOf(null), 'failed');
ok('**취소에도 할 말이 있다** — 오류로 보이면 안 된다', !!MESSAGE.canceled);
ok('모든 갈래에 말이 있다',
  ['canceled', 'already', 'unavailable', 'pending', 'failed'].every(k => !!MESSAGE[k]));
done('구매');
