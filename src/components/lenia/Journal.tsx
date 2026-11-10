'use client';

import { useEffect, useRef } from 'react';
import { Egg, Wind, Merge, Split, Sparkles, type LucideIcon } from 'lucide-react';
import type { EventKind } from '@/lib/lenia/tracker';

/**
 * Дневник наблюдений: главный экран «кто сейчас жив».
 * Крупные цифры и простые слова — понятно и ребёнку, и взрослому.
 */

export interface JournalEntry {
  id: number;
  kind: EventKind | 'info';
  count: number;
  t: number;
  text?: string; // для info-записей
}

const KIND_META: Record<EventKind | 'info', { icon: LucideIcon; color: string; text: (n: number) => string }> = {
  birth: {
    icon: Egg,
    color: 'text-emerald-400',
    text: (n) => (n === 1 ? 'Появился новый житель' : `Появились новые жители: ${n}`),
  },
  split: {
    icon: Split,
    color: 'text-lime-400',
    text: (n) => (n === 1 ? 'Житель разделился надвое' : `Деления: ${n}`),
  },
  merge: {
    icon: Merge,
    color: 'text-amber-400',
    text: (n) => (n === 1 ? 'Два жителя слились в одного' : `Слияния: ${n}`),
  },
  death: {
    icon: Wind,
    color: 'text-rose-400/90',
    text: (n) => (n === 1 ? 'Житель растворился' : `Растворились: ${n}`),
  },
  info: {
    icon: Sparkles,
    color: 'text-teal-300',
    text: () => '',
  },
};

export function Journal({
  pop,
  popDelta,
  totals,
  entries,
  history,
  tick,
}: {
  pop: number;
  popDelta: number;
  totals: { births: number; deaths: number; merges: number; splits: number };
  entries: JournalEntry[];
  history: { t: number; pop: number }[];
  tick: number;
}) {
  const sparkRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = sparkRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = 56;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const data = history;
    if (data.length < 2) return;
    const maxPop = Math.max(4, ...data.map((d) => d.pop));
    const x = (i: number) => (i / (data.length - 1)) * (W - 2) + 1;
    const y = (v: number) => H - 4 - (v / maxPop) * (H - 10);
    // заливка
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(52, 211, 153, 0.32)');
    grad.addColorStop(1, 'rgba(52, 211, 153, 0.02)');
    ctx.beginPath();
    ctx.moveTo(x(0), H);
    for (let i = 0; i < data.length; i++) ctx.lineTo(x(i), y(data[i].pop));
    ctx.lineTo(x(data.length - 1), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // линия
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const px = x(i);
      const py = y(data[i].pop);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // текущая точка
    ctx.beginPath();
    ctx.arc(x(data.length - 1), y(data[data.length - 1].pop), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#a7f3d0';
    ctx.fill();
  }, [tick, history]);

  return (
    <div data-testid="journal">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Сейчас в мире</p>
          <div className="flex items-baseline gap-2">
            <span
              key={pop}
              className={`text-4xl font-extrabold tabular-nums leading-none ${
                popDelta > 0 ? 'text-emerald-300' : popDelta < 0 ? 'text-rose-300' : 'text-neutral-100'
              }`}
            >
              {pop}
            </span>
            <span className="pb-0.5 text-sm text-muted-foreground">жителей</span>
            {popDelta !== 0 && (
              <span
                key={`d${pop}`}
                className={`pb-0.5 text-sm font-semibold tabular-nums ${
                  popDelta > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {popDelta > 0 ? `+${popDelta}` : popDelta}
              </span>
            )}
          </div>
        </div>
        <div className="flex max-w-[65%] flex-wrap justify-end gap-x-3 gap-y-0.5 text-right text-[11px] tabular-nums">
          <span title="Сколько жителей появилось на свет" className="text-emerald-400/90">
            рождений {totals.births}
          </span>
          <span title="Сколько жителей растворилось" className="text-rose-400/80">
            исчезло {totals.deaths}
          </span>
          <span title="Сколько пар слилось в одно существо" className="text-amber-400/80">
            слияний {totals.merges}
          </span>
          <span title="Сколько существ разделилось надвое" className="text-lime-400/80">
            делений {totals.splits}
          </span>
        </div>
      </div>

      <canvas
        ref={sparkRef}
        className="mt-3 h-14 w-full"
        aria-label="График населения мира"
        role="img"
      />

      <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
        {entries.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Наблюдайте за миром — события появятся здесь
          </p>
        )}
        {entries.map((e) => {
          const meta = KIND_META[e.kind];
          const Icon = meta.icon;
          return (
            <div
              key={e.id}
              className="flex items-center gap-2.5 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs"
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.color}`} aria-hidden />
              <span className="min-w-0 flex-1 leading-snug">
                {e.kind === 'info' ? e.text : meta.text(e.count)}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                t={e.t.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
