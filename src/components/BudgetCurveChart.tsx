import React, { useMemo, useState } from 'react';
import type { BudgetItem, ExpenseRecord } from '../types';
import { formatTwd } from '../constants/currencies';

interface BudgetCurveChartProps {
  budgets: BudgetItem[];
  expenses: ExpenseRecord[];
}

interface ChartPoint {
  id: string;
  name: string;
  budgetTwd: number;
  actualTwd: number;
  diffTwd: number;
  pct: number;
}

/**
 * Generates a smooth SVG path through points using Catmull-Rom to Cubic Bezier conversion,
 * clamped to >= 0 baseline so curve never dips below Y=0.
 */
function buildSmoothPath(coords: { x: number; y: number }[], baselineY: number): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
  if (coords.length === 2) {
    const midX = (coords[0].x + coords[1].x) / 2;
    return `M ${coords[0].x} ${coords[0].y} C ${midX} ${coords[0].y}, ${midX} ${coords[1].y}, ${coords[1].x} ${coords[1].y}`;
  }

  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = Math.min(baselineY, p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = Math.min(baselineY, p2.y - (p3.y - p1.y) / 6);

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export const BudgetCurveChart: React.FC<BudgetCurveChartProps> = ({ budgets, expenses }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const data: ChartPoint[] = useMemo(() => {
    const spendByCategory = new Map<string, number>();
    for (const exp of expenses) {
      spendByCategory.set(exp.categoryId, (spendByCategory.get(exp.categoryId) || 0) + exp.totalTwd);
    }

    return budgets.map((b) => {
      const actualTwd = Math.round(spendByCategory.get(b.id) || 0);
      const budgetTwd = Math.round(b.budgetTwd || 0);
      const diffTwd = budgetTwd - actualTwd;
      const pct = budgetTwd > 0 ? Math.round((actualTwd / budgetTwd) * 100) : actualTwd > 0 ? 100 : 0;
      return {
        id: b.id,
        name: b.name,
        budgetTwd,
        actualTwd,
        diffTwd,
        pct,
      };
    });
  }, [budgets, expenses]);

  if (data.length === 0) {
    return (
      <div className="display-yellow-soft rounded-xl p-6 text-center text-sm">
        尚未設定預算項目，請先新增至少一項預算類別以顯示台幣預算與實際消費曲線圖。
      </div>
    );
  }

  const width = 820;
  const height = 310;
  const padLeft = 72;
  const padRight = 32;
  const padTop = 28;
  const padBottom = 56;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baselineY = padTop + plotH;

  const rawMax = Math.max(
    1000,
    ...data.map((d) => Math.max(d.budgetTwd, d.actualTwd))
  );
  const niceStep = Math.pow(10, Math.floor(Math.log10(rawMax))) / 2;
  const yMax = Math.ceil((rawMax * 1.15) / niceStep) * niceStep;

  const xFor = (idx: number) => {
    if (data.length === 1) return padLeft + plotW / 2;
    return padLeft + (idx / (data.length - 1)) * plotW;
  };
  const yFor = (val: number) => padTop + plotH - (val / yMax) * plotH;

  const budgetCoords = data.map((d, i) => ({ x: xFor(i), y: yFor(d.budgetTwd) }));
  const actualCoords = data.map((d, i) => ({ x: xFor(i), y: yFor(d.actualTwd) }));

  const budgetPath = buildSmoothPath(budgetCoords, baselineY);
  const actualPath = buildSmoothPath(actualCoords, baselineY);
  const actualAreaPath =
    actualCoords.length >= 2
      ? `${actualPath} L ${actualCoords[actualCoords.length - 1].x.toFixed(1)} ${baselineY} L ${actualCoords[0].x.toFixed(1)} ${baselineY} Z`
      : '';

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(yMax * ratio));

  const inspected = activeIndex !== null ? data[activeIndex] : null;
  const totalBudget = data.reduce((s, d) => s + d.budgetTwd, 0);
  const totalActual = data.reduce((s, d) => s + d.actualTwd, 0);

  return (
    <div className="space-y-4">
      {/* Legend + Inspected Point Yellow Readout */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-5 text-xs font-medium text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-0.5 bg-indigo-600 dark:bg-indigo-400 border-t-2 border-dashed border-indigo-600 dark:border-indigo-400" />
            <span>預算金額曲線 (TWD)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-6 h-1 rounded-full bg-amber-600 dark:bg-amber-400" />
            <span>實際消費曲線 (TWD)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-600 dark:bg-rose-400" />
            <span>超支項目節點</span>
          </div>
        </div>

        <div className="display-yellow rounded-xl px-3.5 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
          {inspected ? (
            <>
              <span className="font-bold">{inspected.name}</span>
              <span>
                預算 <strong className="font-mono-num">{formatTwd(inspected.budgetTwd)}</strong>
              </span>
              <span>
                實際 <strong className="font-mono-num">{formatTwd(inspected.actualTwd)}</strong>
              </span>
              <span className={inspected.diffTwd < 0 ? 'text-rose-700 dark:text-rose-300 font-bold' : 'font-semibold'}>
                {inspected.diffTwd >= 0
                  ? `剩餘 ${formatTwd(inspected.diffTwd)}`
                  : `超支 ${formatTwd(Math.abs(inspected.diffTwd))}`}{' '}
                ({inspected.pct}%)
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold">整趟合計</span>
              <span>
                總預算 <strong className="font-mono-num">{formatTwd(totalBudget)}</strong>
              </span>
              <span>
                總實際 <strong className="font-mono-num">{formatTwd(totalActual)}</strong>
              </span>
              <span className="opacity-75">點擊或移動滑鼠至曲線節點可檢視各項明細</span>
            </>
          )}
        </div>
      </div>

      {/* Responsive Interactive SVG Curve Chart */}
      <div className="display-yellow-soft rounded-xl p-3 sm:p-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[540px] h-auto select-none"
          role="img"
          aria-label="各項預算項目之台幣預算金額與實際消費金額曲線圖"
        >
          <defs>
            <linearGradient id="actualCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d97706" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Y-axis gridlines */}
          {yTicks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-yellow-800/15 dark:text-yellow-200/15"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-yellow-950/70 dark:fill-yellow-100/75 text-[11px] font-mono-num"
                >
                  {tick >= 10000
                    ? `${(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}k`
                    : tick.toLocaleString('zh-TW')}
                </text>
              </g>
            );
          })}

          {/* Y-axis unit label */}
          <text
            x={padLeft - 10}
            y={padTop - 10}
            textAnchor="end"
            className="fill-yellow-950/70 dark:fill-yellow-100/75 text-[10px] font-semibold"
          >
            NT$
          </text>

          {/* Actual Spend Area */}
          {actualAreaPath && <path d={actualAreaPath} fill="url(#actualCurveGrad)" />}

          {/* Budget Curve (Dashed Indigo) */}
          <path
            d={budgetPath}
            fill="none"
            stroke="#4f46e5"
            className="dark:stroke-indigo-400"
            strokeWidth="2.5"
            strokeDasharray="6 5"
            strokeLinecap="round"
          />

          {/* Actual Spend Curve (Solid Amber) */}
          <path
            d={actualPath}
            fill="none"
            stroke="#d97706"
            className="dark:stroke-amber-400"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* Active vertical guide line */}
          {activeIndex !== null && (
            <line
              x1={xFor(activeIndex)}
              y1={padTop}
              x2={xFor(activeIndex)}
              y2={baselineY}
              stroke="currentColor"
              className="text-yellow-900/35 dark:text-yellow-200/35"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          )}

          {/* Category Nodes & Interactive Hit Columns */}
          {data.map((d, idx) => {
            const cx = xFor(idx);
            const by = yFor(d.budgetTwd);
            const ay = yFor(d.actualTwd);
            const isOver = d.actualTwd > d.budgetTwd;
            const isActive = activeIndex === idx;
            const colWidth = data.length > 1 ? plotW / data.length : plotW;

            return (
              <g
                key={d.id}
                className="cursor-pointer"
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseLeave={() => setActiveIndex(null)}
                onClick={() => setActiveIndex(isActive ? null : idx)}
              >
                {/* Invisible wide touch/hover hit area */}
                <rect
                  x={cx - colWidth / 2}
                  y={padTop}
                  width={colWidth}
                  height={plotH + padBottom}
                  fill="transparent"
                />

                {/* Budget Point */}
                <circle
                  cx={cx}
                  cy={by}
                  r={isActive ? 6.5 : 4.5}
                  className="fill-white dark:fill-slate-900 stroke-indigo-600 dark:stroke-indigo-400 transition-all"
                  strokeWidth="2.5"
                />

                {/* Actual Spend Point */}
                <circle
                  cx={cx}
                  cy={ay}
                  r={isActive ? 7 : 5}
                  className={
                    isOver
                      ? 'fill-rose-600 dark:fill-rose-400 stroke-white dark:stroke-slate-900'
                      : 'fill-amber-600 dark:fill-amber-400 stroke-white dark:stroke-slate-900'
                  }
                  strokeWidth="2"
                />

                {/* Value labels on hover/active */}
                {isActive && (
                  <g>
                    <text
                      x={cx}
                      y={Math.max(14, Math.min(by, ay) - 10)}
                      textAnchor="middle"
                      className="fill-yellow-950 dark:fill-yellow-100 text-[11px] font-mono-num font-bold"
                    >
                      實際 {formatTwd(d.actualTwd)} / 預算 {formatTwd(d.budgetTwd)}
                    </text>
                  </g>
                )}

                {/* X-axis category label */}
                <text
                  x={cx}
                  y={baselineY + 22}
                  textAnchor="middle"
                  className={`text-[12px] font-medium ${
                    isActive
                      ? 'fill-yellow-950 dark:fill-yellow-50 font-bold'
                      : 'fill-yellow-950/80 dark:fill-yellow-100/80'
                  }`}
                >
                  {d.name.length > 7 ? `${d.name.slice(0, 7)}…` : d.name}
                </text>
                <text
                  x={cx}
                  y={baselineY + 39}
                  textAnchor="middle"
                  className={`text-[10px] font-mono-num ${
                    isOver
                      ? 'fill-rose-700 dark:fill-rose-300 font-semibold'
                      : 'fill-yellow-900/65 dark:fill-yellow-200/65'
                  }`}
                >
                  {d.pct}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Read-only Yellow Breakdown Table */}
      <div className="display-yellow-soft rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-yellow-300/80 dark:border-yellow-800/70 text-xs text-yellow-900/80 dark:text-yellow-200/80">
                <th className="text-left py-2.5 px-3.5 font-semibold">預算項目</th>
                <th className="text-right py-2.5 px-3.5 font-semibold">預算金額 (TWD)</th>
                <th className="text-right py-2.5 px-3.5 font-semibold">實際支出 (TWD)</th>
                <th className="text-right py-2.5 px-3.5 font-semibold">剩餘 / 超支</th>
                <th className="text-right py-2.5 px-3.5 font-semibold">執行率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-yellow-200/70 dark:divide-yellow-800/50">
              {data.map((row) => {
                const isOver = row.diffTwd < 0;
                return (
                  <tr key={row.id} className="hover:bg-yellow-100/60 dark:hover:bg-yellow-900/25">
                    <td className="py-2.5 px-3.5 font-medium">{row.name}</td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num">{formatTwd(row.budgetTwd)}</td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num font-semibold">
                      {formatTwd(row.actualTwd)}
                    </td>
                    <td
                      className={`py-2.5 px-3.5 text-right font-mono-num font-semibold ${
                        isOver ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {isOver ? `超支 ${formatTwd(Math.abs(row.diffTwd))}` : `剩餘 ${formatTwd(row.diffTwd)}`}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono-num">{row.pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
