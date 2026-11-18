import React, { useMemo, useState } from 'react';
import type { BudgetItem, ExpenseRecord } from '../types';
import { formatTwd } from '../constants/currencies';

type PieMode = 'actual_vs_budget' | 'budget_allocation' | 'actual_share';

interface BudgetPieChartProps {
  budgets: BudgetItem[];
  expenses: ExpenseRecord[];
}

interface PieSlice {
  id: string;
  name: string;
  amountTwd: number;
  budgetTwd: number;
  actualTwd: number;
  /** Percentage of the primary denominator (e.g. total budget or total actual) */
  sharePct: number;
  /** Visual proportion of the circle (0..1) */
  geometryRatio: number;
  color: string;
  isRemaining?: boolean;
  /** Category execution rate (actual / category budget * 100) */
  categoryExecPct: number | null;
}

const SLICE_PALETTE = [
  '#4f46e5', // Indigo
  '#0d9488', // Teal
  '#d97706', // Amber
  '#e11d48', // Rose
  '#0284c7', // Sky
  '#7c3aed', // Violet
  '#059669', // Emerald
  '#ea580c', // Orange
  '#c026d3', // Fuchsia
  '#2563eb', // Blue
];

const REMAINING_COLOR = '#64748b'; // Slate 500

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describePieSlice(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${cx.toFixed(2)} ${cy.toFixed(2)}`,
    `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`,
    `A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const BudgetPieChart: React.FC<BudgetPieChartProps> = ({ budgets, expenses }) => {
  const [mode, setMode] = useState<PieMode>('actual_vs_budget');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lockedId, setLockedId] = useState<string | null>(null);

  const { slices, totalBudget, totalActual, remainingBudget, isOverBudget } = useMemo(() => {
    const spendByCategory = new Map<string, number>();
    const knownIds = new Set(budgets.map((b) => b.id));
    let uncategorizedSpend = 0;

    for (const exp of expenses) {
      if (knownIds.has(exp.categoryId)) {
        spendByCategory.set(
          exp.categoryId,
          (spendByCategory.get(exp.categoryId) || 0) + exp.totalTwd
        );
      } else {
        uncategorizedSpend += exp.totalTwd;
      }
    }

    const totalBudgetSum = budgets.reduce((sum, b) => sum + Math.max(0, Math.round(b.budgetTwd || 0)), 0);
    const totalActualSum = Math.round(
      expenses.reduce((sum, e) => sum + (e.totalTwd || 0), 0)
    );
    const remaining = Math.max(0, totalBudgetSum - totalActualSum);
    const overBudget = totalBudgetSum > 0 && totalActualSum > totalBudgetSum;

    const baseCategories: {
      id: string;
      name: string;
      budgetTwd: number;
      actualTwd: number;
      color: string;
      categoryExecPct: number | null;
    }[] = budgets.map((b, idx) => {
      const budgetTwd = Math.max(0, Math.round(b.budgetTwd || 0));
      const actualTwd = Math.round(spendByCategory.get(b.id) || 0);
      return {
        id: b.id,
        name: b.name,
        budgetTwd,
        actualTwd,
        color: SLICE_PALETTE[idx % SLICE_PALETTE.length],
        categoryExecPct:
          budgetTwd > 0 ? Math.round((actualTwd / budgetTwd) * 100) : actualTwd > 0 ? 100 : 0,
      };
    });

    if (uncategorizedSpend > 0) {
      baseCategories.push({
        id: '__uncategorized__',
        name: '其他未分類支出',
        budgetTwd: 0,
        actualTwd: Math.round(uncategorizedSpend),
        color: '#475569',
        categoryExecPct: null,
      });
    }

    const computed: PieSlice[] = [];

    if (mode === 'actual_vs_budget') {
      const geomDenominator =
        totalBudgetSum > 0 ? Math.max(totalBudgetSum, totalActualSum) : totalActualSum;

      for (const cat of baseCategories) {
        const sharePct =
          totalBudgetSum > 0
            ? (cat.actualTwd / totalBudgetSum) * 100
            : geomDenominator > 0
              ? (cat.actualTwd / geomDenominator) * 100
              : 0;
        const geometryRatio = geomDenominator > 0 ? cat.actualTwd / geomDenominator : 0;

        computed.push({
          id: cat.id,
          name: cat.name,
          amountTwd: cat.actualTwd,
          budgetTwd: cat.budgetTwd,
          actualTwd: cat.actualTwd,
          sharePct,
          geometryRatio,
          color: cat.color,
          categoryExecPct: cat.categoryExecPct,
        });
      }

      if (totalBudgetSum > 0 && remaining > 0) {
        computed.push({
          id: '__remaining__',
          name: '尚未動用預算',
          amountTwd: remaining,
          budgetTwd: totalBudgetSum,
          actualTwd: totalActualSum,
          sharePct: (remaining / totalBudgetSum) * 100,
          geometryRatio: remaining / geomDenominator,
          color: REMAINING_COLOR,
          isRemaining: true,
          categoryExecPct: null,
        });
      }
    } else if (mode === 'budget_allocation') {
      for (const cat of baseCategories) {
        if (cat.id === '__uncategorized__') continue;
        const ratio = totalBudgetSum > 0 ? cat.budgetTwd / totalBudgetSum : 0;
        computed.push({
          id: cat.id,
          name: cat.name,
          amountTwd: cat.budgetTwd,
          budgetTwd: cat.budgetTwd,
          actualTwd: cat.actualTwd,
          sharePct: ratio * 100,
          geometryRatio: ratio,
          color: cat.color,
          categoryExecPct: cat.categoryExecPct,
        });
      }
    } else {
      // actual_share
      for (const cat of baseCategories) {
        const ratio = totalActualSum > 0 ? cat.actualTwd / totalActualSum : 0;
        computed.push({
          id: cat.id,
          name: cat.name,
          amountTwd: cat.actualTwd,
          budgetTwd: cat.budgetTwd,
          actualTwd: cat.actualTwd,
          sharePct: ratio * 100,
          geometryRatio: ratio,
          color: cat.color,
          categoryExecPct: cat.categoryExecPct,
        });
      }
    }

    return {
      slices: computed,
      totalBudget: totalBudgetSum,
      totalActual: totalActualSum,
      remainingBudget: remaining,
      isOverBudget: overBudget,
    };
  }, [budgets, expenses, mode]);

  const activeId = hoveredId ?? lockedId;
  const activeSlice = useMemo(
    () => slices.find((s) => s.id === activeId) ?? null,
    [slices, activeId]
  );

  // Build SVG wedge coordinates for positive slices
  const positiveSlices = useMemo(() => {
    const filtered = slices.filter((s) => s.geometryRatio > 0);
    let cursorAngle = -Math.PI / 2; // Start at 12 o'clock
    return filtered.map((s) => {
      const sweep = s.geometryRatio * Math.PI * 2;
      const startAngle = cursorAngle;
      const endAngle = cursorAngle + sweep;
      const midAngle = startAngle + sweep / 2;
      cursorAngle = endAngle;
      return {
        ...s,
        startAngle,
        endAngle,
        midAngle,
      };
    });
  }, [slices]);

  if (budgets.length === 0 && expenses.length === 0) {
    return (
      <div className="display-yellow-soft rounded-xl p-6 text-center text-sm">
        尚未設定預算項目或消費紀錄，新增後即可顯示「預算分類占比」互動式圓餅圖。
      </div>
    );
  }

  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 122;

  const modeSubtitle =
    mode === 'actual_vs_budget'
      ? isOverBudget
        ? `目前實際總支出已超過總預算（${Math.round((totalActual / totalBudget) * 100)}%），以下顯示各類支出佔總預算比例與支出分布。`
        : '直觀呈現住宿、交通、餐飲等各項實際支出在整體旅遊總預算中所佔的比例（含尚未動用餘額）。'
      : mode === 'budget_allocation'
        ? '檢視各項預算類別在整體旅遊總預算中的規劃配置比例。'
        : '僅統計已發生的實際花費，檢視各類別在總實際支出中的分佈比例。';

  const hasChartData = positiveSlices.length > 0;

  return (
    <div className="space-y-4">
      {/* Section Header & Interactive Mode Switch */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-white">
            預算分類占比（互動式圓餅圖）
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {modeSubtitle}
          </p>
        </div>

        <div
          role="group"
          aria-label="圓餅圖計算基準切換"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => {
              setMode('actual_vs_budget');
              setLockedId(null);
            }}
            className={`h-9 px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
              mode === 'actual_vs_budget' ? 'control-green-active' : 'control-green'
            }`}
          >
            支出佔總預算
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('budget_allocation');
              setLockedId(null);
            }}
            className={`h-9 px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
              mode === 'budget_allocation' ? 'control-green-active' : 'control-green'
            }`}
          >
            預算配置占比
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('actual_share');
              setLockedId(null);
            }}
            className={`h-9 px-3 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${
              mode === 'actual_share' ? 'control-green-active' : 'control-green'
            }`}
          >
            實際支出分佈
          </button>
        </div>
      </div>

      {/* Main 2-Column Interactive Pie + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 items-stretch">
        {/* Left: Interactive SVG Pie Chart on Yellow Soft Read-Only Container */}
        <div className="display-yellow-soft rounded-xl p-4 flex flex-col items-center justify-center">
          {!hasChartData ? (
            <div className="py-16 text-center text-xs opacity-75">
              {mode === 'actual_share'
                ? '目前尚無任何實際消費紀錄，新增記帳後即可顯示分佈圖。'
                : '目前總預算為 NT$ 0，請先設定預算金額。'}
            </div>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${size} ${size}`}
                className="w-full max-w-[280px] h-auto select-none overflow-visible"
                role="img"
                aria-label="預算分類占比互動式圓餅圖"
              >
                {positiveSlices.map((slice) => {
                  const isActive = activeId === slice.id;
                  const isDimmed = activeId !== null && !isActive;
                  const isFullCircle = slice.geometryRatio >= 0.9999;

                  const popDistance = isActive ? 8 : 0;
                  const dx = isFullCircle ? 0 : Math.cos(slice.midAngle) * popDistance;
                  const dy = isFullCircle ? 0 : Math.sin(slice.midAngle) * popDistance;

                  const labelRadius = isFullCircle ? 0 : radius * 0.65;
                  const labelPos = isFullCircle
                    ? { x: cx, y: cy }
                    : polarToCartesian(cx, cy, labelRadius, slice.midAngle);

                  const showLabelOnSlice = slice.geometryRatio >= 0.055;

                  return (
                    <g
                      key={slice.id}
                      style={{
                        transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`,
                      }}
                      className={`cursor-pointer transition-transform duration-150 ${
                        isDimmed ? 'opacity-55' : 'opacity-100'
                      }`}
                      onMouseEnter={() => setHoveredId(slice.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() =>
                        setLockedId((prev) => (prev === slice.id ? null : slice.id))
                      }
                    >
                      {isFullCircle ? (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={radius}
                          fill={slice.color}
                          stroke="currentColor"
                          className="text-yellow-50 dark:text-slate-900"
                          strokeWidth="2"
                        />
                      ) : (
                        <path
                          d={describePieSlice(
                            cx,
                            cy,
                            radius,
                            slice.startAngle,
                            slice.endAngle
                          )}
                          fill={slice.color}
                          stroke="currentColor"
                          className="text-yellow-50 dark:text-slate-900"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                      )}

                      {showLabelOnSlice && (
                        <text
                          x={labelPos.x}
                          y={labelPos.y + 4}
                          textAnchor="middle"
                          className="fill-white text-[11px] font-mono-num font-bold pointer-events-none"
                          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.45)' }}
                        >
                          {slice.sharePct.toFixed(1)}%
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              <p className="text-[11px] opacity-75 text-center mt-2">
                滑鼠移至或點擊扇區／右側項目可鎖定檢視詳細占比
              </p>
            </>
          )}
        </div>

        {/* Right: Inspected Yellow Readout + Interactive Breakdown Rows */}
        <div className="flex flex-col gap-3 min-w-0">
          {/* Active Slice / Total Yellow Summary Readout */}
          <div className="display-yellow rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            {activeSlice ? (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-3.5 h-3.5 rounded-sm shrink-0"
                    style={{ backgroundColor: activeSlice.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{activeSlice.name}</div>
                    <div className="text-[11px] opacity-80 font-mono-num">
                      {activeSlice.isRemaining
                        ? `總預算 ${formatTwd(totalBudget)} · 已用 ${formatTwd(totalActual)}`
                        : mode === 'budget_allocation'
                          ? `已實際支出 ${formatTwd(activeSlice.actualTwd)}${
                              activeSlice.categoryExecPct !== null
                                ? ` · 類別執行率 ${activeSlice.categoryExecPct}%`
                                : ''
                            }`
                          : activeSlice.budgetTwd > 0
                            ? `類別預算 ${formatTwd(activeSlice.budgetTwd)} · 執行率 ${activeSlice.categoryExecPct}%`
                            : '未編列類別預算'}
                    </div>
                  </div>
                </div>
                <div className="text-right ml-auto">
                  <div className="text-base sm:text-lg font-mono-num font-bold">
                    {formatTwd(activeSlice.amountTwd)}
                  </div>
                  <div className="text-xs font-mono-num font-semibold">
                    {mode === 'actual_vs_budget'
                      ? `佔總預算 ${activeSlice.sharePct.toFixed(1)}%`
                      : mode === 'budget_allocation'
                        ? `佔總預算 ${activeSlice.sharePct.toFixed(1)}%`
                        : `佔總支出 ${activeSlice.sharePct.toFixed(1)}%`}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-xs font-semibold opacity-80">
                    {mode === 'actual_vs_budget'
                      ? '總支出佔總預算比例'
                      : mode === 'budget_allocation'
                        ? '旅遊總預算配置總額'
                        : '本趟累計實際支出總額'}
                  </div>
                  <div className="text-sm font-mono-num font-bold mt-0.5">
                    {mode === 'actual_vs_budget'
                      ? `${formatTwd(totalActual)} / ${formatTwd(totalBudget)}`
                      : mode === 'budget_allocation'
                        ? formatTwd(totalBudget)
                        : formatTwd(totalActual)}
                  </div>
                </div>
                <div className="text-right ml-auto">
                  <div className="text-base sm:text-lg font-mono-num font-bold">
                    {mode === 'actual_vs_budget'
                      ? totalBudget > 0
                        ? `${((totalActual / totalBudget) * 100).toFixed(1)}%`
                        : '—'
                      : '100.0%'}
                  </div>
                  <div className="text-[11px] opacity-80 font-mono-num">
                    {mode === 'actual_vs_budget'
                      ? isOverBudget
                        ? `超支 ${formatTwd(totalActual - totalBudget)}`
                        : `剩餘 ${formatTwd(remainingBudget)}`
                      : `共 ${slices.length} 個項目`}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Interactive Category Proportion List */}
          <div className="display-yellow-soft rounded-xl overflow-hidden flex-1">
            <div className="divide-y divide-yellow-200/70 dark:divide-yellow-800/50">
              {slices.map((slice) => {
                const isActive = activeId === slice.id;
                const isLocked = lockedId === slice.id;
                const barWidth = Math.min(100, Math.max(0, slice.sharePct));

                return (
                  <button
                    key={slice.id}
                    type="button"
                    onMouseEnter={() => setHoveredId(slice.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() =>
                      setLockedId((prev) => (prev === slice.id ? null : slice.id))
                    }
                    className={`w-full text-left px-3.5 py-2.5 transition-colors flex flex-col gap-1.5 ${
                      isActive
                        ? 'bg-yellow-200/70 dark:bg-yellow-900/45'
                        : 'hover:bg-yellow-100/60 dark:hover:bg-yellow-900/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: slice.color }}
                          aria-hidden="true"
                        />
                        <span className={`truncate ${isActive ? 'font-bold' : 'font-medium'}`}>
                          {slice.name}
                        </span>
                        {isLocked && (
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
                            · 已鎖定
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0 font-mono-num">
                        <span className="font-semibold">{formatTwd(slice.amountTwd)}</span>
                        <span
                          className={`w-14 text-right font-bold ${
                            !slice.isRemaining &&
                            mode === 'actual_vs_budget' &&
                            slice.budgetTwd > 0 &&
                            slice.actualTwd > slice.budgetTwd
                              ? 'text-rose-700 dark:text-rose-300'
                              : ''
                          }`}
                        >
                          {slice.sharePct.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Horizontal proportional bar */}
                    <div className="h-1.5 w-full rounded-full bg-yellow-900/10 dark:bg-yellow-100/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${barWidth}%`,
                          backgroundColor: slice.color,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
