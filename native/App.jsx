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

import * as Localization from 'expo-localization';

import { COLOR } from './src/core/constants.js';
import { mondayOf, addWeeks, weekIdOf, rolledOver, untilNextWeek } from './src/core/week.js';
import { t, setLocale, onLocale } from './src/i18n/index.js';
import { captureItem, captureNote, revert, countOf } from './src/core/undo.js';
import { isLocked } from './src/core/entitlement.js';
import * as Purchase from './src/store/purchase.js';
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
import { UNDO } from './src/core/constants.js';
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
  const [verified, setVerified] = React.useState(false);
  const [serverReady, setServerReady] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [owned, setOwned] = React.useState(() => Purchase.owned());
  const [lang, setLang] = React.useState('en');
  /* 방금 지운 것 — 짧은 동안만 들고 있다 (P1-2) */
  const [undoSnap, setUndoSnap] = React.useState(null);
  const undoTimer = React.useRef(null);

  const rev = React.useRef(0);            /* 고칠 때마다 오른다. 올린 응답의 방패 */
  const pushTimer = React.useRef(null);
  const weekRef = React.useRef(week);
  weekRef.current = week;
  const mondayRef = React.useRef(monday);
  mondayRef.current = monday;
  /* 이번 주를 보고 있나 — 주가 넘어갈 때 따라갈지 이 값이 정한다 (P1-2) */
  const followRef = React.useRef(true);

  /* ── 첫 실행 ────────────────────────────────────────────── */
  React.useEffect(() => {
    /* 말부터 정한다 — 사람이 고른 것이 있으면 그것, 없으면 기기 설정 (P1-3) */
    const chosen = Store.lang();
    setLang(setLocale(chosen ? [chosen] : Localization.getLocales().map(l => l.languageTag)));

    const id = weekIdOf(monday);
    setWeek(sanitizeWeek(Store.loadWeek(id), id));
    const off = Store.soundOff();
    setSound(!off);
    Sound.prepare(!off);
    setGuide(!Store.guideSeen());
    Purchase.start().then(setOwned).catch(() => {});

    (async () => {
      if (!configured()) return;
      const ready = await Server.ready();
      setServerReady(ready);
      if (!ready) return;
      if (await Auth.restore()) {
        setEmail(Auth.state.email);
        setVerified(Auth.state.verified);
        /* 아직 인증 전인 기기는 열 때 조용히 한 번 물어본다 — 사람이 다른
           기기에서 메일 링크를 눌렀을 수 있다 (P1-1) */
        if (!Auth.state.verified) {
          const ok = await Auth.confirm({ quiet: true });
          setVerified(ok);
          if (!ok) return;
        }
        if (!canSync()) return;      // 구매 전이면 여기서 멈춘다 (P1-4)
        /* 다시 열었을 때는 지금 보는 주만 올린다. 전부 맞추는 것은
           **기기를 새로 이을 때**의 일이다 */
        pushNow();
        pullCalendar();
      }
    })();

    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      Sound.resume();
      catchUpWeek();        /* 며칠 켜 둔 채였을 수 있다 (P1-2) */
      pushNow();
    });
    return () => { sub.remove(); Purchase.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 말이 바뀌면 화면도 따라 바뀐다 */
  React.useEffect(() => onLocale(setLang), []);
  React.useEffect(() => Purchase.onChange(setOwned), []);

  /*
   * **주가 넘어가면 화면도 넘어간다** (P1-2). 자정에 한 번 깨우고, 앱이 앞으로
   * 돌아올 때도 확인한다. 보고 있던 주가 이번 주였을 때만 옮긴다 —
   * 지난주를 일부러 펴 둔 것이면 그대로 둔다.
   * **항목은 따라가지 않는다** (자동 이월 없음).
   */
  const catchUpWeek = React.useCallback(() => {
    if (!rolledOver(mondayRef.current, followRef.current)) return;
    move(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => catchUpWeek(), untilNextWeek());
    return () => clearTimeout(timer);
  }, [catchUpWeek, monday]);

  /* 로그인 상태가 바뀌면 머리말의 사람 표시도 따라 진해진다 */
  React.useEffect(() => Auth.onChange(() => {
    setEmail(Auth.state.email);
    setVerified(Auth.state.verified);
  }), []);

  /* ── 저장 — 바뀔 때마다. 조용히 실패하지 않는다 (spec §5-2) ── */
  const keep = React.useCallback(next => {
    rev.current += 1;
    setWeek(next);
    const ok = Store.saveWeek(next);
    setNotice(ok ? '' : t('notice.storage'));
    Widget.publish(next, mondayRef.current);
    schedulePush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 주 이동 — **지난 주도 편집 가능하다** ─────────────────── */
  const move = React.useCallback(delta => {
    const next = delta === 0 ? mondayOf(new Date()) : addWeeks(mondayRef.current, delta);
    const id = weekIdOf(next);
    /* 이번 주로 돌아오면 다시 따라간다. 지난주를 펴면 그 자리에 머문다 */
    followRef.current = id === weekIdOf(new Date());
    setMonday(next);
    setWeek(sanitizeWeek(Store.loadWeek(id), id));
    /* **받아 오는 때는 주 이동과 로그인 직후뿐이다** — 적을 때마다 묻지 않는다 */
    if (Auth.signedIn()) setTimeout(() => pullCalendar(), CAL.pullDelayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 서버 ──────────────────────────────────────────────── */
  const schedulePush = () => {
    if (!canSync()) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(pushNow, SYNC.pushDelayMs);
  };

  /*
   * **서버로 나가도 되는가는 한 자리에서 묻는다.**
   * 로그인 + 메일 인증(P1-1) + 구매(P1-4) — 셋이 다 서야 나간다.
   * 하나라도 아니면 이 기기에만 적힌다. 그것이 이 앱의 기본 상태다.
   */
  const canSync = () => Auth.linked() && !isLocked('sync', Purchase.owned());

  const pushNow = async () => {
    if (!canSync()) return;
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
      /* **인증 전인 것과 로그인이 죽은 것은 다르다** (P1-1) */
      if (e.status === 401) {
        const how = await Auth.denied();
        setVerified(Auth.state.verified);
        if (how === 'logged-out') setEmail(null);
      } else setStatus(t('account.offline'));
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
    if (!canSync()) return;
    try {
      const mine = Store.loadAll();
      const hasLocal = Object.values(mine).some(w => !isEmptyWeek(sanitizeWeek(w, w.weekId)));
      const remote = await Server.peek();
      if (applyReset(remote.resetAt)) return;
      const hasRemote = remote.weeks && Object.keys(remote.weeks).length > 0;

      if (hasLocal && hasRemote) {
        Alert.alert(t('notice.linkTitle'), t('notice.linkAsk'), [
            { text: t('notice.linkMerge'), onPress: () => syncAll() },
            { text: t('notice.linkMine'), onPress: async () => {
              const out = await Server.wipe();
              Store.setResetAt(out.resetAt);
              syncAll();
            } },
            { text: t('notice.linkServer'), onPress: () => { Store.clearWeeks(); syncAll(); } },
          ]);
        return;
      }
      await syncAll();
    } catch (e) { setStatus(t('account.offline')); }
  };

  const syncAll = async () => {
    if (!canSync()) return;
    try {
      const out = await Server.syncAll(Store.loadAll(), Store.resetAt());
      if (!applyReset(out.resetAt)) {
        Object.values(out.weeks || {}).forEach(w => Store.saveWeek(sanitizeWeek(w, w.weekId)));
        const id = weekIdOf(mondayRef.current);
        setWeek(sanitizeWeek(Store.loadWeek(id), id));
      }
      pullCalendar();
    } catch (e) { setStatus(t('account.offline')); }
  };

  /* 캘린더에서 **받아만 온다.** 이쪽에서 적은 것도 지운 것도 저쪽으로 안 간다 */
  const pullCalendar = async () => {
    /* **인증 전에는 캘린더도 받지 않는다.** 한쪽만 이어지면 "이어진 것 같은데
       안 맞는" 자리가 생긴다 (P1-1). 구매 전에도 마찬가지다 (P1-4) */
    if (!canSync()) return;
    try {
      const out = await Calendar.pull(weekRef.current, mondayRef.current);
      if (out.changed) keep(out.week);
    } catch (e) { /* 캘린더가 없어도 주간표는 그대로 돈다 */ }
  };

  /*
   * 되돌릴 것을 손에 쥐고, 시간이 지나면 놓는다 (P1-2).
   * **한 손짓에 여럿을 지우면 하나로 모은다** — 롱프레스 후 끌어 지울 때
   * 되돌리기가 항목 수만큼 뜨면 그게 더 번거롭다.
   */
  const arm = React.useCallback(snap => {
    clearTimeout(undoTimer.current);
    setUndoSnap(prev => (prev
      ? { kind: 'many', snaps: (prev.kind === 'many' ? prev.snaps : [prev]).concat(snap) }
      : snap));
    undoTimer.current = setTimeout(() => setUndoSnap(null), UNDO.ms);
  }, []);

  const undo = React.useCallback(() => {
    clearTimeout(undoTimer.current);
    setUndoSnap(snap => {
      if (snap) keep(revert(weekRef.current, snap));
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keep]);

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

    /*
     * **롱프레스 삭제는 묻지 않는다.** 대신 짧은 동안 되돌릴 수 있다 (P1-2).
     * 한 손짓으로 여럿을 지우면 묶음으로 담는다 — 되돌리기도 한 번에.
     */
    remove: (key, id, kind) => {
      Feel.onDelete();
      const w = weekRef.current;
      if (kind === 'note') {
        arm(captureNote(key, (w.notes && w.notes[key]) || '',
          (w.noteStrikes && w.noteStrikes[key]) || []));
        keep(clearNote(w, key));
        return;
      }
      const it = (w.days[key] || []).find(x => x.id === id);
      if (it) arm(captureItem(key, it));
      keep(removeItem(w, key, id));
    },

    scratch: speed => Sound.scratchAt(speed),
    scratchStop: () => Sound.stopScratch(),
  }), [keep, arm]);

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
            linked={!!email && verified} onAccount={() => setAccount(true)}
            onPull={() => { pushNow(); pullCalendar(); }}
            notice={notice}
            undo={{ count: countOf(undoSnap), kind: undoSnap && undoSnap.kind }}
            onUndo={undo}
          />
          {guide ? (
            <GuideCard
              serverReady={serverReady}
              onClose={never => { setGuide(false); if (never) Store.setGuideSeen(true); }}
            />
          ) : null}
          <AccountSheet
            visible={account} onClose={() => setAccount(false)}
            email={email} verified={verified} serverReady={serverReady} status={status}
            owned={owned} price={Purchase.priceLabel()} lang={lang}
            /*
             * 로그인은 하나다 — 없는 계정이면 만들고, **만든 계정에는 인증
             * 메일이 나간다** (P1-1). 이어지는 것은 인증 뒤의 일이다.
             */
            onSignIn={async (id, pw) => {
              try { await Auth.signIn(id, pw); }
              catch (e) {
                if (String(e.code || '').includes('INVALID_LOGIN') ||
                    String(e.code || '').includes('EMAIL_NOT_FOUND')) await Auth.signUp(id, pw);
                else throw e;
              }
              setEmail(Auth.state.email);
              setVerified(Auth.state.verified);
              if (Auth.linked()) link();
            }}
            onVerifyCheck={async () => {
              const ok = await Auth.confirm();
              setVerified(ok);
              if (ok) link();
              return ok;
            }}
            onVerifyResend={async () => {
              const out = await Auth.sendVerifyMail();
              if (out.ok) return t('verify.resent');
              if (out.reason === 'wait') return t('verify.tooSoon', { sec: out.sec });
              return t('verify.mailFailed');
            }}
            onBuy={async () => {
              const out = await Purchase.buy();
              setOwned(Purchase.owned());
              return out;
            }}
            onRestore={async () => {
              const out = await Purchase.restore();
              setOwned(Purchase.owned());
              return out;
            }}
            onLang={code => { Store.setLang(code); setLang(setLocale([code])); }}
            /*
             * 계정 삭제 (P1-5) — **순서가 중요하다.** 서버 것을 먼저 지우고,
             * 그다음 Firebase 계정을 지운다. 계정을 먼저 지우면 토큰이 죽어
             * 서버 것을 지울 수 없다.
             * **이 기기의 주는 기본으로 남긴다** — 계정을 지우는 것과 적어 둔
             * 것을 버리는 것은 다른 뜻이다. 함께 지우려면 체크해야 한다.
             */
            onDeleteAccount={async alsoLocal => {
              try {
                if (Auth.linked()) await Server.deleteServerData();
                await Auth.deleteAccount();
                setEmail(null); setVerified(false);
                if (alsoLocal) {
                  Store.clearEverything();
                  const id = weekIdOf(mondayRef.current);
                  setWeek(blankWeek(id));
                }
                return true;
              } catch (e) { return false; }
            }}
            onLogout={async () => { await Auth.logout(); setEmail(null); setVerified(false); }}
            onWipe={async () => {
              try {
                const out = await Server.wipe();
                applyReset(out.resetAt, true);   /* 이 기기도 함께 비운다 */
              } catch (e) { setStatus(t('account.offline')); }
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
