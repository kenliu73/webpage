import React, { useEffect, useState } from 'react';
import { X, Plus, Check, Lock } from 'lucide-react';
import type { CurrencyCode, LedgerSettings } from '../types';
import { CURRENCY_CATALOG } from '../constants/currencies';
import { addDaysToDateString, diffDaysInclusive } from '../utils/calculations';

interface NewTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTrip: (settings: Partial<LedgerSettings>) => Promise<void>;
}

export const NewTripModal: React.FC<NewTripModalProps> = ({
  isOpen,
  onClose,
  onCreateTrip,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [tripName, setTripName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => addDaysToDateString(today, 4));
  const [currencies, setCurrencies] = useState<CurrencyCode[]>(['TWD']);
  const [customCurrencyNames, setCustomCurrencyNames] = useState<Record<string, string>>({});
  const [customCode, setCustomCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const currentToday = new Date().toISOString().slice(0, 10);
      setTripName('');
      setStartDate(currentToday);
      setEndDate(addDaysToDateString(currentToday, 4));
      setCurrencies(['TWD']);
      setCustomCurrencyNames({});
      setCustomCode('');
      setCustomName('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const tripDays = diffDaysInclusive(startDate, endDate);

  const handleStartChange = (nextStart: string) => {
    setStartDate(nextStart);
    if (nextStart && (!endDate || endDate < nextStart)) {
      setEndDate(addDaysToDateString(nextStart, Math.max(0, tripDays - 1)));
    }
  };

  const handleEndChange = (nextEnd: string) => {
    setEndDate(startDate && nextEnd < startDate ? startDate : nextEnd);
  };

  const toggleCurrency = (code: CurrencyCode) => {
    if (code === 'TWD') return;
    setCurrencies((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const addCustomCurrency = () => {
    const cleaned = customCode.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (cleaned.length < 2 || cleaned.length > 8) return;
    if (!currencies.includes(cleaned)) {
      setCurrencies((prev) => [...prev, cleaned]);
    }
    if (customName.trim()) {
      setCustomCurrencyNames((prev) => ({ ...prev, [cleaned]: customName.trim() }));
    }
    setCustomCode('');
    setCustomName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreateTrip({
        tripName: tripName.trim() || '新旅行預算帳本',
        startDate,
        endDate,
        tripDays,
        currencies,
        customCurrencyNames,
      });
      setTripName('');
      setCurrencies(['TWD']);
      setCustomCurrencyNames({});
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const presetCodes = new Set(CURRENCY_CATALOG.map((c) => c.code));
  const customAdded = currencies.filter((c) => !presetCodes.has(c));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            建立新旅行獨立帳本
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="control-green h-9 w-9 rounded-lg flex items-center justify-center"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                本次旅行名稱
              </label>
              <input
                type="text"
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
                placeholder="例如：2027 北海道雪祭七日行"
                required
                className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                出發日期
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartChange(e.target.value)}
                className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                回程日期（共 {tripDays} 天）
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => handleEndChange(e.target.value)}
                className="input-green w-full h-11 px-3 rounded-lg text-base sm:text-sm font-mono-num"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              選擇本次使用的貨幣（台幣 TWD 為當然貨幣）
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {CURRENCY_CATALOG.slice(0, 12).map((curr) => {
                const isTwd = curr.code === 'TWD';
                const selected = isTwd || currencies.includes(curr.code);
                return (
                  <button
                    key={curr.code}
                    type="button"
                    disabled={isTwd}
                    onClick={() => toggleCurrency(curr.code)}
                    className={`h-10 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-1 ${
                      isTwd
                        ? 'display-yellow cursor-not-allowed'
                        : selected
                        ? 'control-green-active'
                        : 'control-green opacity-80'
                    }`}
                  >
                    <span className="truncate">
                      {curr.code} {curr.name}
                    </span>
                    {isTwd ? (
                      <Lock className="w-3 h-3 shrink-0" />
                    ) : selected ? (
                      <Check className="w-3 h-3 shrink-0" />
                    ) : null}
                  </button>
                );
              })}

              {customAdded.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleCurrency(code)}
                  className="control-green-active h-10 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-1"
                >
                  <span className="truncate">
                    {code} {customCurrencyNames[code] || ''}
                  </span>
                  <X className="w-3 h-3 shrink-0" />
                </button>
              ))}
            </div>

            <div className="grid grid-cols-[110px_1fr_auto] gap-2 pt-1">
              <input
                type="text"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                placeholder="自訂如 NZD"
                maxLength={8}
                className="input-green h-10 px-2.5 rounded-lg text-base sm:text-xs font-mono-num uppercase"
              />
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="名稱（選填）"
                className="input-green h-10 px-2.5 rounded-lg text-base sm:text-xs"
              />
              <button
                type="button"
                onClick={addCustomCurrency}
                className="control-green h-10 px-3 rounded-lg text-xs font-semibold"
              >
                加入
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="control-green h-11 px-4 rounded-xl text-sm font-semibold"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="control-green-active h-11 px-5 rounded-xl text-sm font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{busy ? '建立中...' : '建立並開啟新帳本'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
