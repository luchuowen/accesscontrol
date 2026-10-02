'use client';

import { type ReactNode, useState } from 'react';
import { C } from './chart-colors';

/**
 * Small SVG charts for Reports (dataviz rules: thin marks, 4px rounded data ends on the baseline, 2px gap between
 * stacked parts, recessive grid, one axis, a hover tooltip on every mark, legends in text ink).
 */
const fmt = (n: number) => n.toLocaleString('en-KE');
const short = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
const dayLabel = (d: string) => {
  const [, m, dd] = d.split('-');
  return `${Number(dd)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}`;
};

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const box = (e.currentTarget.closest('[data-chart]') as HTMLElement).getBoundingClientRect();
    const r = (e.currentTarget as Element).getBoundingClientRect();
    setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, body });
  };
  const el = tip && (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-lg bg-ink-950 px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-lg"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.body}
    </div>
  );
  return { show, hide: () => setTip(null), el };
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-ink-500">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

const W = 640;
const PAD = 30;

function Grid({ max, y, h }: { max: number; y: (v: number) => number; h: number }) {
  return (
    <>
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD} x2={W} y1={y(max * f)} y2={y(max * f)} stroke={C.grid} />
          <text x={0} y={y(max * f) + 4} fontSize={10} fill={C.axis}>
            {short(Math.round(max * f))}
          </text>
        </g>
      ))}
      <line x1={PAD} x2={W} y1={h} y2={h} stroke="#E2E6EE" />
    </>
  );
}

