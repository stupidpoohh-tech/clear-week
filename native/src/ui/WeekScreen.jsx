/*
 * 한 주 — 머리말과 표. 이 화면이 앱의 거의 전부다.
 *
 * 쌓임은 이렇다 (아래에서 위로):
 *   1. 글자 (`WeekGrid`)        — 자리는 `layout.js`가 정한다
 *   2. 잉크 (`InkLayer`, Skia)  — 획만. 손짓은 안 받는다
 *   3. 펜 판 (`PenPad`)         — **글자가 없는 높이에만** (HANDOFF §4-1)
 *   4. 손짓 (`GestureSurface`)  — 전부 여기서 받는다
 *   5. 적는 줄 (`Editor`)       — 열려 있을 때만
 *
 * **스크롤이 없다.** 한 주가 한 화면이다. 그래서 당겨서 새로고침도 직접 만든다.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, useFrameCallback } from 'react-native-reanimated';
import { COLOR, SIZE, PULL, STROKE } from '../core/constants.js';
import { rangeLabel, isThisWeek } from '../core/week.js';
import { computeLayout } from './layout.js';
import { pointsFromRecord } from '../core/grain.js';
import WeekGrid from './WeekGrid.jsx';
import InkLayer from './InkLayer.jsx';
import GestureSurface from './GestureSurface.jsx';
import Editor from './Editor.jsx';
import PenPad from './PenPad.jsx';
import Header from './Header.jsx';

export default function WeekScreen({
  monday, week, onWeek, onMove, sound, onSound, linked, onAccount, onPull, notice,
}) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [metrics, setMetrics] = React.useState({});
  const [editing, setEditing] = React.useState(null);
  const [gone, setGone] = React.useState({});   /* 문대는 동안 잠시 사라진 획 */

  const live = useSharedValue({ points: [], fraction: 0, n: 0 });
  const trail = useSharedValue([]);
  const pull = useSharedValue(0);
  const reg = useSharedValue({ lines: [], cells: [], strokes: [] });
  const anim = useSharedValue(null);
  const lastTouch = React.useRef(0);
  const weekRef = React.useRef(week);
  weekRef.current = week;

  const layout = React.useMemo(() => (size.width
    ? computeLayout({ width: size.width, height: size.height, week, monday, metrics })
    : null), [size, week, monday, metrics]);

  /* 손짓이 읽는 등록부. 화면이 바뀔 때만 갈아 끼운다 */
  React.useEffect(() => {
    if (!layout) return;
    reg.value = { lines: layout.lines, cells: layout.cells, strokes: layout.strokes };
  }, [layout, reg]);

  const onMeasure = React.useCallback((key, lines) => {
    setMetrics(m => ({ ...m, [key]: { lines } }));
  }, []);

  /* ── 자라남·되감김·자동 긋기 — 전부 UI 스레드에서 돈다 ────────── */
  const frames = useFrameCallback(info => {
    'worklet';
    const a = anim.value;
    if (!a) return;
    if (!a.t0) { anim.value = { ...a, t0: info.timeSinceFirstFrame }; return; }
    const t = Math.min(1, (info.timeSinceFirstFrame - a.t0) / a.dur);
    live.value = { points: a.points, fraction: a.grow ? t : 1 - t, n: a.points.length };
    if (t >= 1) {
      anim.value = null;
      live.value = { points: [], fraction: 0, n: 0 };
    }
  }, false);

  const play = React.useCallback((points, grow, dur, after) => {
    anim.value = { points, grow, dur, t0: 0 };
    frames.setActive(true);
    setTimeout(() => {
      frames.setActive(false);
      if (after) after();
    }, dur + 32);
  }, [anim, frames]);

  /* ── 손짓이 JS로 넘겨주는 일들 ────────────────────────────── */
  const handlers = React.useMemo(() => ({
    touch: () => { lastTouch.current = Date.now(); },
    strike: (key, id, kind, rec) => onWeek.strike(key, id, kind, rec),
    rewind: () => {
      const pts = live.value.points;
      if (pts && pts.length) play(pts.slice(), false, STROKE.rewindMs);
      else live.value = { points: [], fraction: 0, n: 0 };
    },
    scratch: speed => onWeek.scratch(speed),
    scratchStop: () => onWeek.scratchStop(),
    /* 문대는 도중에 다 지워진 획 — 화면에서 먼저 걷고, 데이터도 지운다 */
    eraseStroke: s => {
      setGone(g => ({ ...g, [s.key + ':' + s.id + ':' + s.index]: 1 }));
      onWeek.unstrike(s);
    },
    /* 손을 뗄 때의 결판. **닿았던 획 전부에 걸린다** */
    eraseMany: list => {
      setGone(g => {
        const n = { ...g };
        list.forEach(s => { n[s.key + ':' + s.id + ':' + s.index] = 1; });
        return n;
      });
      onWeek.unstrikeMany(list);
    },
    eraseRestore: () => setGone({}),
    remove: (key, id, kind) => onWeek.remove(key, id, kind),
    edit: (key, id, kind) => {
      const w = weekRef.current;
      if (kind === 'note') {
        if (hasNoteStrike(w, key)) return;      /* 그어진 메모는 열리지 않는다 */
        openNote(key);
        return;
      }
      const it = (w.days[key] || []).find(x => x.id === id);
      if (!it || it.struck) return;             /* **그어진 항목은 열리지 않는다** */
      const rect = itemRect(layout, key, id);
      if (rect) setEditing({ key, id, kind: 'item', rect, value: it.text });
    },
    add: (key, kind) => {
      if (kind === 'note') { openNote(key); return; }
      const rect = blankRect(layout, key);
      if (rect) setEditing({ key, id: null, kind: 'item', rect, value: '' });
    },
    /* 더블탭 — **남은 줄까지** 자동으로 긋는다. 줄 하나씩, 시차를 두고.
       이미 그어진 줄은 다시 긋지 않는다. 획은 글자 밖으로 overshoot만큼만 나간다 */
    autoStrike: (key, id, kind) => {
      const recs = planAuto(layout, weekRef.current, key, id, kind);
      if (!recs.length) return;
      const lines = layout.lines.filter(l => l.key === key && l.id === id);
      let i = 0;
      const step = () => {
        if (i >= recs.length) { onWeek.commitStrikes(key, id, kind, recs); return; }
        const rec = recs[i];
        const l = lines.find(x => x.line === rec.line) || lines[0];
        const pts = pointsFromRecord(rec, l.left, Math.max(1, l.right - l.left),
          (l.top + l.bottom) / 2);
        i++;
        play(pts, true, STROKE.autoStrokeMs, () => setTimeout(step, STROKE.autoStagger));
      };
      step();
    },
    pull: () => onPull(),
  }), [layout, live, onPull, onWeek, play]);

  const openNote = key => {
    const w = weekRef.current;
    const n = layout.notes.find(x => x.key === key);
    if (!n) return;
    setEditing({ key, id: 'note', kind: 'note', value: (w.notes && w.notes[key]) || '', rect: {
      x: n.x, y: n.y, w: Math.max(n.w, 90), h: n.h,
    } });
  };

  const commitEdit = text => {
    const e = editing;
    setEditing(null);
    if (!e) return;
    if (e.kind === 'note') onWeek.note(e.key, text);
    else if (e.id) onWeek.edit(e.key, e.id, text);
    else if (text) onWeek.add(e.key, text);
  };

  const pullStyle = useAnimatedStyle(() => ({
    height: Math.min(pull.value, PULL.distance * 1.5),
    opacity: Math.min(1, pull.value / PULL.distance),
  }));

  const away = !isThisWeek(monday);

  return (
    <View style={styles.root}>
      <Header
        title={rangeLabel(monday)} away={away} sound={sound} linked={linked}
        onPrev={() => onMove(-1)} onNext={() => onMove(1)}
        onToday={() => onMove(0)} onSound={onSound} onAccount={onAccount}
      />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Animated.View style={[styles.pull, pullStyle]} />

      <View
        style={styles.body}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setSize(s => (s.width === width && s.height === height ? s : { width, height }));
        }}
      >
        {layout ? (
          <GestureSurface reg={reg} live={live} trail={trail} pull={pull} on={handlers}>
            <View style={StyleSheet.absoluteFill}>
              <WeekGrid
                layout={layout} week={week} metrics={metrics} onMeasure={onMeasure}
                editingKey={editing && editing.id ? editing.key + ':' + editing.id : null}
              />
              <InkLayer
                width={size.width} height={size.height}
                strokes={layout.strokes} hidden={gone} live={live} trail={trail}
              />
              {/* 펜 판 — 자리가 있는 칸에만. 글자가 있는 높이에는 두지 않는다 */}
              {layout.cells.filter(c => c.pad).map(c => (
                <PenPad
                  key={'p' + c.key} rect={c.pad} lastTouch={lastTouch}
                  onWrite={text => onWeek.add(c.key, text)}
                />
              ))}
            </View>
          </GestureSurface>
        ) : null}

        {editing ? (
          <Editor
            rect={editing.rect}
            value={editing.value}
            fontSize={editing.kind === 'note' ? SIZE.sublabelFont : SIZE.itemFont}
            onCommit={commitEdit}
          />
        ) : null}
      </View>
    </View>
  );
}

