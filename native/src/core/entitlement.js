/*
 * 구매 — **한 번 내고 소장한다** (P1-4).
 *
 * 구독이 아니다. 광고도 없다. 스토어에는 상품 하나뿐이고, 한 번 사면 끝난다.
 * 지운 뒤 다시 깔아도 `구매 복원`으로 되살아난다 (애플이 영수증을 들고 있다).
 *
 * **무엇이 구매 뒤에 있나 — 여기 한 줄이 정한다** (`GATE`).
 * 지금은 `sync`다: 기기간 연동과 캘린더 연동이 구매 뒤에 열린다.
 * 고른 이유는 **그것이 유지비가 드는 부분**이고(서버·Durable Object),
 * 잠겨도 **적고·긋고·지우는 핵심은 그대로 돈다**는 것이다 — 종이 한 장으로서의
 * 이 앱은 구매 전에도 온전하다. 잠그는 자리를 바꾸려면 이 상수만 바꾸면 된다.
 *
 * **영수증을 서버로 보내 검사하지 않는다.** 서버는 주를 맡아 두는 자리이지
 * 사람을 심사하는 자리가 아니고, 그러자고 서버에 구매 상태를 들이면 로그아웃
 * 상태의 앱이 서버를 알게 된다 (spec §11이 막아 둔 것). 스토어의 답을 믿는다.
 */

/* 스토어에 올릴 상품 하나. App Store Connect에서 같은 id로 만든다 (DADA REQUIRED) */
export const PRODUCT_ID = 'dev.clearweek.app.forever';

/* 값은 스토어가 그 나라 말과 화폐로 돌려준다. 이 값은 못 받았을 때만 쓴다 */
export const PRICE_FALLBACK = '₩3,900';

/* 'sync' | 'none' — 'none'이면 아무것도 잠기지 않는다 (구매는 그저 후원이 된다) */
export const GATE = 'sync';

/* 스토어가 준 목록에 우리 상품이 있나. 모양이 조금씩 달라서 넓게 본다 */
export function ownsProduct(purchases, id = PRODUCT_ID) {
  if (!Array.isArray(purchases)) return false;
  return purchases.some(p => {
    if (!p) return false;
    const sku = p.productId || p.id || p.sku ||
      (Array.isArray(p.ids) ? p.ids[0] : null);
    if (sku !== id) return false;
    /* 애플은 환불·가족 공유 해제를 상태로 알려 준다. 취소된 것은 소유가 아니다 */
    if (p.isCanceled || p.revoked) return false;
    if (p.transactionState === 'failed' || p.transactionState === 'deferred') return false;
    return true;
  });
}

/* 이 기능이 구매 뒤에 있나 */
export function isLocked(feature, owned) {
  if (owned) return false;
  if (GATE === 'none') return false;
  return feature === 'sync';
}

/*
 * 스토어가 던진 것을 사람 말로 옮길 수 있는 갈래로 줄인다.
 * **취소는 실패가 아니다** — 그만둔 사람에게 오류를 보여 주면 안 된다.
 */
export function outcomeOf(err) {
  const code = String((err && (err.code || err.message)) || '').toUpperCase();
  if (!code) return 'failed';
  if (code.includes('CANCEL')) return 'canceled';           // E_USER_CANCELLED
  if (code.includes('ALREADY')) return 'already';           // E_ALREADY_OWNED
  if (code.includes('NOT_PREPARED') || code.includes('UNAVAILABLE') ||
      code.includes('NETWORK') || code.includes('SERVICE')) return 'unavailable';
  if (code.includes('DEFERRED') || code.includes('PENDING')) return 'pending';
  return 'failed';
}

/* 알림 문구의 열쇠 — 화면은 이것만 보고 말을 고른다 */
export const MESSAGE = {
  canceled: 'buy.canceled',
  already: 'buy.already',
  unavailable: 'buy.unavailable',
  pending: 'buy.failed',
  failed: 'buy.failed',
};
