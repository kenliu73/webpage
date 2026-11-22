import type {
  BudgetItem,
  CurrencyCode,
  ExpensePhase,
  ExpenseRecord,
  LedgerBackupFile,
  LedgerSettings,
  PaymentMethod,
  TravelLedger,
} from '../types';

function sanitizeCode(raw: unknown, fallback = 'TRIP2026'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return cleaned.slice(0, 24) || fallback;
}

function sanitizeCurrency(raw: unknown): CurrencyCode | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (cleaned.length < 2 || cleaned.length > 8) return null;
  return cleaned;
}

export function sanitizeImportedLedgerClient(
  raw: unknown,
  fallbackCode = 'TRIP_IMP'
): TravelLedger | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<TravelLedger>;
  if (!obj.settings || typeof obj.settings !== 'object') return null;

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const s = obj.settings as Partial<LedgerSettings>;

  const rawCurrencies = Array.isArray(s.currencies) ? s.currencies : ['TWD'];
  const cleanCurrencies = rawCurrencies
    .map(sanitizeCurrency)
    .filter((c): c is CurrencyCode => Boolean(c));
  const currencies = Array.from(new Set<CurrencyCode>(['TWD', ...cleanCurrencies]));

  const startDate =
    typeof s.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.startDate)
      ? s.startDate
      : today;

  const endDate =
    typeof s.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.endDate)
      ? s.endDate
      : undefined;

  const rawDays = Number(s.tripDays);
  const tripDays = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.round(rawDays)))
    : 5;

  const customCurrencyNames: Record<string, string> = {};
  if (s.customCurrencyNames && typeof s.customCurrencyNames === 'object') {
    for (const [k, v] of Object.entries(s.customCurrencyNames)) {
      const code = sanitizeCurrency(k);
      if (code && typeof v === 'string' && v.trim()) {
        customCurrencyNames[code] = v.trim().slice(0, 24);
      }
    }
  }

  const cashRates: Record<string, number> = {};
  if (s.cashRates && typeof s.cashRates === 'object') {
    for (const [k, v] of Object.entries(s.cashRates)) {
      const code = sanitizeCurrency(k);
      const num = Number(v);
      if (code && code !== 'TWD' && Number.isFinite(num) && num >= 0) {
        cashRates[code] = Number(num.toFixed(6));
      }
    }
  }

  const visaRates: Record<string, number> = {};
  if (s.visaRates && typeof s.visaRates === 'object') {
    for (const [k, v] of Object.entries(s.visaRates)) {
      const code = sanitizeCurrency(k);
      const num = Number(v);
      if (code && code !== 'TWD' && Number.isFinite(num) && num > 0) {
        visaRates[code] = Number(num.toFixed(6));
      }
    }
  }

  const settings: LedgerSettings = {
    tripName:
      typeof s.tripName === 'string' && s.tripName.trim()
        ? s.tripName.trim().slice(0, 80)
        : '匯入的旅行帳本',
    startDate,
    ...(endDate ? { endDate } : {}),
    tripDays,
    currencies,
    customCurrencyNames,
    cashRates,
    ...(Object.keys(visaRates).length > 0 ? { visaRates } : {}),
    ...(typeof s.visaRateSource === 'string' ? { visaRateSource: s.visaRateSource } : {}),
    ...(typeof s.visaRateDate === 'string' ? { visaRateDate: s.visaRateDate } : {}),
    ...(typeof s.visaRateUpdatedAt === 'number' ? { visaRateUpdatedAt: s.visaRateUpdatedAt } : {}),
  };

  const rawBudgets: unknown[] = Array.isArray(obj.budgets) ? obj.budgets : [];
  const budgets: BudgetItem[] = rawBudgets
    .filter(
      (b): b is Partial<BudgetItem> =>
        Boolean(b && typeof b === 'object' && typeof (b as Partial<BudgetItem>).name === 'string' && (b as Partial<BudgetItem>).name!.trim())
    )
    .map((b, index) => ({
      id:
        typeof b.id === 'string' && b.id.trim()
          ? b.id.trim().slice(0, 64)
          : `b_imp_${index + 1}`,
      name: b.name!.trim().slice(0, 40),
      budgetTwd: Math.max(0, Math.round(Number(b.budgetTwd) || 0)),
      preparedTwd: Math.max(0, Math.round(Number(b.preparedTwd) || 0)),
      order: typeof b.order === 'number' ? b.order : index,
    }));

  const rawExpenses: unknown[] = Array.isArray(obj.expenses) ? obj.expenses : [];
  const expenses: ExpenseRecord[] = rawExpenses
    .filter((e): e is Partial<ExpenseRecord> => Boolean(e && typeof e === 'object'))
    .map((e, index) => {
      const currency = sanitizeCurrency(e.currency) || 'TWD';
      const paymentMethod: PaymentMethod =
        e.paymentMethod === 'cash' ? 'cash' : 'credit_card';
      const phase: ExpensePhase = e.phase === 'pre_trip' ? 'pre_trip' : 'on_trip';
      const originalAmount = Math.max(0, Number(e.originalAmount) || 0);
      const exchangeRate = currency === 'TWD' ? 1 : Math.max(0, Number(e.exchangeRate) || 0);
      const feeRate =
        typeof e.feeRate === 'number' && Number.isFinite(e.feeRate)
          ? Math.max(0, e.feeRate)
          : currency !== 'TWD' && paymentMethod === 'credit_card'
          ? 0.015
          : 0;
      const totalTwd = Math.max(
        0,
        Math.round(
          typeof e.totalTwd === 'number' && Number.isFinite(e.totalTwd)
            ? e.totalTwd
            : originalAmount * (1 + feeRate) * exchangeRate
        )
      );
      const feeTwd = Math.max(
        0,
        Math.round(
          typeof e.feeTwd === 'number' && Number.isFinite(e.feeTwd)
            ? e.feeTwd
            : totalTwd - Math.round(originalAmount * exchangeRate)
        )
      );

      return {
        id:
          typeof e.id === 'string' && e.id.trim()
            ? e.id.trim().slice(0, 64)
            : `exp_imp_${now.toString(36)}_${index}`,
        title:
          typeof e.title === 'string' && e.title.trim()
            ? e.title.trim().slice(0, 80)
            : '未命名消費',
        categoryId:
          typeof e.categoryId === 'string' && e.categoryId.trim()
            ? e.categoryId.trim().slice(0, 64)
            : budgets[0]?.id || 'b_misc',
        phase,
        dayNumber:
          phase === 'on_trip'
            ? Math.max(1, Math.round(Number(e.dayNumber) || 1))
            : null,
        expenseDate:
          typeof e.expenseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.expenseDate)
            ? e.expenseDate
            : startDate,
        currency,
        originalAmount,
        paymentMethod,
        exchangeRate,
        feeRate,
        feeTwd,
        totalTwd,
        rateSource:
          typeof e.rateSource === 'string' && e.rateSource.trim()
            ? e.rateSource.trim().slice(0, 60)
            : currency === 'TWD'
            ? '台幣本幣（無手續費）'
            : paymentMethod === 'credit_card'
            ? 'VISA即時匯率'
            : '出國前現金固定匯率',
        note: typeof e.note === 'string' ? e.note.trim().slice(0, 200) : '',
        createdAt:
          typeof e.createdAt === 'number' && Number.isFinite(e.createdAt)
            ? e.createdAt
            : now,
        updatedAt:
          typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt)
            ? e.updatedAt
            : now,
      };
    });

  return {
    code: sanitizeCode(obj.code, fallbackCode),
    version: typeof obj.version === 'number' && obj.version > 0 ? Math.round(obj.version) : 1,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : now,
    settings,
    budgets,
    expenses,
  };
}