/** Stacked bars per day: M-Pesa then cash. */
export function StackedDays({ rows, h = 180 }: { rows: { day: string; mpesa: number; cash: number }[]; h?: number }) {
  const t = useTip();
  const max = Math.max(1, ...rows.map((r) => r.mpesa + r.cash)) * 1.1;
  const y = (v: number) => h - (v / max) * (h - 16);
  const bw = (W - PAD) / Math.max(1, rows.length);
  const every = Math.ceil(rows.length / 10);
  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${W} ${h + 20}`} width="100%" role="img" aria-label="Money in per day, M-Pesa and cash">
        <Grid max={max} y={y} h={h} />
        {rows.map((r, i) => {
          const x = PAD + i * bw + bw * 0.18;
          const w = Math.max(2, bw * 0.64);
          const mTop = y(r.mpesa);
          const cTop = y(r.mpesa + r.cash);
          const tip = (
            <>
              <b>{dayLabel(r.day)}</b>
              <br />
              M-Pesa: KES {fmt(r.mpesa)}
              <br />
              Cash: KES {fmt(r.cash)}
            </>
          );
          return (
            <g key={r.day} onMouseEnter={(e) => t.show(e, tip)} onMouseLeave={t.hide}>
              <rect x={PAD + i * bw} y={0} width={bw} height={h} fill="transparent" />
              {r.mpesa > 0 && (
                <rect x={x} y={mTop} width={w} height={h - mTop} rx={r.cash ? 0 : Math.min(4, w / 2)} fill={C.mpesa} />
              )}
              {r.cash > 0 && (
                <rect
                  x={x}
                  y={cTop}
                  width={w}
                  height={Math.max(1, mTop - cTop - (r.mpesa ? 2 : 0))}
                  rx={Math.min(4, w / 2)}
                  fill={C.cash}
                />
              )}
              {i % every === 0 && (
                <text x={x + w / 2} y={h + 14} fontSize={10} textAnchor="middle" fill={C.axis}>
                  {dayLabel(r.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {t.el}
    </div>
  );
}

/** Single bars per day (one series). */
export function Bars({
  rows,
  color,
  unit = '',
  h = 120,
}: {
  rows: { day: string; v: number; note?: string }[];
  color: string;
  unit?: string;
  h?: number;
}) {
  const t = useTip();
  const max = Math.max(1, ...rows.map((r) => r.v)) * 1.1;
  const y = (v: number) => h - (v / max) * (h - 16);
  const bw = (W - PAD) / Math.max(1, rows.length);
  const every = Math.ceil(rows.length / 10);
  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${W} ${h + 20}`} width="100%" role="img">
        <Grid max={max} y={y} h={h} />
        {rows.map((r, i) => {
          const x = PAD + i * bw + bw * 0.18;
          const w = Math.max(2, bw * 0.64);
          return (
            <g
              key={r.day}
              onMouseEnter={(e) =>
                t.show(
                  e,
                  <>
                    <b>{dayLabel(r.day)}</b>
                    <br />
                    {unit}
                    {fmt(r.v)}
                    {r.note ? ` ${r.note}` : ''}
                  </>,
                )
              }
              onMouseLeave={t.hide}
            >
              <rect x={PAD + i * bw} y={0} width={bw} height={h} fill="transparent" />
              {r.v > 0 && <rect x={x} y={y(r.v)} width={w} height={h - y(r.v)} rx={Math.min(4, w / 2)} fill={color} />}
              {i % every === 0 && (
                <text x={x + w / 2} y={h + 14} fontSize={10} textAnchor="middle" fill={C.axis}>
                  {dayLabel(r.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {t.el}
    </div>
  );
}

/** A line over days with a crosshair tooltip. */
export function LineDays({
  rows,
  color = C.cash,
  h = 160,
}: {
  rows: { day: string; n: number }[];
  color?: string;
  h?: number;
}) {
  const t = useTip();
  const vals = rows.map((r) => r.n);
  const lo = Math.min(...vals, 0);
  const max = Math.max(1, ...vals) * 1.15;
  const y = (v: number) => h - ((v - lo) / (max - lo)) * (h - 14);
  const step = (W - PAD) / Math.max(1, rows.length - 1);
  const pts = rows.map((r, i) => [PAD + i * step, y(r.n)] as const);
  const [hover, setHover] = useState<number | null>(null);
  const every = Math.ceil(rows.length / 8);
  return (
    <div data-chart className="relative">
      <svg viewBox={`0 0 ${W} ${h + 20}`} width="100%" role="img" aria-label="Active members per day">
        <Grid max={max} y={y} h={h} />
        <path d={`M${pts.map((p) => p.join(',')).join('L')}`} fill="none" stroke={color} strokeWidth={2} />
        {hover !== null && pts[hover] && (
          <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={h} stroke="#CBD2DD" strokeDasharray="3 3" />
        )}
        {pts.map((p, i) => (
          <g
            key={rows[i]?.day}
            onMouseEnter={(e) => {
              setHover(i);
              t.show(
                e,
                <>
                  <b>{dayLabel(rows[i]?.day ?? '')}</b>
                  <br />
                  {fmt(rows[i]?.n ?? 0)} active
                </>,
              );
            }}
            onMouseLeave={() => {
              setHover(null);
              t.hide();
            }}
          >
            <rect x={p[0] - step / 2} y={0} width={step} height={h} fill="transparent" />
            <circle cx={p[0]} cy={p[1]} r={0.1} fill="transparent" />
            {(hover === i || i === pts.length - 1) && (
              <circle cx={p[0]} cy={p[1]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
            )}
            {i % every === 0 && (
              <text x={p[0]} y={h + 14} fontSize={10} textAnchor="middle" fill={C.axis}>
                {dayLabel(rows[i]?.day ?? '')}
              </text>
            )}
          </g>
        ))}
      </svg>
      {t.el}
    </div>
  );
}

/** Horizontal bars with the value written at the end. */
export function HBars({ items, unit = 'KES ' }: { items: { name: string; v: number }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return (
    <div className="space-y-2.5">
      {items.map((it, k) => (
        <div key={it.name} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate text-ink-700">{it.name}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[#F2F4F8]">
            <i
              className="block h-full rounded-full"
              title={`${it.name}: ${unit}${fmt(it.v)}`}
              style={{ width: `${(it.v / max) * 100}%`, background: C.series[Math.min(k, 3)] }}
            />
          </span>
          <b className="tabular-nums">
            {unit}
            {fmt(it.v)}
          </b>
        </div>
      ))}
    </div>
  );
}

/** Weekday × hour heatmap, one blue ramp. */
export function Heat({ grid, from }: { grid: number[][]; from: number }) {
  const t = useTip();
  const max = Math.max(1, ...grid.flat());
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cols = grid[0]?.length ?? 0;
  return (
    <div data-chart className="relative">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `34px repeat(${cols}, minmax(0, 1fr))` }}>
        <span />
        {Array.from({ length: cols }, (_, i) => (
          <span key={i} className="text-center text-[10px] text-ink-300">
            {i % 3 === 0 ? `${from + i}:00` : ''}
          </span>
        ))}
        {grid.map((row, r) => (
          <div key={days[r]} className="contents">
            <span className="text-[11px] leading-[18px] text-ink-500">{days[r]}</span>
            {row.map((v, c) => (
              <i
                key={`${days[r]}${from + c}`}
                className="block h-[18px] rounded-[4px]"
                style={{ background: v ? C.ramp[Math.min(5, 1 + Math.floor((v / max) * 4.99))] : C.ramp[0] }}
                onMouseEnter={(e) =>
                  t.show(
                    e,
                    <>
                      <b>
                        {days[r]} {from + c}:00–{from + c + 1}:00
                      </b>
                      <br />
                      {fmt(v)} entries
                    </>,
                  )
                }
                onMouseLeave={t.hide}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-500">
        Fewer
        {C.ramp.map((c) => (
          <i key={c} className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: c }} />
        ))}
        More
      </div>
      {t.el}
    </div>
  );
}
