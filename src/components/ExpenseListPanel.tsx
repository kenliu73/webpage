import React, { useMemo, useState } from 'react';
import { Pencil, Trash2, Search, Globe, CreditCard, Banknote } from 'lucide-react';
import type {
  BudgetItem,
  CurrencyCode,
  ExpenseRecord,
  LedgerSettings,
  ScopeFilter,
} from '../types';
import { formatCurrencyAmount, formatTwd } from '../constants/currencies';

interface ExpenseListPanelProps {
  settings: LedgerSettings;
  budgets: BudgetItem[];
  expenses: ExpenseRecord[];
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (next: ScopeFilter) => void;
  foreignOnly: boolean;
  onForeignOnlyChange: (next: boolean) => void;
  onEditExpense: (expense: ExpenseRecord) => void;
  onDeleteExpense: (expenseId: string) => Promise<void>;
}

export const ExpenseListPanel: React.FC<ExpenseListPanelProps> = ({
  settings,
  budgets,
  expenses,
  scopeFilter,
  onScopeFilterChange,
  foreignOnly,
  onForeignOnlyChange,
  onEditExpense,
  onDeleteExpense,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'credit_card'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const budgetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of budgets) {
      map.set(b.id, b.name);
    }
    return map;
  }, [budgets]);

  // 1. Expenses matching the Scope Filter (Entire Trip / Pre-trip / Specific Day)
  const scopedExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      if (scopeFilter === 'all') return true;
      if (scopeFilter === 'pre_trip') return exp.phase === 'pre_trip';
      return exp.phase === 'on_trip' && exp.dayNumber === scopeFilter;
    });
  }, [expenses, scopeFilter]);

  // 2. Summary stats for the selected Scope (Req #10: Total TWD & Foreign Currency Totals)
  const scopeStats = useMemo(() => {
    let totalTwd = 0;
    let foreignTotalTwd = 0;
    let foreignCount = 0;
    const byForeignCurrency = new Map<CurrencyCode, number>();

    for (const exp of scopedExpenses) {
      totalTwd += exp.totalTwd;
      if (exp.currency !== 'TWD') {
        foreignTotalTwd += exp.totalTwd;
        foreignCount += 1;
        byForeignCurrency.set(
          exp.currency,
          (byForeignCurrency.get(exp.currency) || 0) + exp.originalAmount
        );
      }
    }

    const foreignBreakdownText = Array.from(byForeignCurrency.entries())
      .map(([curr, amt]) => formatCurrencyAmount(amt, curr))
      .join(' · ');

    return {
      totalCount: scopedExpenses.length,
      totalTwd,
      foreignCount,
      foreignTotalTwd,
      foreignBreakdownText,
    };
  }, [scopedExpenses]);

  // 3. Final displayed rows applying Foreign-Only + Category + Payment + Search
  const visibleExpenses = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return scopedExpenses.filter((exp) => {
      if (foreignOnly && exp.currency === 'TWD') return false;
      if (categoryFilter !== 'all' && exp.categoryId !== categoryFilter) return false;
      if (paymentFilter !== 'all' && exp.paymentMethod !== paymentFilter) return false;
      if (q) {
        const catName = (budgetNameMap.get(exp.categoryId) || '').toLowerCase();
        const matchTitle = exp.title.toLowerCase().includes(q);
        const matchNote = (exp.note || '').toLowerCase().includes(q);
        const matchCat = catName.includes(q);
        if (!matchTitle && !matchNote && !matchCat) return false;
      }
      return true;
    });
  }, [scopedExpenses, foreignOnly, categoryFilter, paymentFilter, searchTerm, budgetNameMap]);

  const scopeTitle =
    scopeFilter === 'all'
      ? '整趟行程'
      : scopeFilter === 'pre_trip'
      ? '行前消費'
      : `第 ${scopeFilter} 天`;

  return (
    <div className="space-y-4">
      {/* Scope Filter Bar (Green clickable buttons) */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onScopeFilterChange('all')}
            className={`h-10 px-3.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              scopeFilter === 'all' ? 'control-green-active' : 'control-green'
            }`}
          >
            整趟行程
          </button>
          <button
            type="button"
            onClick={() => onScopeFilterChange('pre_trip')}
            className={`h-10 px-3.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
              scopeFilter === 'pre_trip' ? 'control-green-active' : 'control-green'
            }`}
          >
            行前消費
          </button>
          {Array.from({ length: settings.tripDays }, (_, i) => i + 1).map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => onScopeFilterChange(day)}
              className={`h-10 px-3.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap ${
                scopeFilter === day ? 'control-green-active' : 'control-green'
              }`}
            >
              第 {day} 天
            </button>
          ))}
        </div>

        {/* Secondary Filters (Green controls) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onForeignOnlyChange(false)}
              className={`h-10 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                !foreignOnly ? 'control-green-active' : 'control-green'
              }`}
            >
              全部幣別
            </button>
            <button
              type="button"
              onClick={() => onForeignOnlyChange(true)}
              className={`h-10 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap ${
                foreignOnly ? 'control-green-active' : 'control-green'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>僅篩選外幣</span>
            </button>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="篩選預算類別"
            className="input-green h-10 px-3 rounded-lg text-xs sm:text-sm font-medium cursor-pointer"
          >
            <option value="all">所有預算類別</option>
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as 'all' | 'cash' | 'credit_card')}
            aria-label="篩選付款方式"
            className="input-green h-10 px-3 rounded-lg text-xs sm:text-sm font-medium cursor-pointer"
          >
            <option value="all">所有付款方式</option>
            <option value="cash">僅現金消費</option>
            <option value="credit_card">僅信用卡消費</option>
          </select>

          <div className="relative">
            <Search className="w-4 h-4 text-emerald-700 dark:text-emerald-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜尋項目或備註..."
              className="input-green w-full h-10 pl-9 pr-3 rounded-lg text-xs sm:text-sm"
            />
          </div>
        </div>
      </div>

      {/* Requirement #10: Yellow Read-Only Summary Displays for Selected Scope */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="display-yellow rounded-xl px-4 py-3.5">
          <div className="text-xs font-semibold opacity-80">
            {scopeTitle} · 總支出（折合台幣）
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-1">
            <span className="text-2xl font-mono-num font-bold">
              {formatTwd(scopeStats.totalTwd)}
            </span>
            <span className="text-xs opacity-75">{scopeStats.totalCount} 筆消費紀錄</span>
          </div>
        </div>

        <div className="display-yellow rounded-xl px-4 py-3.5">
          <div className="text-xs font-semibold opacity-80">
            {scopeTitle} · 外幣消費總額（不含純台幣消費）
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-1">
            <span className="text-2xl font-mono-num font-bold">
              {formatTwd(scopeStats.foreignTotalTwd)}
            </span>
            <span className="text-xs opacity-75">{scopeStats.foreignCount} 筆外幣消費</span>
          </div>
          <div className="text-xs font-mono-num opacity-85 mt-1 truncate">
            {scopeStats.foreignBreakdownText
              ? `原幣累計：${scopeStats.foreignBreakdownText}`
              : '此篩選範圍尚無外幣消費'}
          </div>
        </div>
      </div>

      {/* Expense List */}
      {visibleExpenses.length === 0 ? (
        <div className="display-yellow-soft rounded-xl py-10 px-4 text-center text-sm">
          目前「{scopeTitle}
          {foreignOnly ? ' · 外幣消費' : ''}」沒有符合條件的消費紀錄。
        </div>
      ) : (
        <>
          {/* Desktop High-Density Table */}
          <div className="hidden lg:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-xs text-slate-600 dark:text-slate-400">
                  <th className="text-left py-2.5 px-3.5 font-semibold">時段 / 日期</th>
                  <th className="text-left py-2.5 px-3.5 font-semibold">消費項目與類別</th>
                  <th className="text-left py-2.5 px-3.5 font-semibold">付款方式</th>
                  <th className="text-right py-2.5 px-3.5 font-semibold">原幣金額</th>
                  <th className="text-right py-2.5 px-3.5 font-semibold">匯率 / 1.5%手續費</th>
                  <th className="text-right py-2.5 px-3.5 font-semibold">折合台幣</th>
                  <th className="text-right py-2.5 px-3.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleExpenses.map((exp) => {
                  const catName = budgetNameMap.get(exp.categoryId) || '未分類';
                  const phaseLabel =
                    exp.phase === 'pre_trip' ? '行前消費' : `第 ${exp.dayNumber ?? 1} 天`;
                  return (
                    <tr
                      key={exp.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-3.5 align-top whitespace-nowrap">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {phaseLabel}
                        </div>
                        <div className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
                          {exp.expenseDate}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 align-top">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {exp.title}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {catName}
                          {exp.note ? ` · ${exp.note}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 align-top whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                          {exp.paymentMethod === 'credit_card' ? (
                            <CreditCard className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Banknote className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>{exp.paymentMethod === 'credit_card' ? '信用卡' : '現金'}</span>
                          <span aria-hidden="true">·</span>
                          <span>{exp.currency}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 align-top text-right font-mono-num font-semibold whitespace-nowrap">
                        {formatCurrencyAmount(exp.originalAmount, exp.currency)}
                      </td>
                      <td className="py-2.5 px-3.5 align-top text-right whitespace-nowrap">
                        <div className="display-yellow-soft inline-block rounded-md px-2 py-1 text-xs font-mono-num">
                          {exp.currency === 'TWD'
                            ? '1.0000 · 免手續費'
                            : `${exp.exchangeRate.toFixed(4)} · ${
                                exp.feeRate > 0 ? `+1.5% (${formatTwd(exp.feeTwd)})` : '0%'
                              }`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 align-top text-right whitespace-nowrap">
                        <div className="display-yellow inline-block rounded-md px-2.5 py-1 font-mono-num font-bold">
                          {formatTwd(exp.totalTwd)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 align-top text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onEditExpense(exp)}
                            className="control-green h-9 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>編輯</span>
                          </button>
                          {confirmDeleteId === exp.id ? (
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteExpense(exp.id);
                                setConfirmDeleteId(null);
                              }}
                              className="h-9 px-2.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                            >
                              確認刪除
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(exp.id)}
                              className="control-green h-9 px-2.5 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>刪除</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile / Tablet Touch-Friendly Cards */}
          <div className="lg:hidden space-y-2.5">
            {visibleExpenses.map((exp) => {
              const catName = budgetNameMap.get(exp.categoryId) || '未分類';
              const phaseLabel =
                exp.phase === 'pre_trip' ? '行前消費' : `第 ${exp.dayNumber ?? 1} 天`;
              return (
                <div
                  key={exp.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {phaseLabel} · {exp.expenseDate} · {catName}
                      </div>
                      <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                        {exp.title}
                      </div>
                    </div>
                    <div className="display-yellow shrink-0 rounded-lg px-2.5 py-1 text-right">
                      <div className="text-[10px] opacity-75">折合台幣</div>
                      <div className="font-mono-num font-bold text-sm">
                        {formatTwd(exp.totalTwd)}
                      </div>
                    </div>
                  </div>

                  <div className="display-yellow-soft rounded-lg px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {exp.paymentMethod === 'credit_card' ? '信用卡' : '現金'} ·{' '}
                      <strong className="font-mono-num">
                        {formatCurrencyAmount(exp.originalAmount, exp.currency)}
                      </strong>
                    </span>
                    <span className="font-mono-num">
                      {exp.currency === 'TWD'
                        ? '免手續費'
                        : `匯率 ${exp.exchangeRate.toFixed(4)} ${
                            exp.feeRate > 0 ? `+1.5% (${formatTwd(exp.feeTwd)})` : '· 0%'
                          }`}
                    </span>
                  </div>

                  {exp.note && (
                    <div className="text-xs text-slate-600 dark:text-slate-400">{exp.note}</div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onEditExpense(exp)}
                      className="control-green h-11 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>編輯修改</span>
                    </button>
                    {confirmDeleteId === exp.id ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteExpense(exp.id);
                          setConfirmDeleteId(null);
                        }}
                        className="h-11 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                      >
                        確認刪除此筆
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(exp.id)}
                        className="control-green h-11 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>刪除</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
