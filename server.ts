import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
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
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'ledgers.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_COOKIE_NAME = 'triple_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface StoredPasskey {
  id: string;
  publicKeyB64: string;
  counter: number;
  transports?: string[];
  deviceType: string;
  rpID: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface AuthStoreData {
  enabled: boolean;
  pinHash: string | null;
  pinSalt: string | null;
  sessionSecret: string;
  credentials: StoredPasskey[];
}

interface PendingChallenge {
  challenge: string;
  rpID: string;
  origin: string;
  expiresAt: number;
}

let authStore: AuthStoreData = {
  enabled: false,
  pinHash: null,
  pinSalt: null,
  sessionSecret: crypto.randomBytes(32).toString('hex'),
  credentials: [],
};

const pendingChallenges = new Map<string, PendingChallenge>();

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

// In-memory store + SSE subscribers
const ledgers = new Map<string, TravelLedger>();
const sseClients = new Map<string, Set<express.Response>>();
const listSseClients = new Set<express.Response>();

let cachedRates: LiveRatesPayload | null = null;
const RATE_CACHE_TTL_MS = 15 * 60 * 1000;

function normalizeCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return cleaned.slice(0, 24) || 'TRIP2026';
}

function normalizeCurrencyCode(raw: string): CurrencyCode | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (cleaned.length < 2 || cleaned.length > 8) return null;
  return cleaned;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createDefaultLedger(code: string, isSample = false): TravelLedger {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  if (isSample) {
    const budgets: BudgetItem[] = [
      { id: 'b_flight', name: '機票交通', budgetTwd: 16500, order: 0 },
      { id: 'b_hotel', name: '住宿飯店', budgetTwd: 18000, order: 1 },
      { id: 'b_food', name: '餐飲美食', budgetTwd: 12000, order: 2 },
      { id: 'b_ticket', name: '景點門票', budgetTwd: 5500, order: 3 },
      { id: 'b_shop', name: '購物伴手禮', budgetTwd: 10000, order: 4 },
      { id: 'b_misc', name: '網卡保險', budgetTwd: 2000, order: 5 },
    ];

    const expenses: ExpenseRecord[] = [
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
        title: '旅平險 + eSIM 5日無限',
        categoryId: 'b_misc',
        phase: 'pre_trip',
        dayNumber: null,
        expenseDate: today,
        currency: 'TWD',
        originalAmount: 1350,
        paymentMethod: 'credit_card',
        exchangeRate: 1,
        feeRate: 0,
        feeTwd: 0,
        totalTwd: 1350,
        rateSource: '台幣本幣（無手續費）',
        note: '',
        createdAt: now - 3600000 * 3,
        updatedAt: now - 3600000 * 3,
      },
      {
        id: 'e_4',
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
      {
        id: 'e_5',
        title: '一蘭拉麵 & 銀座燒肉晚餐',
        categoryId: 'b_food',
        phase: 'on_trip',
        dayNumber: 1,
        expenseDate: today,
        currency: 'JPY',
        originalAmount: 14800,
        paymentMethod: 'credit_card',
        exchangeRate: 0.214,
        feeRate: 0.015,
        feeTwd: 48,
        totalTwd: 3215,
        rateSource: 'VISA即時匯率',
        note: 'Day 1 晚餐',
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
      },
      {
        id: 'e_6',
        title: '晴空塔門票 & 迪士尼一日券',
        categoryId: 'b_ticket',
        phase: 'on_trip',
        dayNumber: 2,
        expenseDate: today,
        currency: 'JPY',
        originalAmount: 21500,
        paymentMethod: 'credit_card',
        exchangeRate: 0.214,
        feeRate: 0.015,
        feeTwd: 69,
        totalTwd: 4670,
        rateSource: 'VISA即時匯率',
        note: '',
        createdAt: now - 1800000,
        updatedAt: now - 1800000,
      },
      {
        id: 'e_7',
        title: '藥妝與電器伴手禮',
        categoryId: 'b_shop',
        phase: 'on_trip',
        dayNumber: 2,
        expenseDate: today,
        currency: 'USD',
        originalAmount: 125,
        paymentMethod: 'credit_card',
        exchangeRate: 32.45,
        feeRate: 0.015,
        feeTwd: 61,
        totalTwd: 4117,
        rateSource: 'VISA即時匯率',
        note: '機場免稅店美元計價刷卡',
        createdAt: now - 900000,
        updatedAt: now - 900000,
      },
    ];

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
        cashRates: {
          JPY: 0.212,
          USD: 32.3,
        },
      },
      budgets,
      expenses,
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

function toLedgerSummary(l: TravelLedger): LedgerSummary {
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

function getAllLedgerSummaries(): LedgerSummary[] {
  return Array.from(ledgers.values())
    .map(toLedgerSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadLedgersFromDisk() {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, TravelLedger>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && v.code) {
          ledgers.set(normalizeCode(k), v);
        }
      }
    } catch (err) {
      console.error('Failed to read ledgers.json:', err);
    }
  }
  if (ledgers.size === 0) {
    ledgers.set('TRIP2026', createDefaultLedger('TRIP2026', true));
    persistLedgersToDisk();
  }
}

