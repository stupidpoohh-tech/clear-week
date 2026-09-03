/*
 * 위젯에 넘기는 것 — **한 주가 항상 펼쳐져 있음**이 이 제품의 경쟁력이다.
 *
 * 위젯은 Swift이고 JS가 돌지 않는다. 앱이 App Group에 적어 두면 위젯이 읽는다.
 * 주 데이터는 이미 같은 컨테이너에 있지만(`storage.js`), 위젯이 ISO 주를
 * 계산하고 항목을 고르게 하지 않는다 — **적은 것을 보면 알 수 있는 일은
 * 시키지 않는다** (규칙 6). 앱이 지금 주를 펴서 그대로 건네준다.
 *
 * 넘기는 것은 글자와 그어졌는지뿐이다. 획의 시드·비율은 위젯에서 쓸 데가 없다.
 */
import { Platform } from 'react-native';
import { ExtensionStorage } from '@bacons/apple-targets';
import { APP_GROUP, WIDGET_KEY } from './storage.js';
import { WEEK_DAYS, cellLabel } from '../core/week.js';

const shared = Platform.OS === 'ios' ? new ExtensionStorage(APP_GROUP) : null;

export function publish(week, monday) {
  if (!shared) return;
  const days = WEEK_DAYS.map(k => ({
    label: cellLabel(k, monday),
    note: (week.notes && week.notes[k]) || '',
    items: (week.days[k] || []).slice(0, 8).map(it => ({
      text: it.text,
      struck: it.struck ? 1 : 0,
    })),
  }));
  try {
    shared.set(WIDGET_KEY, JSON.stringify({ weekId: week.weekId, days }));
    ExtensionStorage.reloadWidget();
  } catch (e) { /* 위젯이 없거나 아직 안 붙었다 — 앱은 그대로 돈다 */ }
}