export function buildBackupFile(
  ledgers: TravelLedger[],
  scope: 'single' | 'all',
  activeCode?: string
): LedgerBackupFile {
  return {
    format: 'trip-ledger-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    ...(activeCode ? { activeCode } : {}),
    ledgers,
  };
}

export function downloadBackupFile(
  backup: LedgerBackupFile,
  activeTripName?: string
): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rawLabel =
    backup.scope === 'single'
      ? (activeTripName || backup.ledgers[0]?.settings?.tripName || '旅行帳本')
      : `全部帳本(${backup.ledgers.length}本)`;
  const safeLabel = rawLabel
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '')
    .slice(0, 32);
  const filename = `旅費帳本_${safeLabel || '備份'}_${datePart}.json`;

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return filename;
}

export function parseLedgerBackupText(rawText: string): TravelLedger[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('無法讀取此檔案，請確認選擇的是有效的 JSON 備份檔案');
  }

  let candidates: unknown[] = [];

  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.ledgers)) {
      candidates = obj.ledgers;
    } else if (obj.settings && typeof obj.settings === 'object') {
      candidates = [obj];
    } else {
      // Support dictionary/map format like { TRIP2026: { code, settings, ... } }
      candidates = Object.values(obj).filter(
        (v) => v && typeof v === 'object' && 'settings' in (v as Record<string, unknown>)
      );
    }
  }

  const sanitized = candidates
    .map((item, idx) => sanitizeImportedLedgerClient(item, `TRIP_IMP_${idx + 1}`))
    .filter((item): item is TravelLedger => Boolean(item));

  if (sanitized.length === 0) {
    throw new Error('檔案中找不到可匯入的旅行帳本資料，請選擇由旅費帳本匯出的 .json 檔案');
  }

  return sanitized;
}
