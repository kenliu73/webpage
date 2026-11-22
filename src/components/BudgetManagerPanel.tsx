import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, Check, Pencil, X, ArrowUp, ArrowDown } from 'lucide-react';
import type { BudgetItem } from '../types';
import { formatTwd } from '../constants/currencies';
import { NumericCalculatorInput } from './NumericCalculatorInput';

interface BudgetManagerPanelProps {
  budgets: BudgetItem[];
  onSaveBudgets: (nextBudgets: BudgetItem[]) => Promise<void>;
  saving?: boolean;
}

function getBudgetValue(item: BudgetItem): number {
  return Math.max(0, Math.round(Number(item.budgetTwd) || 0));
}

function getPreparedValue(item: BudgetItem): number {
  return Math.max(0, Math.round(Number(item.preparedTwd) || 0));
}

export const BudgetManagerPanel: React.FC<BudgetManagerPanelProps> = ({
  budgets,
  onSaveBudgets,
  saving = false,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [editPrepared, setEditPrepared] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState(0);
  const [newPrepared, setNewPrepared] = useState(0);
  const [savedNotice, setSavedNotice] = useState(false);

  const [preparedDrafts, setPreparedDrafts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const item of budgets) {
      initial[item.id] = getPreparedValue(item);
    }
    return initial;
  });
  const preparedDraftsRef = useRef<Record<string, number>>(preparedDrafts);
  preparedDraftsRef.current = preparedDrafts;

  // Sync draft values when budgets prop changes (e.g., switching trips or importing backups)
  useEffect(() => {
    setPreparedDrafts(() => {
      const next: Record<string, number> = {};
      for (const item of budgets) {
        next[item.id] = getPreparedValue(item);
      }
      return next;
    });
  }, [budgets]);

  // If currently edited item was removed, exit edit mode
  useEffect(() => {
    if (editingId && !budgets.some((b) => b.id === editingId)) {
      setEditingId(null);
    }
  }, [budgets, editingId]);

  const getEffectivePrepared = (item: BudgetItem): number => {
    if (editingId === item.id) {
      return Math.max(0, Math.round(editPrepared));
    }
    if (item.id in preparedDrafts) {
      return Math.max(0, Math.round(preparedDrafts[item.id] || 0));
    }
    return getPreparedValue(item);
  };

  const totalBudget = budgets.reduce((sum, item) => sum + getBudgetValue(item), 0);
  const totalPrepared = budgets.reduce((sum, item) => sum + getEffectivePrepared(item), 0);
  const totalDiff = totalPrepared - totalBudget;
  const readyCount = budgets.filter((item) => {
    const b = getBudgetValue(item);
    const p = getEffectivePrepared(item);
    return b > 0 && p >= b;
  }).length;
  const overallPct =
    totalBudget > 0 ? Math.min(100, Math.round((totalPrepared / totalBudget) * 100)) : 0;

  const triggerSavedNotice = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handlePreparedNumericChange = (id: string, nextVal: number) => {
    const normalized = Math.max(0, Math.round(nextVal));
    const nextDrafts = { ...preparedDraftsRef.current, [id]: normalized };
    preparedDraftsRef.current = nextDrafts;
    setPreparedDrafts(nextDrafts);
  };

  const commitPreparedValue = async (id: string, finalVal: number) => {
    const target = budgets.find((b) => b.id === id);
    if (!target) return;

    const normalized = Math.max(0, Math.round(finalVal));
    const currentSaved = getPreparedValue(target);
    const nextDrafts = { ...preparedDraftsRef.current, [id]: normalized };
    preparedDraftsRef.current = nextDrafts;
    setPreparedDrafts(nextDrafts);

    if (normalized === currentSaved) return;

    const next = budgets.map((item, idx) =>
      item.id === id
        ? { ...item, preparedTwd: normalized, order: idx }
        : { ...item, order: idx }
    );
    await onSaveBudgets(next);
    triggerSavedNotice();
  };

  const handleStartEdit = (item: BudgetItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAmount(getBudgetValue(item));
    setEditPrepared(getEffectivePrepared(item));
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditAmount(0);
    setEditPrepared(0);
  };

  const mergeDraftsIntoBudgets = (list: BudgetItem[]): BudgetItem[] =>
    list.map((item, idx) => {
      const hasDraft = item.id in preparedDraftsRef.current;
      const preparedTwd = hasDraft
        ? Math.max(0, Math.round(preparedDraftsRef.current[item.id] || 0))
        : getPreparedValue(item);
      return { ...item, preparedTwd, order: idx };
    });

  const handleSaveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const nextBudget = Math.max(0, Math.round(editAmount));
    const nextPrepared = Math.max(0, Math.round(editPrepared));
    const next = mergeDraftsIntoBudgets(budgets).map((item, idx) =>
      item.id === id
        ? {
            ...item,
            name: trimmed,
            budgetTwd: nextBudget,
            preparedTwd: nextPrepared,
            order: idx,
          }
        : { ...item, order: idx }
    );
    await onSaveBudgets(next);
    setPreparedDrafts((prev) => ({
      ...prev,
      [id]: nextPrepared,
    }));
    setEditingId(null);
    triggerSavedNotice();
  };

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= budgets.length) return;
    const reordered = [...mergeDraftsIntoBudgets(budgets)];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const next = reordered.map((item, idx) => ({ ...item, order: idx }));
    await onSaveBudgets(next);
    triggerSavedNotice();
  };

  const handleDeleteItem = async (id: string) => {
    const next = mergeDraftsIntoBudgets(budgets.filter((item) => item.id !== id));
    await onSaveBudgets(next);
    setConfirmDeleteId(null);
    if (editingId === id) {
      setEditingId(null);
    }
    triggerSavedNotice();
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const item: BudgetItem = {
      id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      budgetTwd: Math.max(0, Math.round(newAmount)),
      preparedTwd: Math.max(0, Math.round(newPrepared)),
      order: budgets.length,
    };
    const next = [...mergeDraftsIntoBudgets(budgets), item];
    setNewName('');
    setNewAmount(0);
    setNewPrepared(0);
    await onSaveBudgets(next);
    triggerSavedNotice();
  };

  return (
    <div className="space-y-4">
      {/* Summary Header (Yellow read-only) */}
      <div className="display-yellow rounded-xl px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-x-6 gap-y-2 flex-1 min-w-0">
            <div>
              <div className="text-[11px] sm:text-xs font-medium opacity-80">
                旅遊總預算（TWD）
              </div>
              <div className="text-lg sm:text-xl font-mono-num font-bold mt-0.5">
                {formatTwd(totalBudget)}
              </div>
            </div>

            <div>
              <div className="text-[11px] sm:text-xs font-medium opacity-80">
                資金已準備總額
              </div>
              <div className="text-lg sm:text-xl font-mono-num font-bold mt-0.5 text-emerald-800 dark:text-emerald-300">
                {formatTwd(totalPrepared)}
              </div>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <div className="text-[11px] sm:text-xs font-medium opacity-80">
                整體備款狀態
              </div>
              <div className="text-sm sm:text-base font-mono-num font-bold mt-0.5">
                {totalBudget === 0 ? (
                  <span className="opacity-75">尚未設定預算</span>
                ) : totalDiff >= 0 ? (
                  <span className="text-emerald-800 dark:text-emerald-300">
                    {totalDiff === 0
                      ? '✓ 已全部準備齊全'
                      : `✓ 已準備齊 (+${formatTwd(totalDiff)})`}
                  </span>
                ) : (
                  <span className="text-rose-700 dark:text-rose-300">
                    尚缺 {formatTwd(Math.abs(totalDiff))}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="text-xs font-semibold flex items-center gap-1.5 opacity-85 shrink-0">
            {savedNotice ? (
              <>
                <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                <span>已儲存</span>
              </>
            ) : saving ? (
              <span>儲存中...</span>
            ) : (
              <span>
                共 {budgets.length} 項 · 已齊 {readyCount} 項
              </span>
            )}
          </div>
        </div>

        {totalBudget > 0 && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-yellow-200/80 dark:bg-yellow-900/50 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  totalPrepared >= totalBudget
                    ? 'bg-emerald-600 dark:bg-emerald-400'
                    : 'bg-amber-500 dark:bg-amber-400'
                }`}
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] opacity-75">
              <span>提示：手機版點擊「已準備」欄即開啟計算機輸入；套用或離開欄位自動儲存</span>
              <span className="font-mono-num font-semibold">{overallPct}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Budget Items List with Same-Row Budget + Prepared Funds */}
      <div className="space-y-2.5">
        {budgets.map((item, idx) => {
          const isEditing = editingId === item.id;
          const budget = getBudgetValue(item);
          const prepared = getEffectivePrepared(item);
          const diff = prepared - budget;

          if (isEditing) {
            return (
              <div
                key={item.id}
                className="p-3 rounded-xl border-2 border-emerald-500 dark:border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/25 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    正在編輯預算項目
                  </span>
                  <span className="text-[11px] font-semibold">
                    {editAmount > 0 && editPrepared >= editAmount ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        ✓ 已準備齊
                        {editPrepared > editAmount
                          ? ` (+${formatTwd(editPrepared - editAmount)})`
                          : ''}
                      </span>
                    ) : editAmount > 0 ? (
                      <span className="text-amber-700 dark:text-amber-300">
                        尚缺 {formatTwd(editAmount - editPrepared)}
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(160px,1fr)_minmax(380px,460px)_auto] gap-2.5 items-end">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
                      預算項目名稱
                    </label>
                    <input
                      type="text"
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="輸入預算項目名稱"
                      className="input-green w-full h-11 px-3 rounded-lg text-sm font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
                        預算金額
                      </label>
                      <NumericCalculatorInput
                        value={editAmount}
                        onChange={(val) => setEditAmount(Math.round(val))}
                        prefix="NT$"
                        allowDecimal={false}
                        ariaLabel={`${item.name} 預算金額`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
                        資金已準備
                      </label>
                      <NumericCalculatorInput
                        value={editPrepared}
                        onChange={(val) => setEditPrepared(Math.round(val))}
                        prefix="NT$"
                        mobileCalculatorOnly
                        allowDecimal={false}
                        ariaLabel={`${item.name} 資金已準備金額`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(item.id)}
                      disabled={saving || !editName.trim()}
                      className="control-green-active flex-1 sm:flex-none h-11 px-4 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-45"
                    >
                      <Save className="w-4 h-4" />
                      <span>儲存</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="control-green h-11 px-3 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
                    >
                      <X className="w-4 h-4" />
                      <span>取消</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="grid grid-cols-1 lg:grid-cols-[minmax(180px,1fr)_minmax(390px,460px)_auto] gap-2 sm:gap-2.5 items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            >
              {/* Item Name + Readiness Status Badge */}
              <div className="display-yellow-soft h-11 px-3 rounded-lg flex items-center justify-between gap-2 text-sm font-semibold min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono-num opacity-65 shrink-0">{idx + 1}.</span>
                  <span className="truncate">{item.name}</span>
                </div>

                {budget === 0 && prepared === 0 ? (
                  <span className="text-[11px] font-medium opacity-60 shrink-0 whitespace-nowrap">
                    未設預算
                  </span>
                ) : prepared >= budget ? (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-200 shrink-0 whitespace-nowrap font-mono-num">
                    {diff > 0 ? `✓ 已齊 +${formatTwd(diff)}` : '✓ 已準備齊'}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 shrink-0 whitespace-nowrap font-mono-num">
                    缺 {formatTwd(budget - prepared)}
                  </span>
                )}
              </div>

              {/* Same-row Budget (Yellow read-only) & Prepared Funds Input with Calculator (Green editable) on Mobile & Desktop */}
              <div className="grid grid-cols-[minmax(106px,0.78fr)_minmax(0,1.22fr)] sm:grid-cols-[minmax(140px,0.82fr)_minmax(0,1.18fr)] gap-1.5 sm:gap-2 min-w-0 items-center">
                <div className="display-yellow h-11 px-2 sm:px-3 rounded-lg flex items-center justify-between gap-1 font-mono-num font-bold text-xs sm:text-sm min-w-0">
                  <span className="text-[11px] sm:text-xs font-normal opacity-75 shrink-0">
                    預算
                  </span>
                  <span className="truncate">{formatTwd(budget)}</span>
                </div>

                <NumericCalculatorInput
                  value={prepared}
                  onChange={(val) => handlePreparedNumericChange(item.id, val)}
                  onCommit={(val) => void commitPreparedValue(item.id, val)}
                  prefix="已準備"
                  compactPrefix
                  hideCalcLabel
                  blurOnEnter
                  mobileCalculatorOnly
                  allowDecimal={false}
                  ariaLabel={`${item.name} 資金已準備金額`}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5 justify-end flex-wrap">
                <button
                  type="button"
                  onClick={() => handleMoveItem(idx, -1)}
                  disabled={saving || idx === 0}
                  title="上移順序"
                  aria-label={`上移 ${item.name}`}
                  className="control-green h-11 w-11 rounded-lg flex items-center justify-center disabled:opacity-35"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveItem(idx, 1)}
                  disabled={saving || idx === budgets.length - 1}
                  title="下移順序"
                  aria-label={`下移 ${item.name}`}
                  className="control-green h-11 w-11 rounded-lg flex items-center justify-center disabled:opacity-35"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handleStartEdit(item)}
                  className="control-green flex-1 lg:flex-none h-11 px-3.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>編輯</span>
                </button>

                {confirmDeleteId === item.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      className="h-11 px-3 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
                    >
                      確認刪除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="control-green h-11 px-2.5 rounded-lg text-xs font-semibold"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(item.id)}
                    disabled={budgets.length <= 1}
                    title="刪除此預算項目"
                    aria-label={`刪除 ${item.name}`}
                    className="control-green h-11 px-3 rounded-lg flex items-center justify-center gap-1 text-xs sm:text-sm font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-35 whitespace-nowrap"
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

      {/* Add New Budget Item Form */}
      <form
        onSubmit={handleAddItem}
        className="p-3 rounded-xl border border-dashed border-emerald-400 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2"
      >
        <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
          新增預算項目
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(160px,1fr)_minmax(380px,460px)_auto] gap-2.5 items-end">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
              項目名稱
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例如：當地租車、伴手禮..."
              className="input-green w-full h-11 px-3 rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
                預算金額
              </label>
              <NumericCalculatorInput
                value={newAmount}
                onChange={(val) => setNewAmount(Math.round(val))}
                prefix="NT$"
                allowDecimal={false}
                ariaLabel="新預算項目金額"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
                資金已準備
              </label>
              <NumericCalculatorInput
                value={newPrepared}
                onChange={(val) => setNewPrepared(Math.round(val))}
                prefix="NT$"
                mobileCalculatorOnly
                allowDecimal={false}
                ariaLabel="新預算項目資金已準備金額"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!newName.trim() || saving}
            className="control-green-active h-11 px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            <Plus className="w-4 h-4" />
            <span>新增項目</span>
          </button>
        </div>
      </form>
    </div>
  );
};
