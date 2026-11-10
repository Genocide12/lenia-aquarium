'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  SkipForward,
  Dices,
  Trash2,
  RotateCcw,
  Brush,
  Eraser,
  RotateCcwSquare,
  RotateCwSquare,
  FlaskConical,
  Wind,
  Split,
  Footprints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CREATURES, type Creature } from '@/lib/lenia/creatures';
import {
  LeniaEngine,
  PALETTES,
  KERNEL_NAMES,
  GROWTH_NAMES,
  type LeniaParams,
  type Palette,
} from '@/lib/lenia/engine';
import { BlobTracker, type EventKind } from '@/lib/lenia/tracker';
import { LivingAtlas } from '@/components/lenia/LivingAtlas';
import { Journal, type JournalEntry } from '@/components/lenia/Journal';
import { KernelPlot, GrowthPlot } from '@/components/lenia/Plots';
import { HowItWorks } from '@/components/lenia/HowItWorks';

const N = 256;
const SCALE = 3; // пикселей канвы на клетку поля (как в движке)
const ORBIUM = CREATURES[0]; // Orbium unicaudatus
const HYDROGEMINIUM = CREATURES.find((c) => c.name === 'Hydrogeminium saliens')!;

/** Физика орбия — вид, под который настроен первичный бульон (проверено эталоном). */
const ORBIUM_PARAMS: LeniaParams = { R: 13, dt: 0.1, m: 0.15, s: 0.015, b: [1], kn: 1, gn: 1 };

interface SceneDef {
  id: string;
  label: string;
  hint: string;
  speed: number;
  /** Порог массы, ниже которого мир считается погибшим (авто-возрождение). */
  deadBelow: number;
  /** Порог населения: меньше — популяционный коллапс, пересев. */
  minPop?: number;
  /** Льготное время (ед. t) после посева до включения проверок. */
  graceT: number;
  /** Авто-возрождение по умолчанию (у «своего мира» выключено). */
  revive: boolean;
  icon: typeof FlaskConical;
}

const SCENES: SceneDef[] = [
  {
    id: 'soup',
    label: 'Из хаоса — жизнь',
    hint: 'Мир начался со случайного шума. Понаблюдайте минуту: существа соберутся сами собой — это и есть главное чудо Lenia. Жёлто-зелёные точки — следы, по ним видно, куда кто плывёт.',
    speed: 3,
    deadBelow: 800,
    minPop: 25,
    graceT: 120,
    revive: true,
    icon: FlaskConical,
  },
  {
    id: 'shower',
    label: 'Встречные потоки',
    hint: 'Десять существ плывут в разных направлениях. На торе встречные пути неизбежно пересекаются: лобовые удары, слияния, потери — и выжившие. Смотрите на дневник справа.',
    speed: 2,
    deadBelow: 60,
    minPop: 3,
    graceT: 40,
    revive: true,
    icon: Wind,
  },
  {
    id: 'division',
    label: 'Рождение',
    hint: 'Один организм растёт, перетягивается и делится надвое — так здесь появляются новые жители. Потомки расходятся, встречаются и сливаются вновь: цикл длится неограниченно.',
    speed: 8,
    deadBelow: 100,
    graceT: 80,
    revive: true,
    icon: Split,
  },
  {
    id: 'artist',
    label: 'Свой мир',
    hint: 'Чистое поле — ваш аквариум. Рисуйте «живое вещество» кистью, сажайте существ из живого атласа справа. У каждого вида своя физика: посадите чужака — прежним жителям придётся туго.',
    speed: 2,
    deadBelow: 0,
    graceT: 1e9,
    revive: false,
    icon: Brush,
  },
];

/** Детерминированный PRNG для воспроизводимых сцен (mulberry32). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function creatureParams(c: Creature): LeniaParams {
  return { R: c.R, dt: 1 / c.T, m: c.m, s: c.s, b: c.b, kn: c.kn, gn: c.gn };
}

/** Rotate a creature pattern by 90° increments (Lenia is rotation-equivariant). */
function rotateCells(cells: number[], w: number, h: number, quarterTurns: number): { cells: number[]; w: number; h: number } {
  let cur = cells.slice();
  let cw = w;
  let ch = h;
  for (let t = 0; t < ((quarterTurns % 4) + 4) % 4; t++) {
    const next = new Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        next[x * ch + (ch - 1 - y)] = cur[y * cw + x];
      }
    }
    cur = next;
    const tmp = cw;
    cw = ch;
    ch = tmp;
  }
  return { cells: cur, w: cw, h: ch };
}

/* ---------- Оверлей: следы и события ---------- */

const TRAIL_COLORS = ['#34d399', '#fbbf24', '#f472b6', '#2dd4bf', '#a3e635', '#fb923c'];
const GLOW_COLORS: Record<EventKind, string> = {
  birth: '#34d399',
  split: '#a3e635',
  merge: '#fbbf24',
  death: '#fb7185',
};
const GLOW_MS = 1500;

interface Glow {
  kind: EventKind;
  x: number;
  y: number;
  born: number;
}

