/*
 * Clear Week — 종이 주간 플래너를 그대로 옮긴 것.
 *
 * 이 파일이 하는 일: 지금 어느 주인지 들고 있고, 바뀐 것을 저장하고,
 * 로그인돼 있으면 서버·캘린더와 맞춘다. **판단은 여기 없다** —
 * 합치기는 서버 한 곳에, 손맛은 `core/`에, 자리는 `ui/layout.js`에 있다.
 *
 * 지켜야 하는 것:
 *   - 취소선은 삭제가 아니라 축적이다. 그은 항목은 그 자리에 남는다.
 *   - 자동 이월 없음. 못 한 일은 다음 주로 넘어가지 않는다.
 *   - **앱 화면에 숫자가 나타나는 순간 그건 위반이다** (달성률·연속기록·점수).
 *   - 로그아웃 상태의 앱은 서버를 전혀 건드리지 않는다.
 */
import React from 'react';
import { Alert, AppState, StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { COLOR } from './src/core/constants.js';
import { mondayOf, addWeeks, weekIdOf } from './src/core/week.js';
import {
  blankWeek, sanitizeWeek, addItem, editItem, removeItem, addStrike, removeStrike,
  setNote, setNoteStrikes, clearNote, isEmptyWeek,
} from './src/core/model.js';
import * as Store from './src/store/storage.js';
import * as Widget from './src/store/widget.js';
import * as Sound from './src/audio/sound.js';
import * as Feel from './src/feel/haptics.js';
import * as Auth from './src/sync/auth.js';
import * as Server from './src/sync/server.js';
import * as Calendar from './src/sync/calendar.js';
import { configured, SYNC, CAL } from './src/sync/config.js';
import WeekScreen from './src/ui/WeekScreen.jsx';
import GuideCard from './src/ui/GuideCard.jsx';
import AccountSheet from './src/ui/AccountSheet.jsx';

export default function App() {
  const [monday, setMonday] = React.useState(() => mondayOf(new Date()));
  const [week, setWeek] = React.useState(() => blankWeek(weekIdOf(new Date())));
  const [sound, setSound] = React.useState(true);
  const [guide, setGuide] = React.useState(false);
  const [account, setAccount] = React.useState(false);
  const [email, setEmail] = React.useState(null);
  const [serverReady, setServerReady] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const rev = React.useRef(0);            /* 고칠 때마다 오른다. 올린 응답의 방패 */
  const pushTimer = React.useRef(null);
  const weekRef = React.useRef(week);
  weekRef.current = week;
  const mondayRef = React.useRef(monday);
  mondayRef.current = monday;

  /* ── 첫 실행 ────────────────────────────────────────────── */
  React.useEffect(() => {
    const id = weekIdOf(monday);
    setWeek(sanitizeWeek(Store.loadWeek(id), id));
    const off = Store.soundOff();
    setSound(!off);
    Sound.prepare(!off);
    setGuide(!Store.guideSeen());

    (async () => {
      if (!configured()) return;
      const ready = await Server.ready();
      setServerReady(ready);
      if (!ready) return;
      if (await Auth.restore()) {
        setEmail(Auth.state.email);
        /* 다시 열었을 때는 지금 보는 주만 올린다. 전부 맞추는 것은
           **기기를 새로 이을 때**의 일이다 */
        pushNow();
        pullCalendar();
      }
    })();

    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') { Sound.resume(); pushNow(); }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 로그인 상태가 바뀌면 머리말의 사람 표시도 따라 진해진다 */
  React.useEffect(() => Auth.onChange(() => setEmail(Auth.state.email)), []);

  /* ── 저장 — 바뀔 때마다. 조용히 실패하지 않는다 (spec §5-2) ── */
  const keep = React.useCallback(next => {
    rev.current += 1;
    setWeek(next);
    const ok = Store.saveWeek(next);
    setNotice(ok ? '' : '저장이 막혀 있습니다 — 이 기기에 남지 않습니다');
    Widget.publish(next, mondayRef.current);
    schedulePush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 주 이동 — **지난 주도 편집 가능하다** ─────────────────── */
  const move = React.useCallback(delta => {
    const next = delta === 0 ? mondayOf(new Date()) : addWeeks(mondayRef.current, delta);
    const id = weekIdOf(next);
    setMonday(next);
    setWeek(sanitizeWeek(Store.loadWeek(id), id));
    /* **받아 오는 때는 주 이동과 로그인 직후뿐이다** — 적을 때마다 묻지 않는다 */
    if (Auth.signedIn()) setTimeout(() => pullCalendar(), CAL.pullDelayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 서버 ──────────────────────────────────────────────── */
  const schedulePush = () => {
    if (!Auth.signedIn()) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(pushNow, SYNC.pushDelayMs);
  };

  const pushNow = async () => {
    if (!Auth.signedIn()) return;
    const sent = rev.current;
    try {
      const out = await Server.pushWeek(weekRef.current, Store.resetAt());
      applyReset(out.resetAt);
      /* **보내는 사이에 더 고쳤으면 받은 것은 이미 낡았다** (spec §11).
         연달아 그을 때 두 번째부터 사라지던 원인이 이것이었다 */
      if (rev.current !== sent) { schedulePush(); return; }
      if (out.week && out.week.weekId === weekRef.current.weekId) {
        setWeek(sanitizeWeek(out.week, out.week.weekId));
        Store.saveWeek(sanitizeWeek(out.week, out.week.weekId));
      }
      setStatus('');
    } catch (e) {
      if (e.status === 401) { await Auth.logout(); setEmail(null); }
      else setStatus('연결 안 됨');
    }
  };

  /* 서버가 비워졌다면 이 기기도 따라 비운다. 그보다 오래된 것은 무시한다 */
  const applyReset = (serverResetAt, force) => {
    const at = Number(serverResetAt) || 0;
    if (!at || (!force && at <= Store.resetAt())) return false;
    Store.clearWeeks();
    Store.setResetAt(at);
    const id = weekIdOf(mondayRef.current);
    setWeek(blankWeek(id));
    return true;
  };

  /* 기기를 처음 이을 때 — **양쪽에 다 기록이 있으면 물어본다** (spec §11).
     세 갈래가 서로 다른 일을 한다:
       합치기 — 그냥 올린다. 서버가 합쳐 준다
       이 기기 — 서버를 비우고(비운 시각은 내가 들고) 내 것을 새 출발점으로 올린다
       서버   — 서버는 그대로 두고 **내 것을 버린다.** 올릴 것이 없으면 서버 것만 내려온다 */
  const link = async () => {
    try {
      const mine = Store.loadAll();
      const hasLocal = Object.values(mine).some(w => !isEmptyWeek(sanitizeWeek(w, w.weekId)));
      const remote = await Server.peek();
      if (applyReset(remote.resetAt)) return;
      const hasRemote = remote.weeks && Object.keys(remote.weeks).length > 0;

      if (hasLocal && hasRemote) {
        Alert.alert('기기를 잇습니다',
          '이 기기와 서버 양쪽에 적은 것이 있습니다. 어떻게 할까요.', [
            { text: '합치기', onPress: () => syncAll() },
            { text: '이 기기', onPress: async () => {
              const out = await Server.wipe();
              Store.setResetAt(out.resetAt);
              syncAll();
            } },
            { text: '서버', onPress: () => { Store.clearWeeks(); syncAll(); } },
          ]);
        return;
      }
      await syncAll();
    } catch (e) { setStatus('연결 안 됨'); }
  };

  const syncAll = async () => {
    try {
      const out = await Server.syncAll(Store.loadAll(), Store.resetAt());
      if (!applyReset(out.resetAt)) {
        Object.values(out.weeks || {}).forEach(w => Store.saveWeek(sanitizeWeek(w, w.weekId)));
        const id = weekIdOf(mondayRef.current);
        setWeek(sanitizeWeek(Store.loadWeek(id), id));
      }
      pullCalendar();
    } catch (e) { setStatus('연결 안 됨'); }
  };

  /* 캘린더에서 **받아만 온다.** 이쪽에서 적은 것도 지운 것도 저쪽으로 안 간다 */
  const pullCalendar = async () => {
    if (!Auth.signedIn()) return;
    try {
      const out = await Calendar.pull(weekRef.current, mondayRef.current);
      if (out.changed) keep(out.week);
    } catch (e) { /* 캘린더가 없어도 주간표는 그대로 돈다 */ }
  };

  /* ── 손짓이 부르는 것들 ───────────────────────────────────── */
  const onWeek = React.useMemo(() => ({
    add: (key, text) => { if (text) keep(addItem(weekRef.current, key, text).week); },
    edit: (key, id, text) => keep(text
      ? editItem(weekRef.current, key, id, text)
      : removeItem(weekRef.current, key, id)),
    note: (key, text) => keep(text
      ? setNote(weekRef.current, key, text)
      : clearNote(weekRef.current, key)),

    strike: (key, id, kind, rec) => {
      Feel.onCommit();
      const w = weekRef.current;
      keep(kind === 'note'
        ? setNoteStrikes(w, key, [...(w.noteStrikes[key] || []), rec])
        : addStrike(w, key, id, rec));
    },
    commitStrikes: (key, id, kind, recs) => {
      Feel.onCommit();
      let w = weekRef.current;
      recs.forEach(rec => {
        w = kind === 'note'
          ? setNoteStrikes(w, key, [...(w.noteStrikes[key] || []), rec])
          : addStrike(w, key, id, rec);
      });
      keep(w);
    },
    unstrike: s => onWeek.unstrikeMany([s]),
    unstrikeMany: list => {
      Feel.onErase();
      let w = weekRef.current;
      /* 뒤에서부터 지운다 — 앞을 먼저 지우면 뒤 번호가 밀린다 */
      [...list].sort((a, b) => b.index - a.index).forEach(s => {
        if (s.kind === 'note') {
          const rest = (w.noteStrikes[s.key] || []).filter((_, i) => i !== s.index);
          w = setNoteStrikes(w, s.key, rest);
        } else {
          w = removeStrike(w, s.key, s.id, s.index);
        }
      });
      keep(w);
    },

    /* **롱프레스 삭제는 확인도 취소도 없다.** 되돌리기는 아직 없다 */
    remove: (key, id, kind) => {
      Feel.onDelete();
      keep(kind === 'note'
        ? clearNote(weekRef.current, key)
        : removeItem(weekRef.current, key, id));
    },

    scratch: speed => Sound.scratchAt(speed),
    scratchStop: () => Sound.stopScratch(),
  }), [keep]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    Store.setSoundOff(!next);
    Sound.setEnabled(next);
  };

  /* 가져오기는 **덮어쓰지 않는다** — 지금 없는 주만 채운다 (spec §5-1) */
  const importAll = data => {
    const weeks = (data && data.weeks) || {};
    let added = 0;
    Object.keys(weeks).forEach(id => {
      if (Store.loadWeek(id)) return;
      Store.saveWeek(sanitizeWeek(weeks[id], id));
      added++;
    });
    const id = weekIdOf(mondayRef.current);
    setWeek(sanitizeWeek(Store.loadWeek(id), id));
    return added;
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={COLOR.paper} />
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <WeekScreen
            monday={monday} week={week} onWeek={onWeek}
            onMove={move} sound={sound} onSound={toggleSound}
            linked={!!email} onAccount={() => setAccount(true)}
            onPull={() => { pushNow(); pullCalendar(); }}
            notice={notice}
          />
          {guide ? (
            <GuideCard
              serverReady={serverReady}
              onClose={never => { setGuide(false); if (never) Store.setGuideSeen(true); }}
            />
          ) : null}
          <AccountSheet
            visible={account} onClose={() => setAccount(false)}
            email={email} serverReady={serverReady} status={status}
            onSignIn={async (id, pw) => {
              try { await Auth.signIn(id, pw); }
              catch (e) {
                if (String(e.code || '').includes('INVALID_LOGIN') ||
                    String(e.code || '').includes('EMAIL_NOT_FOUND')) await Auth.signUp(id, pw);
                else throw e;
              }
              setEmail(Auth.state.email);
              link();
            }}
            onLogout={async () => { await Auth.logout(); setEmail(null); }}
            onWipe={async () => {
              try {
                const out = await Server.wipe();
                applyReset(out.resetAt, true);   /* 이 기기도 함께 비운다 */
              } catch (e) { setStatus('연결 안 됨'); }
            }}
            onGuide={() => { setAccount(false); setGuide(true); }}
            allWeeks={() => Store.loadAll()}
            onImport={importAll}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.paper },
});
