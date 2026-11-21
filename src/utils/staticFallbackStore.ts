import type {
  AuthStatusPayload,
  BudgetItem,
  CurrencyCode,
  ExpenseRecord,
  LedgerSettings,
  LedgerSummary,
  LiveRatesPayload,
  RegisteredPasskeyInfo,
  TravelLedger,
} from '../types';
import { calculateExpenseTwd } from './calculations';
import { sanitizeImportedLedgerClient } from './ledgerBackup';

const STATIC_LEDGERS_KEY = 'triple_static_ledgers_v1';
const STATIC_AUTH_KEY = 'triple_static_auth_v1';
const STATIC_SESSION_KEY = 'triple_static_session_unlocked';

const FALLBACK_RATES_TO_TWD: Record<string, number> = {
  TWD: 1,
  JPY: 0.214,
  USD: 32.45,
  EUR: 34.8,
  KRW: 0.0235,
  THB: 0.945,
  HKD: 4.17,
  CNY: 4.48,
  GBP: 41.2,
  SGD: 24.15,
  AUD: 21.1,
  VND: 0.00128,
  CAD: 23.2,
  CHF: 36.8,
  MYR: 7.25,
};

interface StaticAuthData {
  enabled: boolean;
  pinHashHex: string | null;
  passkeys: RegisteredPasskeyInfo[];
}

function createDefaultLedger(code: string, isSample = false): TravelLedger {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  if (isSample) {
    return {
      code,
      version: 1,
      updatedAt: now,
      settings: {
        tripName: '2026 東京五日自由行',
        startDate: today,
        tripDays: 5,
        currencies: ['TWD', 'JPY', 'USD'],
        customCurrencyNames: {},
        cashRates: { JPY: 0.212, USD: 32.3 },
      },
      budgets: [
        { id: 'b_flight', name: '機票交通', budgetTwd: 16500, order: 0 },
        { id: 'b_hotel', name: '住宿飯店', budgetTwd: 18000, order: 1 },
        { id: 'b_food', name: '餐飲美食', budgetTwd: 12000, order: 2 },
        { id: 'b_ticket', name: '景點門票', budgetTwd: 5500, order: 3 },
        { id: 'b_shop', name: '購物伴手禮', budgetTwd: 10000, order: 4 },
        { id: 'b_misc', name: '網卡保險', budgetTwd: 2000, order: 5 },
      ],
      expenses: [
        {
          id: 'e_1',
          title: '台北-東京來回機票',
          categoryId: 'b_flight',
          phase: 'pre_trip',
          dayNumber: null,
          expenseDate: today,
          currency: 'TWD',
          originalAmount: 14800,
          paymentMethod: 'credit_card',
          exchangeRate: 1,
          feeRate: 0,
          feeTwd: 0,
          totalTwd: 14800,
          rateSource: '台幣本幣（無手續費）',
          note: '刷台新信用卡，以台幣結帳免收1.5%手續費',
          createdAt: now - 3600000 * 5,
          updatedAt: now - 3600000 * 5,
        },
        {
          id: 'e_2',
          title: '新宿飯店訂房訂金',
          categoryId: 'b_hotel',
          phase: 'pre_trip',
          dayNumber: null,
          expenseDate: today,
          currency: 'JPY',
          originalAmount: 65000,
          paymentMethod: 'credit_card',
          exchangeRate: 0.214,
          feeRate: 0.015,
          feeTwd: 209,
          totalTwd: 14119,
          rateSource: 'VISA即時匯率',
          note: '行前外幣線上刷卡（含1.5%手續費）',
          createdAt: now - 3600000 * 4,
          updatedAt: now - 3600000 * 4,
        },
        {
          id: 'e_3',
          title: 'Skyliner 車票 + 西瓜卡儲值',
          categoryId: 'b_flight',
          phase: 'on_trip',
          dayNumber: 1,
          expenseDate: today,
          currency: 'JPY',
          originalAmount: 7500,
          paymentMethod: 'cash',
          exchangeRate: 0.212,
          feeRate: 0,
          feeTwd: 0,
          totalTwd: 1590,
          rateSource: '出國前現金固定匯率',
          note: '成田機場現金購票',
          createdAt: now - 3600000 * 2,
          updatedAt: now - 3600000 * 2,
        },
      ],
    };
  }

  return {
    code,
    version: 1,
    updatedAt: now,
    settings: {
      tripName: '新旅行預算帳本',
      startDate: today,
      tripDays: 5,
      currencies: ['TWD'],
      customCurrencyNames: {},
      cashRates: {},
    },
    budgets: [
      { id: 'b_flight', name: '機票交通', budgetTwd: 15000, order: 0 },
      { id: 'b_hotel', name: '住宿飯店', budgetTwd: 15000, order: 1 },
      { id: 'b_food', name: '餐飲美食', budgetTwd: 10000, order: 2 },
      { id: 'b_ticket', name: '景點門票', budgetTwd: 4000, order: 3 },
      { id: 'b_shop', name: '購物伴手禮', budgetTwd: 8000, order: 4 },
    ],
    expenses: [],
  };
}

