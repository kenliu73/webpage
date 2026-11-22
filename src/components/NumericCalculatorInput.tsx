import React, { useEffect, useRef, useState } from 'react';
import { Calculator, Delete, X, Check } from 'lucide-react';
import { evaluateCalculatorExpression } from '../utils/calculations';

interface NumericCalculatorInputProps {
  value: number;
  onChange: (nextVal: number) => void;
  onCommit?: (finalVal: number) => void;
  prefix?: string;
  compactPrefix?: boolean;
  hideCalcLabel?: boolean;
  blurOnEnter?: boolean;
  mobileCalculatorOnly?: boolean;
  allowDecimal?: boolean;
  maxDecimals?: number;
  placeholder?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  compact?: boolean;
}

export const NumericCalculatorInput: React.FC<NumericCalculatorInputProps> = ({
  value,
  onChange,
  onCommit,
  prefix,
  compactPrefix = false,
  hideCalcLabel = false,
  blurOnEnter = false,
  mobileCalculatorOnly = false,
  allowDecimal = true,
  maxDecimals = 2,
  placeholder = '0',
  ariaLabel,
  id,
  className = '',
  compact = false,
}) => {
  const [textValue, setTextValue] = useState<string>(() => (value === 0 ? '' : String(value)));
  const [isFocused, setIsFocused] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [expr, setExpr] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external value changes when not actively typing
  useEffect(() => {
    if (!isFocused) {
      setTextValue(value === 0 ? '' : String(value));
    }
  }, [value, isFocused]);

  // Close desktop popover on outside click
  useEffect(() => {
    if (!calcOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setCalcOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [calcOpen]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    // Req #4: Default 0 disappears automatically when focused
    if (textValue === '0' || value === 0) {
      setTextValue('');
    } else {
      e.target.select();
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = textValue.trim();
    if (!cleaned || cleaned === '.') {
      setTextValue('');
      onChange(0);
      onCommit?.(0);
      return;
    }
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const normalized = allowDecimal ? parsed : Math.round(parsed);
      onChange(normalized);
      onCommit?.(normalized);
      setTextValue(normalized === 0 ? '' : String(normalized));
    } else {
      setTextValue(value === 0 ? '' : String(value));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    if (allowDecimal) {
      raw = raw.replace(/[^0-9.]/g, '');
      const firstDot = raw.indexOf('.');
      if (firstDot !== -1) {
        raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
      }
    } else {
      raw = raw.replace(/[^0-9]/g, '');
    }

    // Strip leading zeros (e.g. "05" -> "5") while allowing "0." for decimals
    if (raw.length > 1 && raw.startsWith('0') && raw[1] !== '.') {
      raw = raw.replace(/^0+/, '') || '';
    }

    setTextValue(raw);
    if (raw === '' || raw === '.') {
      onChange(0);
    } else {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        onChange(num);
      }
    }
  };

  const openCalculator = () => {
    setExpr(value > 0 ? String(value) : '');
    setCalcOpen((prev) => !prev);
  };

  const appendToken = (token: string) => {
    const isOperator = ['+', '-', '×', '÷'].includes(token);
    setExpr((prev) => {
      if (isOperator) {
        if (!prev) return prev;
        const base = prev.endsWith('.') ? prev.slice(0, -1) : prev;
        if (!base) return '';
        if (/[+\-×÷]$/.test(base)) {
          return base.replace(/[+\-×÷]+$/, token);
        }
        return base + token;
      }

      if (token === '.') {
        if (!prev || /[+\-×÷]$/.test(prev)) {
          return `${prev}0.`;
        }
        const currentSegment = prev.split(/[+\-×÷]/).pop() || '';
        if (currentSegment.includes('.')) return prev;
        return `${prev}.`;
      }

      if (/^[0-9]$/.test(token)) {
        if (prev === '0') return token;
        if (/[+\-×÷]0$/.test(prev)) {
          return `${prev.slice(0, -1)}${token}`;
        }
        return prev + token;
      }

      return prev;
    });
  };

  const handleEvaluate = () => {
    const res = evaluateCalculatorExpression(expr);
    if (res !== null) {
      const clamped = Math.max(0, res);
      setExpr(String(Number(clamped.toFixed(6))));
    }
  };

  const handleApplyCalculator = () => {
    const res = evaluateCalculatorExpression(expr);
    if (res !== null) {
      const clamped = Math.max(0, res);
      const finalVal = allowDecimal
        ? Number(clamped.toFixed(maxDecimals))
        : Math.round(clamped);
      onChange(finalVal);
      onCommit?.(finalVal);
      setTextValue(finalVal === 0 ? '' : String(finalVal));
    } else if (expr.trim() === '') {
      onChange(0);
      onCommit?.(0);
      setTextValue('');
    }
    setCalcOpen(false);
  };

  const previewResult = evaluateCalculatorExpression(expr);

  const calcButtons = [
    ['7', '8', '9', '÷'],
    ['4', '5', '6', '×'],
    ['1', '2', '3', '-'],
    ['.', '0', '⌫', '+'],
  ];

  const formattedDisplayValue =
    value === 0
      ? placeholder
      : new Intl.NumberFormat('zh-TW', {
          maximumFractionDigits: allowDecimal ? maxDecimals : 0,
        }).format(value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {mobileCalculatorOnly && (
        <button
          type="button"
          onClick={openCalculator}
          aria-label={ariaLabel ? `${ariaLabel}（開啟計算機輸入）` : '開啟計算機輸入'}
          className={`md:hidden input-green w-full rounded-lg flex items-center justify-between gap-1.5 font-mono-num font-bold cursor-pointer touch-manipulation select-none ${
            compact ? 'h-10 px-2.5 text-sm' : 'h-11 px-2.5 text-sm'
          } ${calcOpen ? 'ring-2 ring-emerald-500/50' : ''}`}
        >
          {prefix ? (
            <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200 shrink-0">
              {prefix}
            </span>
          ) : null}
          <span className="flex items-center justify-end gap-1.5 flex-1 min-w-0">
            <span className={`truncate ${value === 0 ? 'opacity-50' : ''}`}>
              {formattedDisplayValue}
            </span>
            <Calculator className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
          </span>
        </button>
      )}

      <div
        className={`${mobileCalculatorOnly ? 'hidden md:flex' : 'flex'} items-stretch ${
          compactPrefix ? 'gap-1' : 'gap-1.5'
        }`}
      >
        <div className="relative flex-1 min-w-0">
          {prefix && (
            <span
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 font-medium text-emerald-800 dark:text-emerald-200 select-none ${
                compactPrefix ? 'left-2 text-[11px] sm:text-xs' : 'left-3 text-xs'
              }`}
            >
              {prefix}
            </span>
          )}
          <input
            id={id}
            type="text"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            aria-label={ariaLabel}
            value={textValue}
            placeholder={isFocused ? '' : placeholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (blurOnEnter && e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className={`input-green w-full rounded-lg font-mono-num font-semibold text-right ${
              prefix
                ? compactPrefix
                  ? 'pl-12 pr-2'
                  : 'pl-11 pr-3'
                : 'px-3'
            } ${compact ? 'h-10 text-base sm:text-sm' : 'h-11 text-base lg:text-sm'}`}
          />
        </div>

        <button
          type="button"
          onClick={openCalculator}
          title="開啟計算機輸入"
          aria-label="開啟計算機輸入"
          className={`control-green shrink-0 rounded-lg flex items-center justify-center gap-1.5 font-medium touch-manipulation select-none ${
            compact
              ? 'h-10 px-2.5 text-xs'
              : hideCalcLabel
              ? 'h-11 w-10 sm:w-11 text-sm'
              : 'h-11 px-3 text-sm'
          } ${calcOpen ? 'ring-2 ring-emerald-500/50' : ''}`}
        >
          <Calculator className="w-4 h-4" />
          {!hideCalcLabel && (
            <span className="hidden sm:inline whitespace-nowrap">計算機</span>
          )}
        </button>
      </div>

      {calcOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] md:hidden"
            onClick={() => setCalcOpen(false)}
          />
          <div
            className="fixed inset-x-3 bottom-4 z-[60] md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-72
                       rounded-2xl border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900 shadow-2xl p-3.5 touch-manipulation select-none"
          >
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                計算機輸入
              </span>
              <button
                type="button"
                onClick={() => setCalcOpen(false)}
                className="control-green h-8 w-8 rounded-lg flex items-center justify-center touch-manipulation select-none"
                aria-label="關閉計算機"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Yellow read-only display screen */}
            <div className="display-yellow rounded-xl px-3 py-2.5 mb-3">
              <div className="text-xs font-mono-num opacity-80 min-h-[18px] break-all text-right">
                {expr || '0'}
              </div>
              <div className="text-xl font-mono-num font-bold text-right mt-0.5 truncate">
                {previewResult !== null
                  ? `= ${new Intl.NumberFormat('zh-TW', {
                      maximumFractionDigits: Math.max(maxDecimals, 4),
                    }).format(Math.max(0, previewResult))}`
                  : '= 0'}
              </div>
              {!allowDecimal && previewResult !== null && !Number.isInteger(previewResult) && (
                <div className="text-[11px] font-mono-num opacity-75 text-right mt-0.5">
                  套用將四捨五入為{' '}
                  {new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(
                    Math.max(0, Math.round(previewResult))
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-1.5 touch-manipulation">
              {calcButtons.flat().map((btn) => {
                if (btn === '⌫') {
                  return (
                    <button
                      key="backspace"
                      type="button"
                      onClick={() => setExpr((p) => p.slice(0, -1))}
                      className="control-green h-11 rounded-lg flex items-center justify-center font-semibold touch-manipulation select-none"
                      aria-label="退格"
                    >
                      <Delete className="w-4 h-4" />
                    </button>
                  );
                }
                const isOp = ['÷', '×', '-', '+'].includes(btn);
                return (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => appendToken(btn)}
                    className={`control-green h-11 rounded-lg font-mono-num text-base font-semibold flex items-center justify-center touch-manipulation select-none ${
                      isOp ? 'font-bold' : ''
                    }`}
                  >
                    {btn}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-2 touch-manipulation">
              <button
                type="button"
                onClick={() => setExpr('')}
                className="control-green h-11 rounded-lg text-sm font-semibold touch-manipulation select-none"
              >
                清除 C
              </button>
              <button
                type="button"
                onClick={handleEvaluate}
                className="control-green h-11 rounded-lg font-mono-num text-base font-bold touch-manipulation select-none"
              >
                =
              </button>
              <button
                type="button"
                onClick={handleApplyCalculator}
                className="control-green-active h-11 rounded-lg text-sm font-semibold flex items-center justify-center gap-1 touch-manipulation select-none"
              >
                <Check className="w-4 h-4" />
                <span>套用</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
