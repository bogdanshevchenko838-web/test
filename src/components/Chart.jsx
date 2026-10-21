import React, { useId, useState } from 'react';

const COLORS = ['#b7ef70', '#82acf7', '#f3b36a'];

export default function Chart({ series, xLabel = 'Время, с', yLabel = '°/с', height = 240 }) {
  const id = useId().replaceAll(':', '');
  const [cursor, setCursor] = useState(null);
  const available = series.filter(s => s.points?.some(p => Number.isFinite(p[1])));
  if (!available.length) return <div className="chart-empty">Этот канал отсутствует в логе.</div>;
  const points = available.flatMap(s => s.points.filter(p => Number.isFinite(p[1])));
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of points) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  if (xmax === xmin) xmax++;
  if (ymax === ymin) { ymax++; ymin--; }
  const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
  const w = 900, h = height, left = 58, right = 18, top = 24, bottom = 35;
  const xx = x => left + (x - xmin) / (xmax - xmin) * (w - left - right);
  const yy = y => h - bottom - (y - ymin) / (ymax - ymin) * (h - top - bottom);
  const hoverX = cursor === null ? null : xmin + cursor * (xmax - xmin);
  const nearest = hoverX === null ? [] : available.map(s => {
    let lo = 0, hi = s.points.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (s.points[mid][0] < hoverX) lo = mid + 1; else hi = mid; }
    return { ...s, point: s.points[lo] };
  });
  return <div className="chart">
    <div className="chart-legend">{available.map((s, i) => <span key={s.name}><i style={{ background: s.color || COLORS[i] }} />{s.name}</span>)}</div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${yLabel} по ${xLabel}`} onMouseLeave={() => setCursor(null)} onMouseMove={e => {
      const rect = e.currentTarget.getBoundingClientRect();
      setCursor(Math.max(0, Math.min(1, ((e.clientX - rect.left) / rect.width * w - left) / (w - left - right))));
    }}>
      <defs><clipPath id={id}><rect x={left} y={top} width={w - left - right} height={h - top - bottom} /></clipPath></defs>
      {Array.from({ length: 5 }, (_, i) => {
        const v = ymin + (ymax - ymin) * i / 4, y = yy(v);
        return <g key={i}><line x1={left} x2={w - right} y1={y} y2={y} stroke="#2b332c" strokeDasharray="3 6" /><text x={left - 10} y={y + 4} textAnchor="end">{v.toFixed(Math.abs(v) < 10 ? 1 : 0)}</text></g>;
      })}
      {Array.from({ length: 6 }, (_, i) => { const v = xmin + (xmax - xmin) * i / 5; return <text key={i} x={xx(v)} y={h - 8} textAnchor="middle">{v.toFixed(xmax > 100 ? 0 : 1)}</text>; })}
      <text x={left} y={13}>{yLabel}</text><text x={w - right} y={h - 8} textAnchor="end" className="axis-title">{xLabel}</text>
      <g clipPath={`url(#${id})`}>{available.map((s, i) => {
        let pen = false;
        const d = s.points.map(([x, y]) => { if (!Number.isFinite(y)) { pen = false; return ''; } const result = `${pen ? 'L' : 'M'}${xx(x).toFixed(1)},${yy(y).toFixed(1)}`; pen = true; return result; }).join(' ');
        return <path key={s.name} d={d} fill="none" stroke={s.color || COLORS[i]} strokeWidth="1.4" opacity="0.9" />;
      })}</g>
      {hoverX !== null && <line x1={xx(hoverX)} x2={xx(hoverX)} y1={top} y2={h - bottom} stroke="#ced6c4" strokeDasharray="4 3" />}
    </svg>
    <div className="chart-readout">{hoverX === null ? 'Наведи на график для просмотра значений' : `${hoverX.toFixed(2)} ${xLabel.includes('Гц') ? 'Гц' : 'с'} · ${nearest.map(s => `${s.name}: ${Number.isFinite(s.point?.[1]) ? s.point[1].toFixed(2) : '—'}`).join(' · ')}`}</div>
  </div>;
}
