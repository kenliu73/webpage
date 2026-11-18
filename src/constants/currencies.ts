import type { CurrencyCode } from '../types';

export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number;
  defaultFallbackRateToTwd: number;
}

export const CURRENCY_CATALOG: CurrencyMeta[] = [
  { code: 'TWD', name: '新台幣', symbol: 'NT$', decimals: 0, defaultFallbackRateToTwd: 1 },
  { code: 'JPY', name: '日圓', symbol: '¥', decimals: 0, defaultFallbackRateToTwd: 0.214 },
  { code: 'USD', name: '美元', symbol: '$', decimals: 2, defaultFallbackRateToTwd: 32.45 },
  { code: 'EUR', name: '歐元', symbol: '€', decimals: 2, defaultFallbackRateToTwd: 34.8 },
  { code: 'KRW', name: '韓元', symbol: '₩', decimals: 0, defaultFallbackRateToTwd: 0.0235 },
  { code: 'THB', name: '泰銖', symbol: '฿', decimals: 2, defaultFallbackRateToTwd: 0.945 },
  { code: 'HKD', name: '港幣', symbol: 'HK$', decimals: 2, defaultFallbackRateToTwd: 4.17 },
  { code: 'CNY', name: '人民幣', symbol: '¥', decimals: 2, defaultFallbackRateToTwd: 4.48 },
  { code: 'GBP', name: '英鎊', symbol: '£', decimals: 2, defaultFallbackRateToTwd: 41.2 },
  { code: 'SGD', name: '新加坡幣', symbol: 'S$', decimals: 2, defaultFallbackRateToTwd: 24.15 },
  { code: 'AUD', name: '澳幣', symbol: 'A$', decimals: 2, defaultFallbackRateToTwd: 21.1 },
  { code: 'VND', name: '越南盾', symbol: '₫', decimals: 0, defaultFallbackRateToTwd: 0.00128 },
  { code: 'CAD', name: '加拿大幣', symbol: 'C$', decimals: 2, defaultFallbackRateToTwd: 23.2 },
  { code: 'CHF', name: '瑞士法郎', symbol: 'CHF', decimals: 2, defaultFallbackRateToTwd: 36.8 },
  { code: 'MYR', name: '馬來西亞令吉', symbol: 'RM', decimals: 2, defaultFallbackRateToTwd: 7.25 },
];

export const CURRENCY_MAP: Record<string, CurrencyMeta> = CURRENCY_CATALOG.reduce(
  (acc, item) => {
    acc[item.code] = item;
    return acc;
  },
  {} as Record<string, CurrencyMeta>
);

export function getCurrencyMeta(
  code: CurrencyCode,
  customNames?: Record<string, string>
): CurrencyMeta {
  const preset = CURRENCY_MAP[code];
  if (preset) {
    return customNames?.[code] ? { ...preset, name: customNames[code] } : preset;
  }
  return {
    code,
    name: customNames?.[code] || code,
    symbol: code,
    decimals: 2,
    defaultFallbackRateToTwd: 1,
  };
}

export function formatCurrencyAmount(amount: number, code: CurrencyCode): string {
  const meta = CURRENCY_MAP[code];
  const decimals = meta ? meta.decimals : 2;
  const formatted = new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(amount);
  return `${code} ${formatted}`;
}

export function formatTwd(amount: number): string {
  return `NT$ ${new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount))}`;
}
