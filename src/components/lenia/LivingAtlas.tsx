'use client';

import { useEffect, useRef } from 'react';
import { CREATURES, type Creature } from '@/lib/lenia/creatures';
import { LeniaEngine, PALETTES, paletteColor } from '@/lib/lenia/engine';

/**
 * Живой атлас: каждая карточка — настоящий маленький мир Lenia.
 * Один скрытый WebGL-движок по очереди «оживляет» существ,
 * кадры транслируются в канвы карточек (идея анимированных
 * превью из оригинального демо Бёрта Чана, но всё считается в браузере).
 */

const ATLAS_N = 128;
const SPOTLIGHT_MS = 1100; // сколько времени живёт одна карточка
const STEPS_PER_FRAME = 2;

export function LivingAtlas({
  onArm,
  armedName,
  eco = false,
}: {
  onArm: (c: Creature) => void;
  armedName?: string | null;
  eco?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const onArmRef = useRef(onArm);
  useEffect(() => {
    onArmRef.current = onArm;
  }, [onArm]);

  // Статичные первые кадры — всегда
  useEffect(() => {
    const stops = PALETTES[0].stops;
    const paintStatic = (c: Creature, cv: HTMLCanvasElement) => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(ATLAS_N, ATLAS_N);
      const ox = Math.floor((ATLAS_N - c.w) / 2);
      const oy = Math.floor((ATLAS_N - c.h) / 2);
      for (let y = 0; y < ATLAS_N; y++) {
        for (let x = 0; x < ATLAS_N; x++) {
          const sx = x - ox;
          const sy = y - oy;
          const v = sx >= 0 && sx < c.w && sy >= 0 && sy < c.h ? c.cells[sy * c.w + sx] : 0;
          const t = Math.pow(v, 0.75);
          const [r, g, b] = paletteColor(stops, t);
          const di = (y * ATLAS_N + x) * 4;
          img.data[di] = Math.round(r * 255);
          img.data[di + 1] = Math.round(g * 255);
          img.data[di + 2] = Math.round(b * 255);
          img.data[di + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    CREATURES.forEach((c, i) => {
      const cv = cardRefs.current[i];
      if (cv) paintStatic(c, cv);
    });
  }, []);

  // Живой «прожектор» — оживляет карточки по очереди (кроме эко-режима)
  useEffect(() => {
    if (eco) return;
    const container = containerRef.current;
    if (!container) return;
    const stops = PALETTES[0].stops;

    let engine: LeniaEngine | null = null;
    try {
      const off = document.createElement('canvas');
      engine = new LeniaEngine(
        off,
        ATLAS_N,
        { R: 13, dt: 0.1, m: 0.15, s: 0.015, b: [1], kn: 1, gn: 1 },
        PALETTES[0],
      );
    } catch {
      return; // без WebGL2 карточки остаются статичными
    }
    const eng = engine;

    let visible = true;
    const io = new IntersectionObserver(
      (es) => {
        visible = es[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(container);

    const read = new Float32Array(ATLAS_N * ATLAS_N * 4);
    let idx = 0;
    let raf = 0;
    let lastSwitch = 0;
    let frame = 0;

    const place = (c: Creature) => {
      eng.clear();
      eng.setParams({ R: c.R, dt: 1 / c.T, m: c.m, s: c.s, b: c.b, kn: c.kn, gn: c.gn });
      eng.placeCells(c.w, c.h, Float32Array.from(c.cells), ATLAS_N / 2, ATLAS_N / 2);
    };

    const paintLive = () => {
      const cv = cardRefs.current[idx];
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      eng.readStateInto(read);
      const img = ctx.createImageData(ATLAS_N, ATLAS_N);
      for (let y = 0; y < ATLAS_N; y++) {
        const srcRow = (ATLAS_N - 1 - y) * ATLAS_N; // GL: строка 0 — низ экрана
        for (let x = 0; x < ATLAS_N; x++) {
          const t = Math.pow(read[(srcRow + x) * 4], 0.75);
          const [r, g, b] = paletteColor(stops, t);
          const di = (y * ATLAS_N + x) * 4;
          img.data[di] = Math.round(r * 255);
          img.data[di + 1] = Math.round(g * 255);
          img.data[di + 2] = Math.round(b * 255);
          img.data[di + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (now - lastSwitch > SPOTLIGHT_MS) {
        lastSwitch = now;
        idx = (idx + 1) % CREATURES.length;
        place(CREATURES[idx]);
      }
      for (let k = 0; k < STEPS_PER_FRAME; k++) eng.step();
      frame++;
      if (frame % 3 === 0) paintLive(); // ~20 fps — глазу достаточно
    };

    place(CREATURES[0]);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      eng.destroy();
    };
  }, [eco]);

  return (
    <div ref={containerRef}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
        {CREATURES.map((c, i) => (
          <button
            key={c.name}
            onClick={() => onArmRef.current(c)}
            className={`group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
              armedName === c.name
                ? 'border-emerald-500/70 bg-emerald-950/40'
                : 'border-white/10 bg-white/[0.02] hover:border-emerald-900/60 hover:bg-emerald-950/20'
            }`}
            aria-pressed={armedName === c.name}
            title={c.desc}
          >
            <canvas
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              width={ATLAS_N}
              height={ATLAS_N}
              aria-label={`Живое превью: ${c.ru}`}
              className="h-[68px] w-[68px] shrink-0 rounded-md bg-black"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{c.ru}</span>
              <span className="mt-0.5 block truncate text-[11px] italic leading-tight text-muted-foreground">
                {c.name}
              </span>
              <span className="mt-1 block text-[10px] uppercase tracking-wide text-emerald-500/80">
                {c.kindRu}
                {c.speed >= 0.5 ? ` · ${c.speed.toFixed(1)}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