interface JournalSnap {
  pop: number;
  popDelta: number;
  totals: { births: number; deaths: number; merges: number; splits: number };
  entries: JournalEntry[];
  history: { t: number; pop: number }[];
  tick: number;
}

const EMPTY_SNAP: JournalSnap = {
  pop: 0,
  popDelta: 0,
  totals: { births: 0, deaths: 0, merges: 0, splits: 0 },
  entries: [],
  history: [],
  tick: 0,
};

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LeniaEngine | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(true);
  const speedRef = useRef(4);
  const simTimeRef = useRef(0);
  const stepAccRef = useRef(0);
  const armedRef = useRef<Creature | null>(null);
  const rotRef = useRef(0);
  const brushRef = useRef({ radius: 10, strength: 0.85, erase: false });
  const paintingRef = useRef(false);
  const lastPtRef = useRef<[number, number] | null>(null);
  const frameCountRef = useRef(0);
  const fpsRef = useRef(0);
  const lastFrameRef = useRef(0);
  /** Состояние авто-возрождения: счётчик «тощих» замеров и снимок для детекта «замершего» мира. */
  const reviveStateRef = useRef({ lowFrames: 0, snapMass: -1, snapCx: 0, snapCy: 0, snapM2: 0 });
  const autoReviveRef = useRef(true);
  const presetIdRef = useRef('soup');
  const trackerRef = useRef(new BlobTracker(N));
  const glowsRef = useRef<Glow[]>([]);
  const journalRef = useRef<JournalEntry[]>([]);
  const entryIdRef = useRef(1);
  const firstScanRef = useRef(true);
  const lastSnapPopRef = useRef<number | null>(null);
  const lastJournalPushRef = useRef(0);
  const trailsRef = useRef(true);

  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [params, setParams] = useState<LeniaParams>(() => creatureParams(ORBIUM));
  const [paletteId, setPaletteId] = useState('bio');
  const [armed, setArmed] = useState<Creature | null>(null);
  const [rot, setRot] = useState(0);
  const [presetId, setPresetId] = useState('soup');
  const [physicsLabel, setPhysicsLabel] = useState('Орбий · Orbium unicaudatus');
  const [brush, setBrush] = useState({ radius: 10, strength: 0.85, erase: false });
  const [stats, setStats] = useState({ t: 0, mass: 0, pop: 0, fps: 0 });
  const [autoRevive, setAutoRevive] = useState(true);
  const [revives, setRevives] = useState(0);
  const [trails, setTrails] = useState(true);
  const [journalSnap, setJournalSnap] = useState<JournalSnap>(EMPTY_SNAP);
  const [eco, setEco] = useState(false);
  const ecoRef = useRef(false);
  const tickRef = useRef(0);
  const paramsRef = useRef(params);

  /** Ручная правка мира отключает авто-возрождение (не спорим с пользователем). */
  const manualEdit = useCallback(() => {
    autoReviveRef.current = false;
    setAutoRevive(false);
  }, []);

  const applyParams = useCallback((patch: Partial<LeniaParams>, label?: string) => {
    manualEdit();
    setParams((prev) => {
      const next = { ...prev, ...patch };
      engineRef.current?.setParams(patch);
      return next;
    });
    setPhysicsLabel(label ?? 'кастомная (ползунки)');
  }, [manualEdit]);

  const pushJournal = useCallback((kind: EventKind | 'info', count: number, t: number, text?: string) => {
    journalRef.current = [
      { id: entryIdRef.current++, kind, count, t, text },
      ...journalRef.current,
    ].slice(0, 9);
  }, []);

  const pushJournalSnapshot = useCallback((pop: number) => {
    const tr = trackerRef.current;
    const delta = lastSnapPopRef.current === null ? 0 : pop - lastSnapPopRef.current;
    lastSnapPopRef.current = pop;
    setJournalSnap({
      pop,
      popDelta: delta,
      totals: { births: tr.births, deaths: tr.deaths, merges: tr.merges, splits: tr.splits },
      entries: [...journalRef.current],
      history: [...tr.popHistory],
      tick: ++tickRef.current,
    });
  }, []);

  /** Seed one of the curated scenes. `vary` adds randomness so revived scenes differ. */
  const seedScene = useCallback((id: string, eng: LeniaEngine, vary = false) => {
    eng.clear();
    simTimeRef.current = 0;
    stepAccRef.current = 0;
    armedRef.current = null;
    setArmed(null);
    setRot(0);
    rotRef.current = 0;
    const scene = SCENES.find((s) => s.id === id) ?? SCENES[0];
    if (id === 'division') {
      eng.setParams(creatureParams(HYDROGEMINIUM));
      setParams(creatureParams(HYDROGEMINIUM));
      setPhysicsLabel(`Гидроблизнецы · ${HYDROGEMINIUM.name}`);
      eng.placeCells(HYDROGEMINIUM.w, HYDROGEMINIUM.h, Float32Array.from(HYDROGEMINIUM.cells), N / 2, N / 2);
    } else if (id === 'shower') {
      eng.setParams(ORBIUM_PARAMS);
      setParams(ORBIUM_PARAMS);
      setPhysicsLabel('Орбий · Orbium unicaudatus');
      // 10 орбиев: случайные позиции (с зазором) и случайные курсы — столкновения неизбежны
      const rng = mulberry32(vary ? (Math.random() * 0x7fffffff) | 0 : 20261110);
      const placed: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        let x = N / 2;
        let y = N / 2;
        for (let tries = 0; tries < 80; tries++) {
          x = 26 + rng() * (N - 52);
          y = 26 + rng() * (N - 52);
          if (placed.every(([px, py]) => Math.hypot(px - x, py - y) > 36)) break;
        }
        placed.push([x, y]);
        const rc = rotateCells(ORBIUM.cells, ORBIUM.w, ORBIUM.h, Math.floor(rng() * 4));
        eng.placeCells(rc.w, rc.h, Float32Array.from(rc.cells), x, y);
      }
    } else if (id === 'artist') {
      eng.setParams(ORBIUM_PARAMS);
      setParams(ORBIUM_PARAMS);
      setPhysicsLabel('Орбий · Orbium unicaudatus');
      // чистое поле — жизнь нарисует пользователь
    } else {
      // 'soup' — умолчание: первичный бульон, жизнь возникает из шума
      eng.setParams(ORBIUM_PARAMS);
      setParams(ORBIUM_PARAMS);
      setPhysicsLabel('Орбий · Orbium unicaudatus');
      eng.randomize();
    }
    // сброс наблюдателя
    trackerRef.current.reset();
    glowsRef.current = [];
    journalRef.current = [];
    firstScanRef.current = true;
    lastSnapPopRef.current = null;
    reviveStateRef.current = { lowFrames: 0, snapMass: -1, snapCx: 0, snapCy: 0, snapM2: 0 };
    setSpeed(ecoRef.current ? 1 : scene.speed);
    speedRef.current = ecoRef.current ? 1 : scene.speed;
    // «свой мир» — творчество без надзора, сцены — с авто-возрождением
    autoReviveRef.current = scene.revive;
    setAutoRevive(scene.revive);
    setPresetId(id);
    setRunning(true);
    runningRef.current = true;
    setStats({ t: 0, mass: 0, pop: 0, fps: fpsRef.current });
    pushJournal('info', 0, 0, SCENES.find((s) => s.id === id)?.label ?? '');
  }, [pushJournal]);

  // Engine lifecycle + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: LeniaEngine;
    try {
      engine = new LeniaEngine(canvas, N, creatureParams(ORBIUM), PALETTES[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(msg));
      return;
    }
    engineRef.current = engine;
    const octx = overlayRef.current?.getContext('2d') ?? null;

    // — Замер производительности: программный рендер (без GPU) получает эко-режим —
    const measureSteps = (n: number) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) engine.step();
      engine.getStats(); // форсируем исполнение отложенных draw-вызовов
      return (performance.now() - t0) / n;
    };
    try {
      measureSteps(1); // прогрев: компиляция шейдеров
      const ms = measureSteps(2);
      if (ms > 40) {
        ecoRef.current = true;
        queueMicrotask(() => setEco(true));
      }
    } catch {
      /* замер не критичен */
    }

    queueMicrotask(() => seedScene('soup', engine));

    // — Кадр наблюдения: статистика, трекер, дневник, авто-возрождение —
    const doScan = (now: number, stepsSince: number) => {
      const st = engine.getStats();
      setStats({
        t: simTimeRef.current,
        mass: st.mass,
        pop: st.population,
        fps: fpsRef.current,
      });

      const events = trackerRef.current.update(st.blobs, simTimeRef.current, stepsSince);
      if (firstScanRef.current) {
        firstScanRef.current = false;
        pushJournal(
          'info',
          0,
          simTimeRef.current,
          st.population > 0
            ? `Мир заселён: ${st.population} ${plural(st.population)}`
            : 'Мир чист — жизнь ещё не возникла',
        );
      } else if (events.length > 0 && !paintingRef.current) {
        const byKind = new Map<EventKind, number>();
        for (const ev of events) byKind.set(ev.kind, (byKind.get(ev.kind) ?? 0) + 1);
        for (const [kind, count] of byKind) {
          pushJournal(kind, count, simTimeRef.current);
        }
        for (const ev of events.slice(0, 3)) {
          glowsRef.current.push({ kind: ev.kind, x: ev.x, y: ev.y, born: now });
        }
      }

      // снапшот дневника не чаще ~3 раз в секунду
      if (now - lastJournalPushRef.current > 330) {
        lastJournalPushRef.current = now;
        pushJournalSnapshot(st.population);
      }

      // — Авто-возрождение мира —
      const rv = reviveStateRef.current;
      const scene = SCENES.find((s) => s.id === presetIdRef.current) ?? SCENES[0];
      const inGrace = simTimeRef.current < scene.graceT;
      if (autoReviveRef.current && runningRef.current && !paintingRef.current && !inGrace) {
        const dead = st.mass < scene.deadBelow;
        const collapsed = scene.minPop !== undefined && st.population < scene.minPop;
        if (dead || collapsed) {
          rv.lowFrames++;
        } else {
          rv.lowFrames = 0;
        }
        // замерший мир: масса, центроид и разброс массы почти не меняются несколько секунд
        if (rv.snapMass >= 0) {
          const dx = Math.min(Math.abs(st.cx - rv.snapCx), N - Math.abs(st.cx - rv.snapCx));
          const dy = Math.min(Math.abs(st.cy - rv.snapCy), N - Math.abs(st.cy - rv.snapCy));
          const frozen =
            Math.abs(st.mass - rv.snapMass) < 0.8 &&
            Math.hypot(dx, dy) < 2.5 &&
            Math.abs(st.mom2 - rv.snapM2) < 25 &&
            st.mass > 30;
          if (frozen) rv.lowFrames += 3; // замер — возрождаем быстрее
        }
        if (rv.snapMass < 0 || frameCountRef.current % 240 === 0) {
          rv.snapMass = st.mass;
          rv.snapCx = st.cx;
          rv.snapCy = st.cy;
          rv.snapM2 = st.mom2;
        }
        if (rv.lowFrames >= 12) {
          // мир тощ, замер или малолюден — пересеваем с вариациями
          seedScene(presetIdRef.current, engine, true);
          setRevives((n) => n + 1);
        }
      }
    };

    // Отладочный/e2e-хук: позволяет прогнать симуляцию быстро и без рендера
    (window as unknown as { __lenia?: object }).__lenia = {
      stepN: (n: number) => {
        let done = 0;
        while (done < n) {
          const chunk = Math.min(24, n - done);
          for (let i = 0; i < chunk; i++) engine.step();
          done += chunk;
          simTimeRef.current += chunk * paramsRef.current.dt;
          doScan(performance.now(), chunk);
        }
      },
      stats: () => engine.getStats(),
      seed: (sid: string) => seedScene(sid, engine),
      setSpeed: (v: number) => {
        speedRef.current = Math.max(1, Math.min(16, Math.round(v)));
      },
      headings: () => trackerRef.current.headings(),
      journal: () => ({
        entries: [...journalRef.current],
        totals: {
          births: trackerRef.current.births,
          deaths: trackerRef.current.deaths,
          merges: trackerRef.current.merges,
          splits: trackerRef.current.splits,
        },
        history: [...trackerRef.current.popHistory],
      }),
    };

    const drawOverlay = (now: number) => {
      const cv = overlayRef.current;
      if (!cv || !octx) return;
      const S = N * SCALE;
      if (cv.width !== S || cv.height !== S) {
        cv.width = S;
        cv.height = S;
      }
      octx.clearRect(0, 0, S, S);

      if (trailsRef.current) {
        // следы: 6 сегментов на трек с нарастающей яркостью
        for (const tr of trackerRef.current.getTracks()) {
          if (tr.trail.length < 3) continue;
          const color = TRAIL_COLORS[tr.id % TRAIL_COLORS.length];
          const pts = tr.trail;
          const chunks = 6;
          const per = Math.max(1, Math.floor((pts.length - 1) / chunks));
          octx.strokeStyle = color;
          octx.lineCap = 'round';
          for (let c = 0; c < chunks; c++) {
            const i0 = c * per;
            const i1 = Math.min(pts.length - 1, (c + 1) * per);
            if (i1 <= i0) continue;
            const a = (c + 1) / chunks;
            octx.globalAlpha = 0.06 + 0.34 * a * a;
            octx.lineWidth = 1 + 1.6 * a;
            octx.beginPath();
            let started = false;
            for (let i = i0; i <= i1; i++) {
              const px = (pts[i].x + 0.5) * SCALE;
              const py = (N - pts[i].y - 0.5) * SCALE;
              if (!started) {
                octx.moveTo(px, py);
                started = true;
              } else {
                // разрыв на границе тора
                const ddx = Math.abs(pts[i].x - pts[i - 1].x);
                const ddy = Math.abs(pts[i].y - pts[i - 1].y);
                if (ddx > N / 2 || ddy > N / 2) {
                  octx.moveTo(px, py);
                } else {
                  octx.lineTo(px, py);
                }
              }
            }
            octx.stroke();
          }
          // яркая «голова»
          const h = pts[pts.length - 1];
          octx.globalAlpha = 0.85;
          octx.fillStyle = color;
          octx.beginPath();
          octx.arc((h.x + 0.5) * SCALE, (N - h.y - 0.5) * SCALE, 2.2, 0, Math.PI * 2);
          octx.fill();
        }
        octx.globalAlpha = 1;
      }

      // вспышки событий (возраст клампим: rAF-таймстамп может отставать
      // после долгих блокировок главного потока)
      glowsRef.current = glowsRef.current.filter(
        (g) => now - g.born < 2 * GLOW_MS && Math.abs(now - g.born) < 60_000,
      );
      for (const g of glowsRef.current) {
        const age = Math.min(1, Math.max(0, (now - g.born) / GLOW_MS));
        const r = (3 + age * 26) * SCALE;
        octx.globalAlpha = (1 - age) * 0.85;
        octx.strokeStyle = GLOW_COLORS[g.kind];
        octx.lineWidth = 2.5 * (1 - age) + 0.5;
        octx.beginPath();
        octx.arc((g.x + 0.5) * SCALE, (N - g.y - 0.5) * SCALE, r, 0, Math.PI * 2);
        octx.stroke();
      }
      octx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      const eng = engineRef.current;
      if (eng) {
        try {
          if (lastFrameRef.current) {
            const dtms = now - lastFrameRef.current;
            if (dtms > 0 && dtms < 2000) {
              fpsRef.current = fpsRef.current === 0 ? 1000 / dtms : fpsRef.current * 0.9 + (1000 / dtms) * 0.1;
            }
          }
          lastFrameRef.current = now;
          const spd = speedRef.current;
          if (runningRef.current) {
            for (let i = 0; i < spd; i++) eng.step();
            simTimeRef.current += spd * paramsRef.current.dt;
            stepAccRef.current += spd;
          }
          eng.render();
          drawOverlay(now);
          frameCountRef.current++;

          // — кадр наблюдения: каждые 24 шага (48 на высокой скорости) —
          const every = spd > 6 ? 48 : 24;
          if (stepAccRef.current >= every) {
            const stepsSince = stepAccRef.current;
            stepAccRef.current = 0;
            doScan(now, stepsSince);
          }
        } catch (err) {
          runningRef.current = false;
          const msg = err instanceof Error ? err.message : String(err);
          queueMicrotask(() => {
            setError(msg);
            setRunning(false);
          });
          return; // stop the loop on error instead of dying silently
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      engine.destroy();
      engineRef.current = null;
    };
  }, [seedScene, pushJournal, pushJournalSnapshot]);

  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    autoReviveRef.current = autoRevive;
  }, [autoRevive]);
  useEffect(() => {
    presetIdRef.current = presetId;
  }, [presetId]);
  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);
  useEffect(() => {
    rotRef.current = rot;
  }, [rot]);
  useEffect(() => {
    trailsRef.current = trails;
  }, [trails]);

  // Palette
  useEffect(() => {
    const pal = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
    engineRef.current?.setPalette(pal);
  }, [paletteId]);

  // Wheel over canvas rotates the armed creature (non-passive to prevent page scroll)
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      if (!armedRef.current) return;
      e.preventDefault();
      setRot((r) => (r + (e.deltaY > 0 ? 90 : -90) + 360) % 360);
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRunning((r) => !r);
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        manualEdit();
        engineRef.current?.randomize();
      } else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
        manualEdit();
        engineRef.current?.clear();
      } else if (e.key === 'q' || e.key === 'Q' || e.key === 'й' || e.key === 'Й') {
        if (armedRef.current) setRot((r) => (r + 270) % 360);
      } else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
        if (armedRef.current) setRot((r) => (r + 90) % 360);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualEdit]);

  const toGrid = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const gx = ((e.clientX - rect.left) / rect.width) * N;
    const gy = (1 - (e.clientY - rect.top) / rect.height) * N;
    return [gx, gy];
  };

  const paintStroke = (from: [number, number], to: [number, number], erase: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    const { radius, strength } = brushRef.current;
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      eng.paint(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, radius, strength, erase);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = toGrid(e);
    const c = armedRef.current;
    if (c) {
      const rc = rotateCells(c.cells, c.w, c.h, rotRef.current / 90);
      engineRef.current?.placeCells(rc.w, rc.h, Float32Array.from(rc.cells), pt[0], pt[1]);
      if (!e.shiftKey) {
        armedRef.current = null;
        setArmed(null);
      }
      return;
    }
    paintingRef.current = true;
    manualEdit();
    lastPtRef.current = pt;
    paintStroke(pt, pt, brushRef.current.erase || e.button === 2);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return;
    const pt = toGrid(e);
    const last = lastPtRef.current ?? pt;
    paintStroke(last, pt, brushRef.current.erase || e.buttons === 2);
    lastPtRef.current = pt;
  };

  const onPointerUp = () => {
    paintingRef.current = false;
    lastPtRef.current = null;
  };

  const armCreature = (c: Creature) => {
    armedRef.current = c;
    setArmed(c);
    setRot(0);
    rotRef.current = 0;
    applyParams(creatureParams(c), `${c.ru} · ${c.name}`);
  };

  const scene = SCENES.find((p) => p.id === presetId) ?? SCENES[0];

  return (
    <div
      className="dark flex min-h-screen flex-col text-neutral-100"
      style={
        {
          '--background': '#05090b',
          '--card': '#0b1210',
          '--popover': '#0d1512',
          '--border': 'rgba(255,255,255,0.09)',
          '--input': 'rgba(255,255,255,0.12)',
          '--muted': '#101915',
          '--muted-foreground': '#8ba79a',
          '--secondary': '#0f1a15',
          '--secondary-foreground': '#d7efe2',
          '--accent': '#122019',
          '--accent-foreground': '#d7efe2',
          '--primary': '#10b981',
          '--primary-foreground': '#032015',
          '--ring': '#10b981',
        } as React.CSSProperties
      }
    >
      <header className="border-b border-white/5">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="bg-gradient-to-r from-emerald-300 via-teal-200 to-lime-200 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
                  Ления
                </h1>
                <p className="text-lg font-medium text-emerald-200/80 sm:text-xl">живой аквариум</p>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                Цифровые существа, которые рождаются, плавают, сталкиваются и исчезают —
                по трём математическим правилам. Прямо в вашем браузере, без установки.
                Понятно в любом возрасте: просто смотрите и наблюдайте.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-emerald-800/60 text-emerald-400">
                {CREATURES.length} видов из оригинальной библиотеки
              </Badge>
              <a
                href="#how"
                className="rounded-full border border-emerald-800/60 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-950/40"
              >
                Как это работает?
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:py-8">
        {error ? (
          <Card className="border-destructive/40 p-6">
            <p className="font-medium text-destructive">Симуляция остановлена из-за ошибки</p>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </Card>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* ======== Левая колонка: сцена ======== */}
            <div>
              {/* Режимы-каналы */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Режим наблюдения">
                {SCENES.map((s) => {
                  const Icon = s.icon;
                  const active = presetId === s.id;
                  return (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={active}
                      data-mode={s.id}
                      onClick={() => {
                        const eng = engineRef.current;
                        if (eng) seedScene(s.id, eng);
                      }}
                      className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors sm:gap-3 ${
                        active
                          ? 'border-emerald-500/70 bg-emerald-950/50 shadow-[0_0_24px_rgba(16,185,129,0.12)]'
                          : 'border-white/10 bg-white/[0.02] hover:border-emerald-900/60 hover:bg-emerald-950/20'
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-emerald-300' : 'text-emerald-500/70'}`} aria-hidden />
                      <span className="min-w-0 min-h-[2.5rem] flex items-center">
                        <span className={`block text-sm font-semibold leading-tight ${active ? 'text-emerald-100' : 'text-neutral-100'}`}>
                          {s.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Аквариум */}
              <Card className="mt-3 overflow-hidden border-white/10 p-2 sm:p-3">
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    className={`aspect-square w-full touch-none select-none ${armed ? 'cursor-crosshair' : 'cursor-cell'}`}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-label="Поле симуляции Ления"
                  />
                  <canvas
                    ref={overlayRef}
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    aria-hidden
                  />

                  {/* HUD: жители */}
                  <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
                    <div className="rounded-xl border border-emerald-500/30 bg-black/65 px-3.5 py-2 backdrop-blur">
                      <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">жителей</p>
                      <p
                        data-testid="pop-count"
                        key={journalSnap.pop}
                        className={`text-2xl font-extrabold leading-none tabular-nums ${
                          journalSnap.popDelta > 0
                            ? 'text-emerald-300'
                            : journalSnap.popDelta < 0
                              ? 'text-rose-300'
                              : 'text-neutral-100'
                        }`}
                      >
                        {stats.pop}
                      </p>
                    </div>
                    {!running && (
                      <div className="rounded-full border border-amber-500/40 bg-black/70 px-3 py-1 text-xs font-semibold text-amber-300 backdrop-blur">
                        Пауза — нажмите «Пуск» или пробел
                      </div>
                    )}
                  </div>

                  {/* HUD: время и масса */}
                  <div className="pointer-events-none absolute right-3 top-3 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 font-mono text-[11px] tabular-nums text-emerald-200/80 backdrop-blur" data-testid="stats">
                    t = {stats.t.toFixed(0)} · M = {stats.mass.toFixed(0)} · {stats.fps.toFixed(0)} FPS
                    {revives > 0 && (
                      <span className="ml-1 text-emerald-400/80" title="Сколько раз мир сам пересеял погибшую или замершую сцену">
                        ↻ {revives}
                      </span>
                    )}
                  </div>

                  {/* HUD: физика */}
                  <div className="pointer-events-none absolute bottom-3 left-3 max-w-[75%] rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
                    физика мира: {physicsLabel}
                  </div>

                  {/* Подсказка при посадке */}
                  {armed && (
                    <div className="pointer-events-none absolute bottom-3 right-3 flex flex-wrap items-center justify-end gap-2">
                      <div className="rounded-full border border-emerald-500/40 bg-black/70 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur">
                        «{armed.ru}» · клик — посадить
                        <span className="text-emerald-500/70">(Shift — несколько)</span>
                        {` · поворот ${rot}°`}
                      </div>
                      <div className="pointer-events-auto flex gap-1">
                        <button
                          onClick={() => setRot((r) => (r + 270) % 360)}
                          className="rounded-full border border-emerald-500/40 bg-black/70 p-1.5 text-emerald-300 backdrop-blur transition-colors hover:bg-emerald-950/60"
                          aria-label="Повернуть против часовой стрелки"
                        >
                          <RotateCcwSquare className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setRot((r) => (r + 90) % 360)}
                          className="rounded-full border border-emerald-500/40 bg-black/70 p-1.5 text-emerald-300 backdrop-blur transition-colors hover:bg-emerald-950/60"
                          aria-label="Повернуть по часовой стрелке"
                        >
                          <RotateCwSquare className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Панель управления */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => setRunning((r) => !r)}
                  variant={running ? 'secondary' : 'default'}
                  size="lg"
                  className="gap-2 px-5"
                  aria-label={running ? 'Пауза' : 'Продолжить'}
                >
                  {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {running ? 'Пауза' : 'Пуск'}
                </Button>
                <Button
                  onClick={() => {
                    if (!running) {
                      engineRef.current?.step();
                      simTimeRef.current += paramsRef.current.dt;
                    }
                  }}
                  variant="secondary"
                  size="lg"
                  className="gap-2"
                  disabled={running}
                  aria-label="Один шаг"
                >
                  <SkipForward className="h-4 w-4" />
                  Шаг
                </Button>
                <Button
                  onClick={() => {
                    manualEdit();
                    engineRef.current?.randomize();
                  }}
                  variant="secondary"
                  size="lg"
                  className="gap-2"
                  aria-label="Случайное поле"
                >
                  <Dices className="h-4 w-4" />
                  Случайное
                </Button>
                <Button
                  onClick={() => {
                    manualEdit();
                    engineRef.current?.clear();
                  }}
                  variant="secondary"
                  size="lg"
                  className="gap-2"
                  aria-label="Очистить поле"
                >
                  <Trash2 className="h-4 w-4" />
                  Очистить
                </Button>
                <Button
                  onClick={() => {
                    const eng = engineRef.current;
                    if (eng) seedScene(presetIdRef.current, eng);
                  }}
                  variant="secondary"
                  size="lg"
                  className="gap-2"
                  aria-label="Перезапустить сцену"
                >
                  <RotateCcw className="h-4 w-4" />
                  Заново
                </Button>

                <div className="ml-auto flex min-w-44 items-center gap-3">
                  <span className="whitespace-nowrap text-sm font-medium tabular-nums text-muted-foreground">
                    ×{speed}
                  </span>
                  <Slider
                    value={[speed]}
                    onValueChange={([v]) => setSpeed(v)}
                    min={1}
                    max={16}
                    step={1}
                    aria-label="Скорость симуляции"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Footprints className="h-4 w-4 text-emerald-500/80" aria-hidden />
                  <span id="trails-label" className="whitespace-nowrap text-sm text-muted-foreground">
                    Следы жителей
                  </span>
                  <Switch checked={trails} onCheckedChange={setTrails} aria-labelledby="trails-label" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-sm text-muted-foreground">Палитра</span>
                    <Select value={paletteId} onValueChange={setPaletteId}>
                      <SelectTrigger className="h-9 w-40" aria-label="Цветовая палитра">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PALETTES.map((p: Palette) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div
                  className="flex cursor-pointer select-none items-center gap-2"
                  title="Если мир вымер или застыл — пересеять сцену заново. Ручные правки поля отключают возрождение"
                >
                  <span id="auto-revive-label" className="whitespace-nowrap text-sm text-muted-foreground">
                    Возрождение мира
                  </span>
                  <Switch checked={autoRevive} onCheckedChange={setAutoRevive} aria-labelledby="auto-revive-label" />
                </div>
              </div>

              {/* Эко-режим: браузер без аппаратного ускорения */}
              {eco && (
                <div className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3" data-testid="eco-banner">
                  <p className="text-sm leading-relaxed text-amber-200/90">
                    Ваш браузер работает без аппаратного ускорения графики — включён экономный
                    режим: мир идёт медленнее, но всё живёт по тем же правилам. На компьютере с
                    GPU всё будет быстро. Атлас существ на время останется статичным.
                  </p>
                </div>
              )}

              {/* Подсказка «что я вижу» */}
              <div className="mt-3 rounded-lg border border-emerald-900/30 bg-emerald-950/15 px-4 py-3">
                <p className="text-sm leading-relaxed text-emerald-100/90">
                  <span className="font-semibold text-emerald-300">{scene.label}: </span>
                  {scene.hint}
                </p>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Кисть: тяните мышью — рисуете живое вещество, правая кнопка — стираете.
                Пробел — пауза, R — случайное поле, C — очистить, Q/E — поворот существа.
              </p>
            </div>

            {/* ======== Правая колонка: наблюдения ======== */}
            <div className="flex flex-col gap-4">
              <Card className="border-white/10 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Дневник наблюдений
                </h2>
                <div className="mt-3">
                  <Journal
                    pop={journalSnap.pop}
                    popDelta={journalSnap.popDelta}
                    totals={journalSnap.totals}
                    entries={journalSnap.entries}
                    history={journalSnap.history}
                    tick={journalSnap.tick}
                  />
                </div>
              </Card>

              <Card className="border-white/10 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Живой атлас
                  </h2>
                  <span className="text-[11px] text-muted-foreground">кликните — потом по полю</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Каждая карточка — настоящий маленький мир: существа по очереди «оживают»
                  прямо в атласе. У каждого вида своя физика, поэтому в одном мире устойчиво
                  живут только родственные виды.
                </p>
                <div className="mt-3">
                  <LivingAtlas onArm={armCreature} armedName={armed?.name} eco={eco} />
                </div>
                {armed && (
                  <p className="mt-3 rounded-md border border-emerald-900/40 bg-emerald-950/20 p-2.5 text-xs leading-relaxed text-emerald-200/90">
                    {armed.desc}
                  </p>
                )}
              </Card>

              <Accordion type="single" collapsible className="border-white/10">
                <AccordionItem value="physics" className="border-b-0">
                  <AccordionTrigger className="py-3 text-sm font-bold uppercase tracking-wider text-muted-foreground hover:no-underline">
                    Для любознательных: законы природы
                  </AccordionTrigger>
                  <AccordionContent className="space-y-5 pb-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="mu" className="text-xs">μ — центр роста</Label>
                        <span className="font-mono text-xs text-emerald-400">{params.m.toFixed(3)}</span>
                      </div>
                      <Slider
                        id="mu"
                        value={[params.m]}
                        onValueChange={([v]) => applyParams({ m: v })}
                        min={0.05}
                        max={0.45}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="sigma" className="text-xs">σ — ширина роста</Label>
                        <span className="font-mono text-xs text-emerald-400">{params.s.toFixed(3)}</span>
                      </div>
                      <Slider
                        id="sigma"
                        value={[params.s]}
                        onValueChange={([v]) => applyParams({ s: v })}
                        min={0.005}
                        max={0.08}
                        step={0.001}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="R" className="text-xs">R — радиус ядра</Label>
                        <span className="font-mono text-xs text-emerald-400">{params.R}</span>
                      </div>
                      <Slider
                        id="R"
                        value={[params.R]}
                        onValueChange={([v]) => applyParams({ R: Math.round(v) })}
                        min={5}
                        max={30}
                        step={1}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="dt" className="text-xs">Δt — шаг времени</Label>
                        <span className="font-mono text-xs text-emerald-400">{params.dt.toFixed(3)}</span>
                      </div>
                      <Slider
                        id="dt"
                        value={[params.dt]}
                        onValueChange={([v]) => applyParams({ dt: v })}
                        min={0.02}
                        max={0.25}
                        step={0.005}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Ядро</Label>
                        <Select
                          value={String(params.kn)}
                          onValueChange={(v) => applyParams({ kn: Number(v) })}
                        >
                          <SelectTrigger className="mt-1.5 h-8 w-full" aria-label="Форма ядра">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(KERNEL_NAMES).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Рост</Label>
                        <Select
                          value={String(params.gn)}
                          onValueChange={(v) => applyParams({ gn: Number(v) })}
                        >
                          <SelectTrigger className="mt-1.5 h-8 w-full" aria-label="Функция роста">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(GROWTH_NAMES).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <KernelPlot R={params.R} b={params.b} kn={params.kn} />
                      </div>
                      <div>
                        <GrowthPlot m={params.m} s={params.s} gn={params.gn} />
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Ползунки меняют законы природы на лету. Слишком большой Δt «взбалтывает»
                      мир, маленькая σ делает организмы хрупкими, а μ задаёт плотность, при
                      которой жизнь вообще возможна. Сдвинули — и вернуться к «родной» физике
                      вида можно, посадив его заново из атласа.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="brush" className="border-b-0">
                  <AccordionTrigger className="py-3 text-sm font-bold uppercase tracking-wider text-muted-foreground hover:no-underline">
                    Кисть художника
                  </AccordionTrigger>
                  <AccordionContent className="space-y-5 pb-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="brushR" className="text-xs">Радиус кисти</Label>
                        <span className="font-mono text-xs text-emerald-400">{brush.radius} кл.</span>
                      </div>
                      <Slider
                        id="brushR"
                        value={[brush.radius]}
                        onValueChange={([v]) => setBrush((b) => ({ ...b, radius: v }))}
                        min={2}
                        max={40}
                        step={1}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <Label htmlFor="brushS" className="text-xs">Сила</Label>
                        <span className="font-mono text-xs text-emerald-400">{brush.strength.toFixed(2)}</span>
                      </div>
                      <Slider
                        id="brushS"
                        value={[brush.strength]}
                        onValueChange={([v]) => setBrush((b) => ({ ...b, strength: v }))}
                        min={0.1}
                        max={1}
                        step={0.05}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {brush.erase ? (
                          <Eraser className="h-4 w-4 text-amber-400" />
                        ) : (
                          <Brush className="h-4 w-4 text-emerald-400" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{brush.erase ? 'Ластик' : 'Рисование'}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {brush.erase ? 'стирает вещество с поля' : 'добавляет живое вещество'}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={brush.erase}
                        onCheckedChange={(v) => setBrush((b) => ({ ...b, erase: v }))}
                        aria-label="Режим ластика"
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Порисуйте поверх существа — и посмотрите, как оно{' '}
                      <span className="text-emerald-300">самовосстанавливается</span>: организмы
                      Лении умеют залечивать раны, если повреждение не слишком велико.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        )}

        <HowItWorks />
      </main>

      <footer className="mt-auto border-t border-white/5">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground">
          <span>
            Ления — проект Bert Wang-Chak Chan · существа и формулы из оригинальной
            библиотеки (Chakazul/Lenia)
          </span>
          <span className="flex items-center gap-3">
            <a
              href="https://github.com/Genocide12/lenia-aquarium"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 transition-colors hover:text-emerald-300"
            >
              Исходники аквариума ↗
            </a>
            <span>Next.js + WebGL2 · проверено эталонной симуляцией (NumPy)</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Простая форма множественного числа для «житель/жителя/жителей». */
function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'житель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'жителя';
  return 'жителей';
}