function planAuto(layout, week, key, id, kind) {
  const lines = layout.lines.filter(l => l.key === key && l.id === id);
  const had = kind === 'note'
    ? ((week.noteStrikes && week.noteStrikes[key]) || [])
    : (((week.days[key] || []).find(x => x.id === id) || {}).strikes || []);
  const done = new Set(had.map(s => s.line || 0));
  return lines.filter(l => !done.has(l.line)).map(l => {
    const width = Math.max(1, l.right - l.left);
    return {
      line: l.line,
      a: -STROKE.overshoot / width,
      b: 1 + STROKE.overshoot / width,
      seed: (Math.random() * 2147483647) | 0,
    };
  });
}

const hasNoteStrike = (w, key) =>
  !!(w.noteStrikes && w.noteStrikes[key] && w.noteStrikes[key].length);

function itemRect(layout, key, id) {
  const it = layout.items.find(x => x.key === key && x.id === id);
  return it ? { x: it.x, y: it.y, w: it.w, h: it.lineHeight } : null;
}

/* **누른 자리에 적힌다** — 적힌 것들 바로 아래 줄이 새 줄이다 */
function blankRect(layout, key) {
  const c = layout.cells.find(x => x.key === key);
  if (!c) return null;
  const y = Math.min(c.lowest, c.bottom - SIZE.itemHeight);
  return { x: c.bodyLeft, y, w: c.bodyW / c.columns, h: SIZE.itemHeight * c.scale };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLOR.paper },
  body: { flex: 1, marginHorizontal: 10, marginBottom: 6 },
  notice: {
    fontSize: 11, color: '#e0453a', paddingHorizontal: 10, paddingBottom: 2,
  },
  pull: { backgroundColor: COLOR.rule, marginHorizontal: 120, borderRadius: 2 },
});
