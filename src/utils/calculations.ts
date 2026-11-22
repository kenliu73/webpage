import type { CurrencyCode, PaymentMethod } from '../types';

export interface ExpenseCalculationResult {
  exchangeRate: number;
  feeRate: number;
  baseTwd: number;
  feeTwd: number;
  totalTwd: number;
  foreignWithFee: number;
}

/**
 * Computes TWD conversion and 1.5% overseas credit card fee:
 * - TWD (cash or credit card): 0% fee, rate = 1
 * - Foreign currency + cash: 0% fee, rate = cash exchange rate
 * - Foreign currency + credit card: +1.5% fee, converted using VISA live rate
 */
export function calculateExpenseTwd(params: {
  currency: CurrencyCode;
  originalAmount: number;
  paymentMethod: PaymentMethod;
  exchangeRate: number;
}): ExpenseCalculationResult {
  const { currency, originalAmount, paymentMethod, exchangeRate } = params;
  const safeAmount = Number.isFinite(originalAmount) && originalAmount > 0 ? originalAmount : 0;

  if (currency === 'TWD') {
    const rounded = Math.round(safeAmount);
    return {
      exchangeRate: 1,
      feeRate: 0,
      baseTwd: rounded,
      feeTwd: 0,
      totalTwd: rounded,
      foreignWithFee: safeAmount,
    };
  }

  const safeRate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  const isForeignCard = paymentMethod === 'credit_card';
  const feeRate = isForeignCard ? 0.015 : 0;
  const foreignWithFee = safeAmount * (1 + feeRate);
  const baseTwdExact = safeAmount * safeRate;
  const totalTwdExact = foreignWithFee * safeRate;
  const totalTwd = Math.round(totalTwdExact);
  const baseTwd = Math.round(baseTwdExact);
  const feeTwd = isForeignCard ? Math.max(0, totalTwd - baseTwd) : 0;

  return {
    exchangeRate: safeRate,
    feeRate,
    baseTwd,
    feeTwd,
    totalTwd,
    foreignWithFee,
  };
}

export function addDaysToDateString(dateStr: string, daysToAdd: number): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + daysToAdd));
  return dt.toISOString().slice(0, 10);
}

export function diffDaysInclusive(startStr: string, endStr: string): number {
  const sParts = startStr.split('-').map(Number);
  const eParts = endStr.split('-').map(Number);
  if (
    sParts.length !== 3 ||
    eParts.length !== 3 ||
    sParts.some((n) => Number.isNaN(n)) ||
    eParts.some((n) => Number.isNaN(n))
  ) {
    return 1;
  }
  const sMs = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
  const eMs = Date.UTC(eParts[0], eParts[1] - 1, eParts[2]);
  const diff = Math.round((eMs - sMs) / 86400000) + 1;
  return Math.min(90, Math.max(1, diff));
}

/**
 * Evaluates simple arithmetic expressions safely for the built-in calculator.
 * Supports +, -, *, /, parentheses, and decimal numbers.
 */
export function evaluateCalculatorExpression(rawExpr: string): number | null {
  const normalized = rawExpr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '')
    .trim();

  if (!normalized) return null;
  if (!/^[0-9+\-*/().\s]+$/.test(normalized)) return null;

  try {
    // Strip trailing operator if user clicks "=" prematurely
    const cleaned = normalized.replace(/[+\-*/.\s]+$/, '');
    if (!cleaned) return null;
    const fn = new Function(`"use strict"; return (${cleaned});`);
    const result = fn();
    if (typeof result === 'number' && Number.isFinite(result)) {
      return Number(result.toFixed(6));
    }
    return null;
  } catch {
    return null;
  }
}
