import React, { useEffect, useState } from 'react';
import { Check, Save, Lock, Plus, X } from 'lucide-react';
import type { CurrencyCode, LedgerSettings, LiveRatesPayload } from '../types';
import { CURRENCY_CATALOG, getCurrencyMeta } from '../constants/currencies';
import { addDaysToDateString, diffDaysInclusive } from '../utils/calculations';
import { NumericCalculatorInput } from './NumericCalculatorInput';

interface TripSettingsPanelProps {
  settings: LedgerSettings;
  rates?: LiveRatesPayload | null;
  onSaveSettings: (nextSettings: LedgerSettings) => Promise<void>;
  saving?: boolean;
}

export const TripSettingsPanel: React.FC<TripSettingsPanelProps> = ({
  settings,
  rates = null,
  onSaveSettings,
  saving = false,
}) => {
  const resolveEndDate = (s: LedgerSettings) =>
    s.endDate || addDaysToDateString(s.startDate, Math.max(0, (s.tripDays || 1) - 1));

  const [draft, setDraft] = useState<LedgerSettings>(() => ({
    ...settings,
    endDate: resolveEndDate(settings),
  }));
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customError, setCustomError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft({
      ...settings,
      endDate: resolveEndDate(settings),
    });
  }, [settings]);

  const toggleCurrency = (code: CurrencyCode) => {
    if (code === 'TWD') return; // TWD is mandatory
    setDraft((prev) => {
      const exists = prev.currencies.includes(code);
      const nextCurrencies = exists
        ? prev.currencies.filter((c) => c !== code)
        : [...prev.currencies, code];

      const nextCashRates = { ...prev.cashRates };
      if (!exists && nextCashRates[code] === undefined) {
        nextCashRates[code] = 0;
      }

      return {
        ...prev,
        currencies: ['TWD', ...nextCurrencies.filter((c) => c !== 'TWD')],
        cashRates: nextCashRates,
      };
    });
  };

  const handleAddCustomCurrency = () => {
    const cleanedCode = customCode.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (cleanedCode.length < 2 || cleanedCode.length > 8) {
      setCustomError('請輸入 2～8 碼英文貨幣代碼（例如 NZD、PHP、IDR）');
      return;
    }
    setCustomError('');
    const displayName = customName.trim() || cleanedCode;

    setDraft((prev) => {
      const exists = prev.currencies.includes(cleanedCode);
      const nextCurrencies = exists
        ? prev.currencies
        : ['TWD', ...prev.currencies.filter((c) => c !== 'TWD'), cleanedCode];
      const nextNames = {
        ...(prev.customCurrencyNames || {}),
        [cleanedCode]: displayName,
      };
      const nextCashRates = { ...prev.cashRates };
      if (nextCashRates[cleanedCode] === undefined) {
        nextCashRates[cleanedCode] = 0;
      }
      return {
        ...prev,
        currencies: nextCurrencies,
        customCurrencyNames: nextNames,
        cashRates: nextCashRates,
      };
    });

    setCustomCode('');
    setCustomName('');
  };

  const handleStartDateChange = (nextStart: string) => {
    setDraft((prev) => {
      const currentEnd = prev.endDate || resolveEndDate(prev);
      let nextEnd = currentEnd;
      if (nextStart && (!nextEnd || nextEnd < nextStart)) {
        nextEnd = addDaysToDateString(nextStart, Math.max(0, (prev.tripDays || 1) - 1));
      }
      const nextDays = nextStart && nextEnd ? diffDaysInclusive(nextStart, nextEnd) : prev.tripDays;
      return {
        ...prev,
        startDate: nextStart,
        endDate: nextEnd,
        tripDays: nextDays,
      };
    });
  };

  const handleEndDateChange = (nextEnd: string) => {
    setDraft((prev) => {
      const safeEnd = prev.startDate && nextEnd < prev.startDate ? prev.startDate : nextEnd;
      const nextDays =
        prev.startDate && safeEnd ? diffDaysInclusive(prev.startDate, safeEnd) : prev.tripDays;
      return {
        ...prev,
        endDate: safeEnd,
        tripDays: nextDays,
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(draft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const presetCodes = new Set(CURRENCY_CATALOG.map((c) => c.code));
  const customSelectedCodes = draft.currencies.filter((c) => !presetCodes.has(c));
  const foreignCurrencies = draft.currencies.filter((c) => c !== 'TWD');
  const currentEndDate = draft.endDate || resolveEndDate(draft);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Trip Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            旅遊行程名稱
          </label>
          <input
            type="text"
            value={draft.tripName}
            onChange={(e) => setDraft({ ...draft, tripName: e.target.value })}
            placeholder="例如：2026 東京五日自由行"
            className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-semibold"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            出發日期
          </label>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-mono-num"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            回程日期（共 {draft.tripDays} 天）
          </label>
          <input
            type="date"
            value={currentEndDate}
            min={draft.startDate}
            onChange={(e) => handleEndDateChange(e.target.value)}
            className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-mono-num"
          />
        </div>
      </div>

      {/* Trip Currencies Selector (TWD locked + clickable green chips + custom input) */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            本次旅遊使用貨幣（台幣 TWD 為當然貨幣）
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            點選本次行程使用的貨幣，若選單中沒有需要的幣別，可於下方自行輸入貨幣代碼新增。
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {CURRENCY_CATALOG.map((curr) => {
            const isTwd = curr.code === 'TWD';
            const selected = isTwd || draft.currencies.includes(curr.code);
            return (
              <button
                key={curr.code}
                type="button"
                disabled={isTwd}
                onClick={() => toggleCurrency(curr.code)}
                className={`h-11 px-3 rounded-lg text-xs font-semibold flex items-center justify-between gap-1.5 ${
                  isTwd
                    ? 'display-yellow cursor-not-allowed'
                    : selected
                    ? 'control-green-active'
                    : 'control-green opacity-85'
                }`}
              >
                <span className="truncate">
                  {curr.code} {curr.name}
                </span>
                {isTwd ? (
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                ) : selected ? (
                  <Check className="w-3.5 h-3.5 shrink-0" />
                ) : null}
              </button>
            );
          })}

          {customSelectedCodes.map((code) => {
            const meta = getCurrencyMeta(code, draft.customCurrencyNames);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggleCurrency(code)}
                title="點擊移除此自訂貨幣"
                className="control-green-active h-11 px-3 rounded-lg text-xs font-semibold flex items-center justify-between gap-1.5"
              >
                <span className="truncate">
                  {meta.code} {meta.name !== meta.code ? meta.name : '自訂'}
                </span>
                <X className="w-3.5 h-3.5 shrink-0" />
              </button>
            );
          })}
        </div>

        {/* Custom Currency Input Row */}
        <div className="p-3.5 rounded-xl border border-dashed border-emerald-400 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
          <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            自行輸入其他旅遊貨幣（若上方清單沒有您需要的幣別）
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2.5 items-center">
            <input
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              placeholder="代碼如 NZD, PHP"
              maxLength={8}
              className="input-green h-11 px-3 rounded-lg text-base sm:text-sm font-mono-num uppercase"
            />
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="貨幣名稱（選填，如：紐西蘭幣、菲律賓披索）"
              maxLength={24}
              className="input-green h-11 px-3 rounded-lg text-base sm:text-sm"
            />
            <button
              type="button"
              onClick={handleAddCustomCurrency}
              className="control-green-active h-11 px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>新增貨幣</span>
            </button>
          </div>
          {customError && (
            <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              {customError}
            </div>
          )}
        </div>
      </div>

      {/* Pre-trip Manual Fixed Cash Exchange Rate Configuration (NO live rate import button / NO VISA badge) */}
      {foreignCurrencies.length > 0 && (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              出國前換匯固定現金匯率設定（每 1 單位外幣折合台幣）
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              請手動輸入您出國前換匯取得外幣現金的固定匯率；記帳選擇「外幣現金」支付時，將直接套用此匯率換算台幣金額。（信用卡外幣消費則於記帳時自動抓取 VISA 即時匯率）
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {foreignCurrencies.map((code) => {
              const meta = getCurrencyMeta(code, draft.customCurrencyNames);
              const currentCash = draft.cashRates?.[code] ?? 0;
              const visaRef = rates?.ratesToTwd?.[code] ?? draft.visaRates?.[code];
              return (
                <div
                  key={code}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {meta.code} · {meta.name}（現金固定匯率）
                  </div>
                  <NumericCalculatorInput
                    value={currentCash}
                    onChange={(val) =>
                      setDraft((prev) => ({
                        ...prev,
                        cashRates: { ...prev.cashRates, [code]: val },
                      }))
                    }
                    prefix="NT$"
                    allowDecimal
                    compact
                    ariaLabel={`${code} 現金固定匯率`}
                  />
                  {visaRef && visaRef > 0 ? (
                    <div className="display-yellow-soft rounded-lg px-2.5 py-1 text-[11px] font-mono-num">
                      VISA 即時參考：1 {code} = {visaRef.toFixed(4)} TWD
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={saving}
          className="control-green-active h-11 px-6 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm"
        >
          {savedNotice ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{saving ? '儲存中...' : savedNotice ? '已更新行程與貨幣設定' : '儲存行程與貨幣設定'}</span>
        </button>
      </div>
    </form>
  );
};
