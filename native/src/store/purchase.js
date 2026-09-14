/*
 * 스토어와 말하는 자리 (P1-4).
 *
 * 판단은 여기에 없다 — 무엇을 잠그고 무엇이 소유인지는 `core/entitlement.js`에
 * 있고, 여기서는 애플과 주고받기만 한다.
 *
 * **모듈이 없어도 앱은 돈다.** Expo Go나 검사에서는 `expo-iap`의 네이티브
 * 조각이 없다. 그때는 `available: false`로 조용히 물러나고, 구매 상태는
 * 기기에 적어 둔 사본을 쓴다. **스토어에 못 닿는다고 앱이 멈추면 안 된다.**
 *
 * **영수증을 서버로 보내지 않는다** (entitlement.js의 설명 참고).
 */
import { Platform } from 'react-native';
import * as Store from './storage.js';
import { PRODUCT_ID, PRICE_FALLBACK, ownsProduct, outcomeOf } from '../core/entitlement.js';

let iap = null;          // expo-iap 모듈 (없을 수 있다)
let ready = false;
let price = null;
let listeners = [];

function load() {
  if (iap !== null) return iap;
  try {
    // eslint-disable-next-line global-require
    iap = require('expo-iap');
  } catch (e) {
    iap = false;         // 없다 — 다시 찾지 않는다
  }
  return iap;
}

export const available = () => !!load() && Platform.OS === 'ios';
export const owned = () => Store.owned();
export const priceLabel = () => price || PRICE_FALLBACK;

const tell = state => listeners.forEach(fn => fn(state));
export const onChange = fn => {
  listeners.push(fn);
  return () => { listeners = listeners.filter(f => f !== fn); };
};

function mark(v) {
  Store.setOwned(v);
  tell(v);
}

/*
 * 앱을 열 때 한 번. 스토어에 이어 붙고, 값을 물어보고, **이미 산 것이 있으면
 * 그때 되살린다** — 기기를 바꾼 사람이 `구매 복원`을 찾아 헤매지 않게.
 * 실패해도 조용하다. 산 사람의 사본은 그대로 남아 있다.
 */
export async function start() {
  if (!available()) return owned();
  try {
    await iap.initConnection();
    ready = true;
    const products = await iap.fetchProducts({ skus: [PRODUCT_ID], type: 'in-app' });
    const one = Array.isArray(products) ? products[0] : null;
    if (one) price = one.displayPrice || one.localizedPrice || one.price || null;
    /* 애플이 든 것이 진짜다. 사본이 틀렸으면 여기서 바로잡힌다 */
    const mine = await iap.getAvailablePurchases();
    mark(ownsProduct(mine));
  } catch (e) { /* 스토어에 못 닿았다 — 사본대로 간다 */ }
  return owned();
}

export async function stop() {
  if (ready && iap) { try { await iap.endConnection(); } catch (e) {} }
  ready = false;
}

/*
 * 구매. 돌려주는 것은 `{ ok, outcome }`이고, 화면은 `outcome`으로 말을 고른다.
 * **이미 산 사람은 다시 사지 않는다** — 누르기 전에 막는다.
 */
export async function buy() {
  if (owned()) return { ok: true, outcome: 'already' };
  if (!available()) return { ok: false, outcome: 'unavailable' };

  return new Promise(resolve => {
    let done = false;
    const finish = out => {
      if (done) return;
      done = true;
      subUpdate.remove && subUpdate.remove();
      subError.remove && subError.remove();
      resolve(out);
    };

    const subUpdate = iap.purchaseUpdatedListener(async purchase => {
      try {
        /* **거래를 닫아 준다.** 안 닫으면 열 때마다 되살아난다 */
        await iap.finishTransaction({ purchase, isConsumable: false });
      } catch (e) { /* 닫기 실패는 소유를 뒤집지 않는다 */ }
      if (ownsProduct([purchase])) mark(true);
      finish({ ok: true, outcome: 'bought' });
    });

    const subError = iap.purchaseErrorListener(err => {
      finish({ ok: false, outcome: outcomeOf(err) });
    });

    iap.requestPurchase({
      request: { apple: { sku: PRODUCT_ID }, google: { skus: [PRODUCT_ID] } },
      type: 'in-app',
    }).catch(err => finish({ ok: false, outcome: outcomeOf(err) }));
  });
}

/*
 * 구매 복원 — 지웠다 다시 깐 기기에서. 애플에 다시 물어본다.
 * 없으면 없다고 말한다 (**없는 것을 있다고 하지 않는다**).
 */
export async function restore() {
  if (!available()) return { ok: false, outcome: 'unavailable' };
  try {
    if (!ready) { await iap.initConnection(); ready = true; }
    if (iap.restorePurchases) await iap.restorePurchases();
    const mine = await iap.getAvailablePurchases();
    const has = ownsProduct(mine);
    mark(has);
    return { ok: has, outcome: has ? 'restored' : 'nothing' };
  } catch (e) {
    return { ok: false, outcome: outcomeOf(e) };
  }
}