function loadStaticLedgersMap(): Record<string, TravelLedger> {
  try {
    const raw = localStorage.getItem(STATIC_LEDGERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, TravelLedger>;
      if (parsed && Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupted storage
  }
  const initial: Record<string, TravelLedger> = {
    TRIP2026: createDefaultLedger('TRIP2026', true),
  };
  saveStaticLedgersMap(initial);
  return initial;
}

function saveStaticLedgersMap(map: Record<string, TravelLedger>) {
  try {
    localStorage.setItem(STATIC_LEDGERS_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

function toSummary(l: TravelLedger): LedgerSummary {
  return {
    code: l.code,
    tripName: l.settings.tripName,
    startDate: l.settings.startDate,
    tripDays: l.settings.tripDays,
    currencies: l.settings.currencies,
    expenseCount: l.expenses.length,
    totalBudgetTwd: l.budgets.reduce((s, b) => s + (b.budgetTwd || 0), 0),
    totalActualTwd: l.expenses.reduce((s, e) => s + (e.totalTwd || 0), 0),
    updatedAt: l.updatedAt,
  };
}

export function staticGetLedgerSummaries(): LedgerSummary[] {
  const map = loadStaticLedgersMap();
  return Object.values(map)
    .map(toSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function staticGetLedger(code: string): TravelLedger {
  const map = loadStaticLedgersMap();
  if (!map[code]) {
    map[code] = createDefaultLedger(code, code === 'TRIP2026');
    saveStaticLedgersMap(map);
  }
  return map[code];
}

export function staticCreateLedger(settings: Partial<LedgerSettings>): TravelLedger {
  const map = loadStaticLedgersMap();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = `TRIP_${Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
  } while (map[code]);

  const fresh = createDefaultLedger(code, false);
  const currencies: CurrencyCode[] = Array.isArray(settings.currencies) && settings.currencies.length > 0
    ? Array.from(new Set(['TWD', ...settings.currencies]))
    : ['TWD'];

  fresh.settings = {
    ...fresh.settings,
    ...settings,
    currencies,
  };
  map[code] = fresh;
  saveStaticLedgersMap(map);
  return fresh;
}

export function staticDeleteLedger(code: string): LedgerSummary[] {
  const map = loadStaticLedgersMap();
  if (Object.keys(map).length > 1) {
    delete map[code];
    saveStaticLedgersMap(map);
  }
  return staticGetLedgerSummaries();
}

export function staticUpdateSettings(code: string, nextSettings: LedgerSettings): TravelLedger {
  const map = loadStaticLedgersMap();
  const current = map[code] || createDefaultLedger(code, false);
  const updated: TravelLedger = {
    ...current,
    version: current.version + 1,
    updatedAt: Date.now(),
    settings: {
      ...nextSettings,
      currencies: Array.from(new Set(['TWD', ...(nextSettings.currencies || [])])),
    },
  };
  map[code] = updated;
  saveStaticLedgersMap(map);
  return updated;
}

export function staticUpdateBudgets(code: string, nextBudgets: BudgetItem[]): TravelLedger {
  const map = loadStaticLedgersMap();
  const current = map[code] || createDefaultLedger(code, false);
  const updated: TravelLedger = {
    ...current,
    version: current.version + 1,
    updatedAt: Date.now(),
    budgets: nextBudgets.map((b, idx) => ({ ...b, order: idx })),
  };
  map[code] = updated;
  saveStaticLedgersMap(map);
  return updated;
}

export function staticSaveExpense(code: string, expense: ExpenseRecord, isEdit: boolean): TravelLedger {
  const map = loadStaticLedgersMap();
  const current = map[code] || createDefaultLedger(code, false);
  const now = Date.now();
  const cleanExp: ExpenseRecord = { ...expense, updatedAt: now, createdAt: expense.createdAt || now };
  const nextExpenses = isEdit
    ? current.expenses.map((e) => (e.id === cleanExp.id ? cleanExp : e))
    : [cleanExp, ...current.expenses.filter((e) => e.id !== cleanExp.id)];

  const updated: TravelLedger = {
    ...current,
    version: current.version + 1,
    updatedAt: now,
    expenses: nextExpenses,
  };
  map[code] = updated;
  saveStaticLedgersMap(map);
  return updated;
}

export function staticDeleteExpense(code: string, expenseId: string): TravelLedger {
  const map = loadStaticLedgersMap();
  const current = map[code] || createDefaultLedger(code, false);
  const now = Date.now();
  const updated: TravelLedger = {
    ...current,
    version: current.version + 1,
    updatedAt: now,
    expenses: current.expenses.filter((e) => e.id !== expenseId),
  };
  map[code] = updated;
  saveStaticLedgersMap(map);
  return updated;
}

export function staticExportLedgers(code?: string): TravelLedger[] {
  const map = loadStaticLedgersMap();
  if (code) {
    return [map[code] || createDefaultLedger(code, code === 'TRIP2026')];
  }
  return Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function staticImportLedgers(
  incomingList: TravelLedger[],
  mode: 'overwrite' | 'create_new'
): {
  importedCount: number;
  importedExpenseCount: number;
  activeLedger: TravelLedger;
  ledgers: LedgerSummary[];
} {
  const map = loadStaticLedgersMap();
  const generateUniqueCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let nextCode = '';
    do {
      nextCode = `TRIP_${Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
    } while (map[nextCode]);
    return nextCode;
  };

  const now = Date.now();
  const importedLedgers: TravelLedger[] = [];
  let importedExpenseCount = 0;

  for (const item of incomingList) {
    const clean = sanitizeImportedLedgerClient(item);
    if (!clean) continue;

    const targetCode =
      mode === 'create_new' || !clean.code ? generateUniqueCode() : clean.code;
    const existing = map[targetCode];
    const saved: TravelLedger = {
      ...clean,
      code: targetCode,
      version: existing ? existing.version + 1 : 1,
      updatedAt: now,
    };
    map[targetCode] = saved;
    importedLedgers.push(saved);
    importedExpenseCount += saved.expenses.length;
  }

  if (importedLedgers.length === 0) {
    throw new Error('找不到可匯入的旅行帳本內容');
  }

  saveStaticLedgersMap(map);
  return {
    importedCount: importedLedgers.length,
    importedExpenseCount,
    activeLedger: importedLedgers[0],
    ledgers: staticGetLedgerSummaries(),
  };
}

export async function staticFetchLiveRates(): Promise<LiveRatesPayload> {
  const ratesToTwd: Record<string, number> = { ...FALLBACK_RATES_TO_TWD };
  let source = '離線基準匯率';
  let rateDate = new Date().toISOString().slice(0, 10);

  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/TWD', {
      cache: 'no-store',
    });
    if (resp.ok) {
      const json = (await resp.json()) as {
        result?: string;
        time_last_update_utc?: string;
        rates?: Record<string, number>;
      };
      if (json.result === 'success' && json.rates) {
        for (const [code, perTwd] of Object.entries(json.rates)) {
          if (code === 'TWD') ratesToTwd.TWD = 1;
          else if (typeof perTwd === 'number' && perTwd > 0) {
            ratesToTwd[code] = Number((1 / perTwd).toFixed(6));
          }
        }
        source = '即時國際匯率（靜態直連）';
        if (json.time_last_update_utc) {
          const d = new Date(json.time_last_update_utc);
          if (!Number.isNaN(d.getTime())) rateDate = d.toISOString().slice(0, 10);
        }
      }
    }
  } catch {
    // keep built-in fallback rates
  }

  return {
    base: 'TWD',
    ratesToTwd,
    visaDirectCurrencies: [],
    source,
    fetchedAt: Date.now(),
    rateDate,
  };
}

export function staticApplyVisaRates(
  code: string,
  liveRates: LiveRatesPayload
): { ledger: TravelLedger; updatedExpenseCount: number } {
  const map = loadStaticLedgersMap();
  const current = map[code] || createDefaultLedger(code, false);
  const nextVisaRates: Record<string, number> = { ...(current.settings.visaRates || {}) };

  for (const curr of current.settings.currencies) {
    if (curr === 'TWD') continue;
    const rate = liveRates.ratesToTwd[curr];
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      nextVisaRates[curr] = Number(rate.toFixed(6));
    }
  }

  const now = Date.now();
  let updatedExpenseCount = 0;
  const nextExpenses = current.expenses.map((exp) => {
    if (exp.paymentMethod !== 'credit_card' || exp.currency === 'TWD') {
      return exp;
    }
    const nextRate = liveRates.ratesToTwd[exp.currency] ?? nextVisaRates[exp.currency];
    if (!nextRate || !Number.isFinite(nextRate) || nextRate <= 0) {
      return exp;
    }
    const calc = calculateExpenseTwd({
      currency: exp.currency,
      originalAmount: exp.originalAmount,
      paymentMethod: 'credit_card',
      exchangeRate: nextRate,
    });
    updatedExpenseCount += 1;
    return {
      ...exp,
      exchangeRate: calc.exchangeRate,
      feeRate: 0.015,
      feeTwd: calc.feeTwd,
      totalTwd: calc.totalTwd,
      rateSource: liveRates.visaDirectCurrencies.includes(exp.currency)
        ? 'VISA 官方即時匯率'
        : 'VISA即時匯率',
      updatedAt: now,
    };
  });

  const updated: TravelLedger = {
    ...current,
    version: current.version + 1,
    updatedAt: now,
    settings: {
      ...current.settings,
      visaRates: nextVisaRates,
      visaRateSource: liveRates.source,
      visaRateDate: liveRates.rateDate,
      visaRateUpdatedAt: liveRates.fetchedAt,
    },
    expenses: nextExpenses,
  };

  map[code] = updated;
  saveStaticLedgersMap(map);
  return { ledger: updated, updatedExpenseCount };
}

// Static-mode browser auth helpers
function loadStaticAuth(): StaticAuthData {
  try {
    const raw = localStorage.getItem(STATIC_AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StaticAuthData>;
      return {
        enabled: Boolean(parsed.enabled),
        pinHashHex: typeof parsed.pinHashHex === 'string' ? parsed.pinHashHex : null,
        passkeys: Array.isArray(parsed.passkeys) ? parsed.passkeys : [],
      };
    }
  } catch {
    // ignore
  }
  return { enabled: false, pinHashHex: null, passkeys: [] };
}

function saveStaticAuth(data: StaticAuthData) {
  try {
    localStorage.setItem(STATIC_AUTH_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export async function hashPinBrowser(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(`triple_pin_salt_${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function staticGetAuthStatus(): AuthStatusPayload {
  const data = loadStaticAuth();
  const unlocked = !data.enabled || sessionStorage.getItem(STATIC_SESSION_KEY) === '1';
  return {
    enabled: data.enabled,
    authenticated: unlocked,
    hasPin: Boolean(data.pinHashHex),
    passkeys: data.passkeys,
  };
}

export function staticSetSessionUnlocked(unlocked: boolean) {
  try {
    if (unlocked) sessionStorage.setItem(STATIC_SESSION_KEY, '1');
    else sessionStorage.removeItem(STATIC_SESSION_KEY);
  } catch {
    // ignore
  }
}

export async function staticSetupPin(pin: string): Promise<AuthStatusPayload> {
  const data = loadStaticAuth();
  data.pinHashHex = await hashPinBrowser(pin);
  saveStaticAuth(data);
  staticSetSessionUnlocked(true);
  return staticGetAuthStatus();
}

export async function staticVerifyPin(pin: string): Promise<AuthStatusPayload | null> {
  const data = loadStaticAuth();
  if (!data.pinHashHex) return null;
  const candidate = await hashPinBrowser(pin);
  if (candidate !== data.pinHashHex) return null;
  staticSetSessionUnlocked(true);
  return staticGetAuthStatus();
}

export function staticToggleAuth(enable: boolean): AuthStatusPayload {
  const data = loadStaticAuth();
  data.enabled = enable;
  saveStaticAuth(data);
  if (enable) staticSetSessionUnlocked(true);
  return staticGetAuthStatus();
}

export function staticSavePasskey(pk: RegisteredPasskeyInfo, enableLock = true): AuthStatusPayload {
  const data = loadStaticAuth();
  data.passkeys = [pk, ...data.passkeys.filter((p) => p.id !== pk.id)];
  if (enableLock) data.enabled = true;
  saveStaticAuth(data);
  staticSetSessionUnlocked(true);
  return staticGetAuthStatus();
}

export function staticDeletePasskey(id: string): AuthStatusPayload {
  const data = loadStaticAuth();
  data.passkeys = data.passkeys.filter((p) => p.id !== id);
  saveStaticAuth(data);
  return staticGetAuthStatus();
}
