import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, X, CreditCard, Banknote, Calendar, PlaneTakeoff, PlusCircle } from 'lucide-react';
import type {
  BudgetItem,
  CurrencyCode,
  ExpensePhase,
  ExpenseRecord,
  LedgerSettings,
  LiveRatesPayload,
  PaymentMethod,
} from '../types';
import { formatCurrencyAmount, formatTwd, getCurrencyMeta } from '../constants/currencies';
import { addDaysToDateString, calculateExpenseTwd } from '../utils/calculations';
import { NumericCalculatorInput } from './NumericCalculatorInput';

interface ExpenseFormPanelProps {
  settings: LedgerSettings;
  budgets: BudgetItem[];
  rates: LiveRatesPayload | null;
  ratesLoading: boolean;
  onRefreshRates: () => Promise<void>;
  editingExpense: ExpenseRecord | null;
  onCancelEdit: () => void;
  onSubmitExpense: (expense: ExpenseRecord, isEdit: boolean) => Promise<void>;
  submitting?: boolean;
}

export const ExpenseFormPanel: React.FC<ExpenseFormPanelProps> = ({
  settings,
  budgets,
  rates,
  ratesLoading,
  onRefreshRates,
  editingExpense,
  onCancelEdit,
  onSubmitExpense,
  submitting = false,
}) => {
  const availableCurrencies = settings.currencies.includes('TWD')
    ? settings.currencies
    : (['TWD', ...settings.currencies] as CurrencyCode[]);

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(budgets[0]?.id || '');
  const [phase, setPhase] = useState<ExpensePhase>('on_trip');
  const [dayNumber, setDayNumber] = useState<number>(1);
  const [expenseDate, setExpenseDate] = useState<string>(settings.startDate);
  const [currency, setCurrency] = useState<CurrencyCode>(
    availableCurrencies.find((c) => c !== 'TWD') || 'TWD'
  );
  const [originalAmount, setOriginalAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Populate when editing an existing record
  useEffect(() => {
    if (editingExpense) {
      setTitle(editingExpense.title);
      setCategoryId(editingExpense.categoryId || budgets[0]?.id || '');
      setPhase(editingExpense.phase);
      setDayNumber(editingExpense.dayNumber ?? 1);
      setExpenseDate(editingExpense.expenseDate || settings.startDate);
      setCurrency(editingExpense.currency);
      setOriginalAmount(editingExpense.originalAmount);
      setPaymentMethod(editingExpense.paymentMethod);
      setNote(editingExpense.note || '');
      setErrorMsg('');
    }
  }, [editingExpense, budgets, settings.startDate]);

  // Keep categoryId valid if budgets list changes
  useEffect(() => {
    if (budgets.length > 0 && !budgets.some((b) => b.id === categoryId)) {
      setCategoryId(budgets[0].id);
    }
  }, [budgets, categoryId]);

  // Keep selected currency within trip's configured currencies (when adding new)
  useEffect(() => {
    if (!editingExpense && !availableCurrencies.includes(currency)) {
      setCurrency(availableCurrencies.find((c) => c !== 'TWD') || availableCurrencies[0] || 'TWD');
    }
  }, [availableCurrencies, currency, editingExpense]);

  // Auto-sync date when changing dayNumber on trip
  const handleDayChange = (nextDay: number) => {
    setDayNumber(nextDay);
    if (settings.startDate) {
      setExpenseDate(addDaysToDateString(settings.startDate, nextDay - 1));
    }
  };

  const handlePhaseChange = (nextPhase: ExpensePhase) => {
    setPhase(nextPhase);
    if (nextPhase === 'on_trip' && settings.startDate) {
      setExpenseDate(addDaysToDateString(settings.startDate, dayNumber - 1));
    }
  };

  const currencyMeta = getCurrencyMeta(currency, settings.customCurrencyNames);

  // Rate selection rule:
  // - TWD: 1
  // - Foreign + Credit Card: automatically fetch VISA live rate (fallback to ledger's applied VISA rate)
  // - Foreign + Cash: strictly apply pre-configured manual cash rate from Tab 4 (TripSettingsPanel)
  const effectiveRate = useMemo(() => {
    if (currency === 'TWD') return 1;
    if (paymentMethod === 'credit_card') {
      return (
        rates?.ratesToTwd?.[currency] ??
        settings.visaRates?.[currency] ??
        currencyMeta.defaultFallbackRateToTwd ??
        1
      );
    }
    const configuredCashRate = settings.cashRates?.[currency];
    return configuredCashRate && configuredCashRate > 0 ? configuredCashRate : 0;
  }, [currency, paymentMethod, rates, settings.visaRates, currencyMeta, settings.cashRates]);

  const missingCashRate =
    currency !== 'TWD' && paymentMethod === 'cash' && (!effectiveRate || effectiveRate <= 0);

  const rateSourceLabel = useMemo(() => {
    if (currency === 'TWD') {
      return paymentMethod === 'credit_card' ? '台幣刷卡（免手續費）' : '台幣現金';
    }
    if (paymentMethod === 'credit_card') {
      const isDirectVisa = rates?.visaDirectCurrencies?.includes(currency);
      return isDirectVisa ? 'VISA 官方即時匯率' : 'VISA即時匯率';
    }
    return missingCashRate ? '尚未設定現金固定匯率' : '出國前現金固定匯率';
  }, [currency, paymentMethod, rates, missingCashRate]);

  const calc = useMemo(
    () =>
      calculateExpenseTwd({
        currency,
        originalAmount,
        paymentMethod,
        exchangeRate: effectiveRate > 0 ? effectiveRate : 0,
      }),
    [currency, originalAmount, paymentMethod, effectiveRate]
  );

  const resetForm = () => {
    setTitle('');
    setOriginalAmount(0);
    setNote('');
    setErrorMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('請輸入消費項目名稱');
      return;
    }
    if (originalAmount <= 0) {
      setErrorMsg('請輸入大於 0 的消費金額');
      return;
    }
    if (missingCashRate) {
      setErrorMsg(`請先至「行程與貨幣設定」頁籤設定 ${currency} 的出國前固定現金匯率`);
      return;
    }
    setErrorMsg('');

    const now = Date.now();
    const record: ExpenseRecord = {
      id: editingExpense?.id || `exp_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      categoryId: categoryId || budgets[0]?.id || 'b_misc',
      phase,
      dayNumber: phase === 'on_trip' ? dayNumber : null,
      expenseDate: expenseDate || settings.startDate,
      currency,
      originalAmount,
      paymentMethod,
      exchangeRate: calc.exchangeRate,
      feeRate: calc.feeRate,
      feeTwd: calc.feeTwd,
      totalTwd: calc.totalTwd,
      rateSource: rateSourceLabel,
      note: note.trim(),
      createdAt: editingExpense?.createdAt || now,
      updatedAt: now,
    };

    await onSubmitExpense(record, Boolean(editingExpense));
    if (editingExpense) {
      onCancelEdit();
    }
    resetForm();
  };

  const isForeignCard = paymentMethod === 'credit_card' && currency !== 'TWD';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {editingExpense && (
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-100/80 dark:bg-emerald-900/50 border border-emerald-400 dark:border-emerald-700 text-emerald-950 dark:text-emerald-100 text-xs font-semibold">
          <span>正在編輯消費紀錄：{editingExpense.title}</span>
          <button
            type="button"
            onClick={() => {
              onCancelEdit();
              resetForm();
            }}
            className="control-green px-2.5 py-1 rounded-lg flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" />
            <span>取消編輯</span>
          </button>
        </div>
      )}

      {/* Row 1: Item Name & Budget Category */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            消費項目說明
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：築地市場壽司、機場快線車票..."
            className="input-green w-full h-11 px-3 rounded-lg text-sm font-medium"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            預算類別
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="input-green w-full h-11 px-3 rounded-lg text-sm font-medium cursor-pointer"
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Phase (Pre-trip vs On-trip) & Day / Date */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            消費階段
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => handlePhaseChange('pre_trip')}
              className={`h-11 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                phase === 'pre_trip' ? 'control-green-active' : 'control-green'
              }`}
            >
              <PlaneTakeoff className="w-4 h-4 shrink-0" />
              <span>行前消費</span>
            </button>
            <button
              type="button"
              onClick={() => handlePhaseChange('on_trip')}
              className={`h-11 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                phase === 'on_trip' ? 'control-green-active' : 'control-green'
              }`}
            >
              <Calendar className="w-4 h-4 shrink-0" />
              <span>行程中</span>
            </button>
          </div>
        </div>

        {phase === 'on_trip' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              行程天數
            </label>
            <select
              value={dayNumber}
              onChange={(e) => handleDayChange(Number(e.target.value))}
              className="input-green w-full h-11 px-3 rounded-lg text-sm font-medium cursor-pointer"
            >
              {Array.from({ length: settings.tripDays }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  第 {d} 天 ({addDaysToDateString(settings.startDate, d - 1)})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="display-yellow-soft rounded-lg px-3 py-2 flex flex-col justify-center">
            <span className="text-[11px] opacity-75">歸屬時段</span>
            <span className="text-sm font-semibold">行前預付 / 準備費用</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            消費日期
          </label>
          <input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="input-green w-full h-11 px-3 rounded-lg text-sm font-mono-num"
          />
        </div>
      </div>

      {/* Row 3: Currency, Payment Method & Amount (with Calculator) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            消費幣別（已設定幣別）
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="input-green w-full h-11 px-3 rounded-lg text-sm font-semibold cursor-pointer"
          >
            {availableCurrencies.map((c) => {
              const meta = getCurrencyMeta(c, settings.customCurrencyNames);
              return (
                <option key={c} value={c}>
                  {c} · {meta.name}
                </option>
              );
            })}
          </select>
        </div>

        <div className="lg:col-span-4">
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            付款方式
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`h-11 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                paymentMethod === 'cash' ? 'control-green-active' : 'control-green'
              }`}
            >
              <Banknote className="w-4 h-4 shrink-0" />
              <span>現金</span>
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('credit_card')}
              className={`h-11 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                paymentMethod === 'credit_card' ? 'control-green-active' : 'control-green'
              }`}
            >
              <CreditCard className="w-4 h-4 shrink-0" />
              <span>信用卡</span>
            </button>
          </div>
        </div>

        <div className="sm:col-span-2 lg:col-span-5">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            輸入消費金額 ({currency})
          </label>
          <NumericCalculatorInput
            value={originalAmount}
            onChange={setOriginalAmount}
            prefix={currencyMeta.symbol}
            allowDecimal={currencyMeta.decimals !== 0}
            ariaLabel="消費金額"
          />
        </div>
      </div>

      {/* Row 4: Yellow Read-Only Conversion & Fee Breakdown Box */}
      <div className="display-yellow rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold">
            {currency === 'TWD'
              ? paymentMethod === 'credit_card'
                ? '信用卡台幣結帳（不加計 1.5% 海外手續費）'
                : '台幣現金結帳（無手續費）'
              : isForeignCard
              ? '信用卡外幣結帳（自動抓取 VISA 即時匯率 + 1.5% 刷卡手續費）'
              : missingCashRate
              ? `尚未設定 ${currency} 的出國前換匯現金固定匯率，請先至「行程與貨幣設定」頁籤輸入`
              : '外幣現金結帳（套用行程與貨幣設定之出國前固定現金匯率，免手續費）'}
          </div>
          {isForeignCard && (
            <button
              type="button"
              onClick={onRefreshRates}
              disabled={ratesLoading}
              className="control-green h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ratesLoading ? 'animate-spin' : ''}`} />
              <span>手動更新 VISA 匯率</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          <div className="rounded-lg bg-yellow-200/50 dark:bg-yellow-900/35 px-3 py-2">
            <div className="text-[11px] opacity-75">採用匯率 ({rateSourceLabel})</div>
            <div className="font-mono-num font-bold text-sm mt-0.5">
              {currency === 'TWD'
                ? '1.0000'
                : effectiveRate > 0
                ? `1 ${currency} = ${effectiveRate.toFixed(4)} TWD`
                : '未設定'}
            </div>
          </div>

          <div className="rounded-lg bg-yellow-200/50 dark:bg-yellow-900/35 px-3 py-2">
            <div className="text-[11px] opacity-75">刷卡手續費 (1.5%)</div>
            <div className="font-mono-num font-bold text-sm mt-0.5">
              {isForeignCard ? `+1.5% (${formatTwd(calc.feeTwd)})` : '0% (NT$ 0)'}
            </div>
          </div>

          <div className="rounded-lg bg-yellow-200/50 dark:bg-yellow-900/35 px-3 py-2">
            <div className="text-[11px] opacity-75">含手續費原幣總額</div>
            <div className="font-mono-num font-bold text-sm mt-0.5">
              {formatCurrencyAmount(calc.foreignWithFee, currency)}
            </div>
          </div>

          <div className="rounded-lg bg-yellow-300/60 dark:bg-yellow-800/45 px-3 py-2 border border-yellow-500/40">
            <div className="text-[11px] font-semibold opacity-85">最終折合台幣</div>
            <div className="font-mono-num font-bold text-base mt-0.5">
              {missingCashRate ? '請先設匯率' : formatTwd(calc.totalTwd)}
            </div>
          </div>
        </div>

        {availableCurrencies.some((c) => c !== 'TWD') && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-yellow-400/40 dark:border-yellow-700/40 text-[11px]">
            <span className="font-semibold opacity-80">本帳本所選外幣 VISA 匯率：</span>
            {availableCurrencies
              .filter((c) => c !== 'TWD')
              .map((c) => {
                const applied = rates?.ratesToTwd?.[c] ?? settings.visaRates?.[c];
                return (
                  <span key={c} className="font-mono-num font-semibold">
                    1 {c} = {applied && applied > 0 ? `${applied.toFixed(4)} TWD` : '待更新'}
                  </span>
                );
              })}
            {(settings.visaRateDate || rates?.rateDate) && (
              <span className="opacity-70 font-mono-num">
                ({settings.visaRateDate || rates?.rateDate})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Row 5: Optional Note & Submit */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            備註（選填）
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="商家名稱、分帳說明或發票備註..."
            className="input-green w-full h-11 px-3 rounded-lg text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="control-green-active h-11 px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shrink-0 shadow-sm disabled:opacity-50"
        >
          {editingExpense ? <Save className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
          <span>
            {submitting
              ? '同步儲存中...'
              : editingExpense
              ? '儲存修改紀錄'
              : '新增消費紀錄'}
          </span>
        </button>
      </div>

      {errorMsg && (
        <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
          {errorMsg}
        </div>
      )}
    </form>
  );
};