function persistLedgersToDisk() {
  ensureDataDir();
  const obj: Record<string, TravelLedger> = {};
  for (const [k, v] of ledgers.entries()) {
    obj[k] = v;
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist ledgers.json:', err);
  }
}

function broadcastListUpdate() {
  if (listSseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ ledgers: getAllLedgerSummaries() })}\n\n`;
  for (const res of listSseClients) {
    try {
      res.write(payload);
    } catch {
      listSseClients.delete(res);
    }
  }
}

function broadcastLedgerUpdate(ledger: TravelLedger) {
  const clients = sseClients.get(ledger.code);
  if (clients && clients.size > 0) {
    const payload = `data: ${JSON.stringify(ledger)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }
  broadcastListUpdate();
}

function formatVisaDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

async function fetchVisaRateForPair(fromCurr: string, toCurr: string): Promise<number | null> {
  if (fromCurr === toCurr) return 1;
  const todayStr = formatVisaDate(new Date());
  const url =
    `https://usa.visa.com/cmsapi/fx/rates?amount=1&fee=0` +
    `&utcConvertedDate=${encodeURIComponent(todayStr)}` +
    `&exchangedate=${encodeURIComponent(todayStr)}` +
    `&fromCurr=${encodeURIComponent(toCurr)}` +
    `&toCurr=${encodeURIComponent(fromCurr)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2200);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://usa.visa.com/support/consumer/travel-support/exchange-rate-calculator.html',
      },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      convertedAmount?: string | number;
      conversionBankRate?: string | number;
    };
    const rawRate = Number(data.convertedAmount ?? data.conversionBankRate);
    if (Number.isFinite(rawRate) && rawRate > 0) {
      return Number(rawRate.toFixed(6));
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveRates(forceRefresh = false, extraCurrencies: string[] = []): Promise<LiveRatesPayload> {
  const now = Date.now();
  if (!forceRefresh && cachedRates && now - cachedRates.fetchedAt < RATE_CACHE_TTL_MS && extraCurrencies.length === 0) {
    return cachedRates;
  }

  const ratesToTwd: Record<string, number> = { ...FALLBACK_RATES_TO_TWD };
  const visaDirectCurrencies: string[] = [];
  let source = '離線基準匯率';
  let rateDate = new Date().toISOString().slice(0, 10);

  // 1. Fetch ALL global currency rates from live FX feed (base TWD)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch('https://open.er-api.com/v6/latest/TWD', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const json = (await resp.json()) as {
        result?: string;
        time_last_update_utc?: string;
        rates?: Record<string, number>;
      };
      if (json.result === 'success' && json.rates) {
        for (const [code, perTwd] of Object.entries(json.rates)) {
          if (code === 'TWD') {
            ratesToTwd.TWD = 1;
          } else if (typeof perTwd === 'number' && perTwd > 0) {
            ratesToTwd[code] = Number((1 / perTwd).toFixed(6));
          }
        }
        source = 'VISA參考即時匯率（即時國際匯率串接）';
        if (json.time_last_update_utc) {
          const parsedDate = new Date(json.time_last_update_utc);
          if (!Number.isNaN(parsedDate.getTime())) {
            rateDate = parsedDate.toISOString().slice(0, 10);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Primary live FX feed unavailable:', err);
  }

  // 2. Try VISA official rates endpoint for major & custom travel currencies
  try {
    const probeSet = new Set<string>(['JPY', 'USD', 'EUR', 'KRW', 'THB', 'HKD', ...extraCurrencies]);
    probeSet.delete('TWD');
    const visaResults = await Promise.all(
      Array.from(probeSet).map(async (curr) => ({
        curr,
        rate: await fetchVisaRateForPair(curr, 'TWD'),
      }))
    );
    for (const item of visaResults) {
      if (item.rate && item.rate > 0) {
        ratesToTwd[item.curr] = item.rate;
        visaDirectCurrencies.push(item.curr);
      }
    }
    if (visaDirectCurrencies.length > 0) {
      source = 'VISA 官方即時匯率';
    }
  } catch {
    // Keep FX feed values
  }

  cachedRates = {
    base: 'TWD',
    ratesToTwd,
    visaDirectCurrencies,
    source,
    fetchedAt: now,
    rateDate,
  };
  return cachedRates;
}

function sanitizeSettings(input: Partial<LedgerSettings>, existing: LedgerSettings): LedgerSettings {
  const rawCurrencies = Array.isArray(input.currencies) ? input.currencies : existing.currencies;
  const filtered = rawCurrencies
    .map((c) => (typeof c === 'string' ? normalizeCurrencyCode(c) : null))
    .filter((c): c is CurrencyCode => Boolean(c));
  const unique = Array.from(new Set<CurrencyCode>(['TWD', ...filtered]));

  const startDate =
    typeof input.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate)
      ? input.startDate
      : existing.startDate;

  let endDate =
    typeof input.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.endDate)
      ? input.endDate
      : existing.endDate;

  let tripDays = Number(input.tripDays ?? existing.tripDays);
  if (endDate) {
    const sParts = startDate.split('-').map(Number);
    const eParts = endDate.split('-').map(Number);
    const sMs = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
    const eMs = Date.UTC(eParts[0], eParts[1] - 1, eParts[2]);
    const diff = Math.round((eMs - sMs) / 86400000) + 1;
    tripDays = Math.min(90, Math.max(1, diff));
    if (eMs < sMs) {
      endDate = startDate;
    }
  } else {
    tripDays = Number.isFinite(tripDays) ? Math.min(90, Math.max(1, Math.round(tripDays))) : 5;
    const sParts = startDate.split('-').map(Number);
    const dt = new Date(Date.UTC(sParts[0], sParts[1] - 1, sParts[2] + tripDays - 1));
    endDate = dt.toISOString().slice(0, 10);
  }

  const customCurrencyNames: Record<string, string> = { ...(existing.customCurrencyNames || {}) };
  if (input.customCurrencyNames && typeof input.customCurrencyNames === 'object') {
    for (const [k, v] of Object.entries(input.customCurrencyNames)) {
      const code = normalizeCurrencyCode(k);
      if (code && typeof v === 'string' && v.trim()) {
        customCurrencyNames[code] = v.trim().slice(0, 24);
      }
    }
  }

  const cashRates: Record<string, number> = { ...(existing.cashRates || {}) };
  if (input.cashRates && typeof input.cashRates === 'object') {
    for (const [k, v] of Object.entries(input.cashRates)) {
      const code = normalizeCurrencyCode(k);
      if (code && code !== 'TWD') {
        const num = Number(v);
        if (Number.isFinite(num) && num >= 0) {
          cashRates[code] = Number(num.toFixed(6));
        }
      }
    }
  }

  const visaRates: Record<string, number> = { ...(existing.visaRates || {}) };
  if (input.visaRates && typeof input.visaRates === 'object') {
    for (const [k, v] of Object.entries(input.visaRates)) {
      const code = normalizeCurrencyCode(k);
      if (code && code !== 'TWD') {
        const num = Number(v);
        if (Number.isFinite(num) && num > 0) {
          visaRates[code] = Number(num.toFixed(6));
        }
      }
    }
  }

  return {
    tripName:
      typeof input.tripName === 'string' && input.tripName.trim()
        ? input.tripName.trim().slice(0, 80)
        : existing.tripName,
    startDate,
    endDate,
    tripDays,
    currencies: unique,
    customCurrencyNames,
    cashRates,
    visaRates,
    visaRateSource:
      typeof input.visaRateSource === 'string' ? input.visaRateSource : existing.visaRateSource,
    visaRateDate:
      typeof input.visaRateDate === 'string' ? input.visaRateDate : existing.visaRateDate,
    visaRateUpdatedAt:
      typeof input.visaRateUpdatedAt === 'number'
        ? input.visaRateUpdatedAt
        : existing.visaRateUpdatedAt,
  };
}

function loadAuthFromDisk() {
  ensureDataDir();
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AuthStoreData>;
      authStore = {
        enabled: Boolean(parsed.enabled),
        pinHash: typeof parsed.pinHash === 'string' ? parsed.pinHash : null,
        pinSalt: typeof parsed.pinSalt === 'string' ? parsed.pinSalt : null,
        sessionSecret:
          typeof parsed.sessionSecret === 'string' && parsed.sessionSecret.length >= 32
            ? parsed.sessionSecret
            : crypto.randomBytes(32).toString('hex'),
        credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      };
      return;
    } catch (err) {
      console.error('Failed to read auth.json:', err);
    }
  }
  persistAuthToDisk();
}

function persistAuthToDisk() {
  ensureDataDir();
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist auth.json:', err);
  }
}

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

function verifyPinMatch(pin: string): boolean {
  if (!authStore.pinHash || !authStore.pinSalt) return false;
  const derived = hashPin(pin, authStore.pinSalt);
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(authStore.pinHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSessionToken(): string {
  const payloadObj = {
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', authStore.sessionSecret)
    .update(payloadB64)
    .digest('hex');
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token: string | null | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payloadB64 = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigHex) return false;

  const expectedSig = crypto
    .createHmac('sha256', authStore.sessionSecret)
    .update(payloadB64)
    .digest('hex');

  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      if (key === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return null;
}

function extractRequestToken(req: express.Request): string | null {
  const authHeader = req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
}

function isRequestAuthenticated(req: express.Request): boolean {
  if (!authStore.enabled) return true;
  const token = extractRequestToken(req);
  return verifySessionToken(token);
}

function isHttpsRequest(req: express.Request): boolean {
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return req.secure || forwardedProto === 'https';
}

function setSessionCookie(req: express.Request, res: express.Response, token: string) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const attrs = isHttpsRequest(req)
    ? `Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAgeSec}`
    : `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`);
}

function clearSessionCookie(req: express.Request, res: express.Response) {
  const attrs = isHttpsRequest(req)
    ? 'Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0'
    : 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; ${attrs}`);
}

