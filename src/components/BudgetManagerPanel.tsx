import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Check, Pencil, X, ArrowUp, ArrowDown } from 'lucide-react';
import type { BudgetItem } from '../types';
import { formatTwd } from '../constants/currencies';
import { NumericCalculatorInput } from './NumericCalculatorInput';

interface BudgetManagerPanelProps {
  budgets: BudgetItem[];
  onSaveBudgets: (nextBudgets: BudgetItem[]) => Promise<void>;
  saving?: boolean;
}

export const BudgetManagerPanel: React.FC<BudgetManagerPanelProps> = ({
  budgets,
  onSaveBudgets,
  saving = false,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState(0);
  const [savedNotice, setSavedNotice] = useState(false);

  // If currently edited item was deleted externally via sync, exit edit mode
  useEffect(() => {
    if (editingId && !budgets.some((b) => b.id === editingId)) {
      setEditingId(null);
    }
  }, [budgets, editingId]);

  const totalBudget = budgets.reduce((sum, item) => sum + (Number(item.budgetTwd) || 0), 0);

  const triggerSavedNotice = () => {
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleStartEdit = (item: BudgetItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAmount(item.budgetTwd);
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditAmount(0);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    const next = budgets.map((item, idx) =>
      item.id === id
        ? {
            ...item,
            name: trimmed,
            budgetTwd: Math.max(0, Math.round(editAmount)),
            order: idx,
          }
        : { ...item, order: idx }
    );
    await onSaveBudgets(next);
    setEditingId(null);
    triggerSavedNotice();
  };

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= budgets.length) return;
    const reordered = [...budgets];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const next = reordered.map((item, idx) => ({ ...item, order: idx }));
    await onSaveBudgets(next);
    triggerSavedNotice();
  };

  const handleDeleteItem = async (id: string) => {
    const next = budgets
      .filter((item) => item.id !== id)
      .map((item, idx) => ({ ...item, order: idx }));
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
      order: budgets.length,
    };
    const next = [...budgets, item];
    setNewName('');
    setNewAmount(0);
    await onSaveBudgets(next);
    triggerSavedNotice();
  };

  return (
    <div className="space-y-4">
      {/* Summary Header (Yellow read-only) */}
      <div className="display-yellow rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium opacity-80">旅遊總預算設定（以新台幣 TWD 為基準）</div>
          <div className="text-xl font-mono-num font-bold mt-0.5">{formatTwd(totalBudget)}</div>
        </div>
        <div className="text-xs font-semibold flex items-center gap-1.5 opacity-85">
          {savedNotice ? (
            <>
              <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
              <span>已儲存</span>
            </>
          ) : saving ? (
            <span>儲存中...</span>
          ) : (
            <span>共 {budgets.length} 項預算</span>
          )}
        </div>
      </div>

      {/* Budget Items List with Reorder, Edit & Delete Controls */}
      <div className="space-y-2.5">
        {budgets.map((item, idx) => {
          const isEditing = editingId === item.id;

          if (isEditing) {
            return (
              <div
                key={item.id}
                className="p-3 rounded-xl border-2 border-emerald-500 dark:border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/25 space-y-2.5"
              >
                <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  正在編輯預算項目
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_240px_auto] gap-2.5 items-center">
                  <input
                    type="text"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="輸入預算項目名稱"
                    className="input-green w-full h-11 px-3 rounded-lg text-sm font-semibold"
                  />

                  <NumericCalculatorInput
                    value={editAmount}
                    onChange={(val) => setEditAmount(Math.round(val))}
                    prefix="NT$"
                    allowDecimal={false}
                    ariaLabel={`${item.name} 預算金額`}
                  />

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
              className="grid grid-cols-1 sm:grid-cols-[1fr_200px_auto] gap-2.5 items-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            >
              <div className="display-yellow-soft h-11 px-3.5 rounded-lg flex items-center gap-2 text-sm font-semibold min-w-0">
                <span className="text-xs font-mono-num opacity-65 shrink-0">{idx + 1}.</span>
                <span className="truncate">{item.name}</span>
              </div>

              <div className="display-yellow h-11 px-3.5 rounded-lg flex items-center justify-between gap-2 font-mono-num font-bold text-sm">
                <span className="text-xs font-normal opacity-75">預算</span>
                <span>{formatTwd(item.budgetTwd)}</span>
              </div>

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
                  className="control-green flex-1 sm:flex-none h-11 px-3.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
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
        className="p-3 rounded-xl border border-dashed border-emerald-400 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20"
      >
        <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200 mb-2">
          新增預算項目
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_240px_auto] gap-2.5 items-center">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例如：當地租車、伴手禮..."
            className="input-green w-full h-11 px-3 rounded-lg text-sm"
          />
          <NumericCalculatorInput
            value={newAmount}
            onChange={(val) => setNewAmount(Math.round(val))}
            prefix="NT$"
            allowDecimal={false}
            ariaLabel="新預算項目金額"
          />
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