function getRequestOriginAndRpId(req: express.Request): { origin: string; rpID: string } {
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      return { origin: parsed.origin, rpID: parsed.hostname };
    } catch {
      // fall through
    }
  }
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`)
    .split(',')[0]
    .trim();
  return {
    origin: `${proto}://${host}`,
    rpID: host.split(':')[0],
  };
}

function toAuthStatus(req: express.Request): AuthStatusPayload {
  const passkeys: RegisteredPasskeyInfo[] = authStore.credentials.map((c) => ({
    id: c.id,
    name: c.name,
    deviceType: c.deviceType,
    rpID: c.rpID,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  }));
  return {
    enabled: authStore.enabled,
    authenticated: isRequestAuthenticated(req),
    hasPin: Boolean(authStore.pinHash),
    passkeys,
  };
}

function cleanupExpiredChallenges() {
  const now = Date.now();
  for (const [key, val] of pendingChallenges.entries()) {
    if (val.expiresAt <= now) {
      pendingChallenges.delete(key);
    }
  }
}

function requireAuthIfEnabled(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (isRequestAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: '尚未完成生物辨識或密碼驗證', authRequired: true });
}

async function startServer() {
  loadLedgersFromDisk();
  loadAuthFromDisk();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '5mb' }));

  // Auth status & management endpoints
  app.get('/api/auth/status', (req, res) => {
    res.json(toAuthStatus(req));
  });

  app.post('/api/auth/setup-pin', (req, res) => {
    if (authStore.enabled && !isRequestAuthenticated(req)) {
      res.status(401).json({ error: '請先解鎖後再更改密碼設定' });
      return;
    }
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!/^\d{4,8}$/.test(pin)) {
      res.status(400).json({ error: '備援密碼需為 4 至 8 位數字' });
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    authStore.pinSalt = salt;
    authStore.pinHash = hashPin(pin, salt);
    if (req.body?.enable === true) {
      authStore.enabled = true;
    }
    persistAuthToDisk();

    const token = createSessionToken();
    setSessionCookie(req, res, token);
    res.json({
      token,
      status: {
        ...toAuthStatus(req),
        hasPin: true,
        authenticated: true,
      },
    });
  });

  app.post('/api/auth/toggle', (req, res) => {
    if (authStore.enabled && !isRequestAuthenticated(req)) {
      res.status(401).json({ error: '請先解鎖後再變更驗證保護狀態' });
      return;
    }
    const enable = Boolean(req.body?.enabled);
    if (enable && !authStore.pinHash && authStore.credentials.length === 0) {
      res.status(400).json({ error: '請先註冊至少一組人臉辨識金鑰或設定備援密碼' });
      return;
    }
    authStore.enabled = enable;
    persistAuthToDisk();

    if (enable) {
      const token = createSessionToken();
      setSessionCookie(req, res, token);
      res.json({
        token,
        status: {
          ...toAuthStatus(req),
          enabled: true,
          authenticated: true,
        },
      });
      return;
    }
    res.json({ token: null, status: toAuthStatus(req) });
  });

  app.post('/api/auth/pin-verify', (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!authStore.pinHash) {
      res.status(400).json({ error: '尚未設定備援解鎖密碼' });
      return;
    }
    if (!verifyPinMatch(pin)) {
      res.status(401).json({ error: '備援解鎖密碼不正確' });
      return;
    }
    const token = createSessionToken();
    setSessionCookie(req, res, token);
    res.json({
      token,
      status: {
        ...toAuthStatus(req),
        authenticated: true,
      },
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/webauthn/register-options', async (req, res) => {
    if (authStore.enabled && !isRequestAuthenticated(req)) {
      res.status(401).json({ error: '請先解鎖後再註冊新的生物辨識裝置' });
      return;
    }
    cleanupExpiredChallenges();
    const { origin, rpID } = getRequestOriginAndRpId(req);
    const preferPlatform = req.body?.preferPlatform !== false;

    const options = await generateRegistrationOptions({
      rpName: '旅費帳本 TripLedger',
      rpID,
      userName: '旅費帳本持有者',
      userDisplayName: '旅費帳本持有者',
      attestationType: 'none',
      excludeCredentials: authStore.credentials
        .filter((c) => c.rpID === rpID)
        .map((c) => ({
          id: c.id,
          transports: c.transports,
        })),
      authenticatorSelection: {
        ...(preferPlatform ? { authenticatorAttachment: 'platform' as const } : {}),
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    const challengeId = crypto.randomBytes(16).toString('hex');
    pendingChallenges.set(challengeId, {
      challenge: options.challenge,
      rpID,
      origin,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ options, challengeId });
  });

  app.post('/api/auth/webauthn/register-verify', async (req, res) => {
    if (authStore.enabled && !isRequestAuthenticated(req)) {
      res.status(401).json({ error: '請先解鎖後再註冊新的生物辨識裝置' });
      return;
    }
    const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId : '';
    const deviceName =
      typeof req.body?.deviceName === 'string' && req.body.deviceName.trim()
        ? req.body.deviceName.trim().slice(0, 40)
        : 'iPhone Face ID';
    const response = req.body?.response;

    const pending = pendingChallenges.get(challengeId);
    pendingChallenges.delete(challengeId);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).json({ error: '驗證階段已逾時，請重新操作註冊' });
      return;
    }

    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        requireUserVerification: false,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: '裝置生物辨識註冊驗證失敗' });
        return;
      }

      const { credential, credentialDeviceType } = verification.registrationInfo;
      const stored: StoredPasskey = {
        id: credential.id,
        publicKeyB64: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        rpID: pending.rpID,
        name: deviceName,
        createdAt: Date.now(),
      };

      authStore.credentials = [
        stored,
        ...authStore.credentials.filter((c) => c.id !== stored.id),
      ];
      if (req.body?.enableLock === true) {
        authStore.enabled = true;
      }
      persistAuthToDisk();

      const token = createSessionToken();
      setSessionCookie(req, res, token);
      res.json({
        verified: true,
        token,
        status: {
          ...toAuthStatus(req),
          authenticated: true,
        },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : '無法完成生物辨識註冊驗證',
      });
    }
  });

  app.delete('/api/auth/webauthn/credentials/:id', (req, res) => {
    if (authStore.enabled && !isRequestAuthenticated(req)) {
      res.status(401).json({ error: '請先解鎖後再管理已註冊裝置' });
      return;
    }
    const id = req.params.id;
    const remaining = authStore.credentials.filter((c) => c.id !== id);
    if (authStore.enabled && remaining.length === 0 && !authStore.pinHash) {
      res.status(400).json({ error: '保護開啟中且無備援密碼，無法移除最後一組金鑰' });
      return;
    }
    authStore.credentials = remaining;
    persistAuthToDisk();
    res.json({ status: toAuthStatus(req) });
  });

  app.post('/api/auth/webauthn/login-options', async (req, res) => {
    cleanupExpiredChallenges();
    const { origin, rpID } = getRequestOriginAndRpId(req);
    const matchingCreds = authStore.credentials.filter((c) => c.rpID === rpID);

    if (matchingCreds.length === 0) {
      res.status(400).json({
        error: '目前網域尚無已註冊的生物辨識金鑰，請改用備援密碼解鎖後於此裝置註冊 Face ID。',
      });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: matchingCreds.map((c) => ({
        id: c.id,
        transports: c.transports,
      })),
    });

    const challengeId = crypto.randomBytes(16).toString('hex');
    pendingChallenges.set(challengeId, {
      challenge: options.challenge,
      rpID,
      origin,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.json({ options, challengeId });
  });

  app.post('/api/auth/webauthn/login-verify', async (req, res) => {
    const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId : '';
    const response = req.body?.response;

    const pending = pendingChallenges.get(challengeId);
    pendingChallenges.delete(challengeId);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).json({ error: '驗證挑戰已逾時，請重新點擊生物辨識' });
      return;
    }

    const credId = typeof response?.id === 'string' ? response.id : '';
    const stored = authStore.credentials.find((c) => c.id === credId);
    if (!stored) {
      res.status(404).json({ error: '找不到對應的裝置生物辨識金鑰' });
      return;
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpID,
        credential: {
          id: stored.id,
          publicKey: Uint8Array.from(Buffer.from(stored.publicKeyB64, 'base64')),
          counter: stored.counter,
          transports: stored.transports,
        },
        requireUserVerification: false,
      });

      if (!verification.verified) {
        res.status(401).json({ error: '人臉 / 生物辨識驗證未通過' });
        return;
      }

      stored.counter = verification.authenticationInfo.newCounter;
      stored.lastUsedAt = Date.now();
      persistAuthToDisk();

      const token = createSessionToken();
      setSessionCookie(req, res, token);
      res.json({
        verified: true,
        token,
        status: {
          ...toAuthStatus(req),
          authenticated: true,
        },
      });
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : '生物辨識簽章驗證失敗',
      });
    }
  });

  // Live VISA / FX exchange rates
  app.get('/api/rates', async (req, res) => {
    const force = req.query.refresh === '1';
    const extraRaw = typeof req.query.extra === 'string' ? req.query.extra : '';
    const extra = extraRaw
      .split(',')
      .map((s) => normalizeCurrencyCode(s))
      .filter((s): s is string => Boolean(s));
    const payload = await fetchLiveRates(force, extra);
    res.json(payload);
  });

  // Protect all ledger data & real-time sync streams when lock is enabled
  app.use('/api/ledgers', requireAuthIfEnabled);
  app.use('/api/ledgers-stream', requireAuthIfEnabled);

  // List all saved trip ledgers
  app.get('/api/ledgers', (_req, res) => {
    res.json({ ledgers: getAllLedgerSummaries() });
  });

  // SSE stream for trip ledger list changes
  app.get('/api/ledgers-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    listSseClients.add(res);
    res.write(`data: ${JSON.stringify({ ledgers: getAllLedgerSummaries() })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      listSseClients.delete(res);
    });
  });

  // Export one or all trip ledgers as portable backup JSON
  app.get('/api/ledgers/export', (req, res) => {
    const rawCode = typeof req.query.code === 'string' ? req.query.code : '';
    if (rawCode.trim()) {
      const code = normalizeCode(rawCode);
      const target = ledgers.get(code);
      if (!target) {
        res.status(404).json({ error: '找不到指定的旅行帳本' });
        return;
      }
      res.json({
        format: 'trip-ledger-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        scope: 'single',
        activeCode: target.code,
        ledgers: [target],
      });
      return;
    }

    const allLedgers = Array.from(ledgers.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({
      format: 'trip-ledger-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope: 'all',
      ledgers: allLedgers,
    });
  });

  // Import one or multiple trip ledgers from backup JSON
  app.post('/api/ledgers/import', (req, res) => {
    const incomingList = Array.isArray(req.body?.ledgers)
      ? (req.body.ledgers as Partial<TravelLedger>[])
      : [];
    const mode = req.body?.mode === 'create_new' ? 'create_new' : 'overwrite';

    if (incomingList.length === 0) {
      res.status(400).json({ error: '找不到可匯入的旅行帳本內容' });
      return;
    }

    const generateUniqueCode = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      do {
        code = `TRIP_${Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
      } while (ledgers.has(code));
      return code;
    };

    const now = Date.now();
    const importedLedgers: TravelLedger[] = [];
    let importedExpenseCount = 0;

    for (const raw of incomingList.slice(0, 50)) {
      if (!raw || typeof raw !== 'object' || !raw.settings) continue;

      const requestedCode =
        typeof raw.code === 'string' && raw.code.trim() ? normalizeCode(raw.code) : '';
      const targetCode =
        mode === 'create_new' || !requestedCode ? generateUniqueCode() : requestedCode;

      const existing = ledgers.get(targetCode);
      const base = existing || createDefaultLedger(targetCode, false);
      const cleanSettings = sanitizeSettings(raw.settings || {}, base.settings);

      const rawBudgets = Array.isArray(raw.budgets) ? raw.budgets : base.budgets;
      const cleanBudgets: BudgetItem[] = rawBudgets
        .filter((b) => b && typeof b.name === 'string' && b.name.trim())
        .map((b, index) => ({
          id:
            typeof b.id === 'string' && b.id.trim()
              ? b.id.trim().slice(0, 64)
              : `b_imp_${index + 1}`,
          name: b.name.trim().slice(0, 40),
          budgetTwd: Math.max(0, Math.round(Number(b.budgetTwd) || 0)),
          order: index,
        }));

      const rawExpenses = Array.isArray(raw.expenses) ? raw.expenses : [];
      const cleanExpenses: ExpenseRecord[] = rawExpenses
        .filter((e) => e && typeof e === 'object')
        .map((e, index) => {
          const currency = normalizeCurrencyCode(String(e.currency || 'TWD')) || 'TWD';
          const paymentMethod = e.paymentMethod === 'cash' ? 'cash' : 'credit_card';
          const phase = e.phase === 'pre_trip' ? 'pre_trip' : 'on_trip';
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
                : cleanBudgets[0]?.id || 'b_misc',
            phase,
            dayNumber:
              phase === 'on_trip'
                ? Math.max(1, Math.round(Number(e.dayNumber) || 1))
                : null,
            expenseDate:
              typeof e.expenseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.expenseDate)
                ? e.expenseDate
                : cleanSettings.startDate,
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

      const savedLedger: TravelLedger = {
        code: targetCode,
        version: existing ? existing.version + 1 : 1,
        updatedAt: now,
        settings: cleanSettings,
        budgets: cleanBudgets,
        expenses: cleanExpenses,
      };

      ledgers.set(targetCode, savedLedger);
      importedLedgers.push(savedLedger);
      importedExpenseCount += cleanExpenses.length;
    }

    if (importedLedgers.length === 0) {
      res.status(400).json({ error: '檔案中沒有有效的旅行帳本資料' });
      return;
    }

    persistLedgersToDisk();
    for (const item of importedLedgers) {
      broadcastLedgerUpdate(item);
    }

    res.json({
      importedCount: importedLedgers.length,
      importedExpenseCount,
      activeLedger: importedLedgers[0],
      ledgers: getAllLedgerSummaries(),
    });
  });

  // Fetch or initialize specific ledger
  app.get('/api/ledgers/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    let ledger = ledgers.get(code);
    if (!ledger) {
      ledger = createDefaultLedger(code, code === 'TRIP2026');
      ledgers.set(code, ledger);
      persistLedgersToDisk();
    }
    res.json(ledger);
  });

  // Create a brand new independent trip ledger
  app.post('/api/ledgers', (req, res) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = `TRIP_${Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`;
    } while (ledgers.has(code));

    const body = (req.body || {}) as Partial<LedgerSettings>;
    const fresh = createDefaultLedger(code, false);
    fresh.settings = sanitizeSettings(body, fresh.settings);
    ledgers.set(code, fresh);
    persistLedgersToDisk();
    broadcastListUpdate();
    res.status(201).json(fresh);
  });

  // Delete an unused trip ledger (keeps at least 1 ledger)
  app.delete('/api/ledgers/:code', (req, res) => {
    const code = normalizeCode(req.params.code);
    if (ledgers.size <= 1) {
      res.status(400).json({ error: '至少需保留一個旅行帳本' });
      return;
    }
    if (!ledgers.has(code)) {
      res.status(404).json({ error: '找不到指定的旅行帳本' });
      return;
    }
    ledgers.delete(code);
    persistLedgersToDisk();
    broadcastListUpdate();
    res.json({ ledgers: getAllLedgerSummaries() });
  });

  // SSE stream for real-time updates on a specific ledger
  app.get('/api/ledgers/:code/stream', (req, res) => {
    const code = normalizeCode(req.params.code);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let set = sseClients.get(code);
    if (!set) {
      set = new Set();
      sseClients.set(code, set);
    }
    set.add(res);

    const ledger = ledgers.get(code);
    if (ledger) {
      res.write(`data: ${JSON.stringify(ledger)}\n\n`);
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      set?.delete(res);
    });
  });

  // Update ledger settings
  app.put('/api/ledgers/:code/settings', (req, res) => {
    const code = normalizeCode(req.params.code);
    let ledger = ledgers.get(code);
    if (!ledger) {
      ledger = createDefaultLedger(code, false);
    }
    const nextSettings = sanitizeSettings(req.body || {}, ledger.settings);
    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: Date.now(),
      settings: nextSettings,
    };
    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.json(updated);
  });

  // Fetch fresh VISA rates for the ledger's selected currencies and apply them to the ledger
  app.post('/api/ledgers/:code/apply-visa-rates', async (req, res) => {
    const code = normalizeCode(req.params.code);
    let ledger = ledgers.get(code);
    if (!ledger) {
      ledger = createDefaultLedger(code, false);
    }

    const freshRates = await fetchLiveRates(true, ledger.settings.currencies);
    const nextVisaRates: Record<string, number> = { ...(ledger.settings.visaRates || {}) };
    for (const curr of ledger.settings.currencies) {
      if (curr === 'TWD') continue;
      const rate = freshRates.ratesToTwd[curr];
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        nextVisaRates[curr] = Number(rate.toFixed(6));
      }
    }

    const now = Date.now();
    let updatedExpenseCount = 0;
    const nextExpenses = ledger.expenses.map((exp) => {
      if (exp.paymentMethod !== 'credit_card' || exp.currency === 'TWD') {
        return exp;
      }
      const nextRate = freshRates.ratesToTwd[exp.currency] ?? nextVisaRates[exp.currency];
      if (!nextRate || !Number.isFinite(nextRate) || nextRate <= 0) {
        return exp;
      }
      const baseTwd = Math.round(exp.originalAmount * nextRate);
      const totalTwd = Math.round(exp.originalAmount * 1.015 * nextRate);
      const feeTwd = Math.max(0, totalTwd - baseTwd);
      const nextSource = freshRates.visaDirectCurrencies.includes(exp.currency)
        ? 'VISA 官方即時匯率'
        : 'VISA即時匯率';
      updatedExpenseCount += 1;
      return {
        ...exp,
        exchangeRate: nextRate,
        feeRate: 0.015,
        feeTwd,
        totalTwd,
        rateSource: nextSource,
        updatedAt: now,
      };
    });

    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: now,
      settings: {
        ...ledger.settings,
        visaRates: nextVisaRates,
        visaRateSource: freshRates.source,
        visaRateDate: freshRates.rateDate,
        visaRateUpdatedAt: freshRates.fetchedAt,
      },
      expenses: nextExpenses,
    };

    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.json({ ledger: updated, rates: freshRates, updatedExpenseCount });
  });

  // Replace / save budget items
  app.put('/api/ledgers/:code/budgets', (req, res) => {
    const code = normalizeCode(req.params.code);
    let ledger = ledgers.get(code);
    if (!ledger) {
      ledger = createDefaultLedger(code, false);
    }
    const incoming = Array.isArray(req.body?.budgets) ? (req.body.budgets as BudgetItem[]) : [];
    const cleaned: BudgetItem[] = incoming
      .filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string' && b.name.trim())
      .map((b, index) => ({
        id: b.id.slice(0, 64),
        name: b.name.trim().slice(0, 40),
        budgetTwd: Math.max(0, Math.round(Number(b.budgetTwd) || 0)),
        order: index,
      }));

    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: Date.now(),
      budgets: cleaned,
    };
    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.json(updated);
  });

  // Add a new expense
  app.post('/api/ledgers/:code/expenses', (req, res) => {
    const code = normalizeCode(req.params.code);
    let ledger = ledgers.get(code);
    if (!ledger) {
      ledger = createDefaultLedger(code, false);
    }
    const exp = req.body?.expense as ExpenseRecord | undefined;
    if (!exp || typeof exp.id !== 'string') {
      res.status(400).json({ error: 'Invalid expense payload' });
      return;
    }

    const now = Date.now();
    const sanitized: ExpenseRecord = {
      ...exp,
      title: (exp.title || '未命名消費').trim().slice(0, 80),
      note: (exp.note || '').trim().slice(0, 200),
      createdAt: exp.createdAt || now,
      updatedAt: now,
    };

    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: now,
      expenses: [sanitized, ...ledger.expenses.filter((e) => e.id !== sanitized.id)],
    };
    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.status(201).json(updated);
  });

  // Update an existing expense
  app.put('/api/ledgers/:code/expenses/:id', (req, res) => {
    const code = normalizeCode(req.params.code);
    const expenseId = req.params.id;
    const ledger = ledgers.get(code);
    if (!ledger) {
      res.status(404).json({ error: 'Ledger not found' });
      return;
    }
    const exp = req.body?.expense as ExpenseRecord | undefined;
    if (!exp) {
      res.status(400).json({ error: 'Invalid expense payload' });
      return;
    }

    const now = Date.now();
    const exists = ledger.expenses.some((e) => e.id === expenseId);
    const sanitized: ExpenseRecord = {
      ...exp,
      id: expenseId,
      title: (exp.title || '未命名消費').trim().slice(0, 80),
      note: (exp.note || '').trim().slice(0, 200),
      updatedAt: now,
    };

    const nextExpenses = exists
      ? ledger.expenses.map((e) => (e.id === expenseId ? sanitized : e))
      : [sanitized, ...ledger.expenses];

    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: now,
      expenses: nextExpenses,
    };
    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.json(updated);
  });

  // Delete an expense
  app.delete('/api/ledgers/:code/expenses/:id', (req, res) => {
    const code = normalizeCode(req.params.code);
    const expenseId = req.params.id;
    const ledger = ledgers.get(code);
    if (!ledger) {
      res.status(404).json({ error: 'Ledger not found' });
      return;
    }
    const now = Date.now();
    const updated: TravelLedger = {
      ...ledger,
      version: ledger.version + 1,
      updatedAt: now,
      expenses: ledger.expenses.filter((e) => e.id !== expenseId),
    };
    ledgers.set(code, updated);
    persistLedgersToDisk();
    broadcastLedgerUpdate(updated);
    res.json(updated);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TripLedger server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
