export type CurrencyCode = string;

export type PaymentMethod = 'cash' | 'credit_card';

export type ExpensePhase = 'pre_trip' | 'on_trip';

export type ScopeFilter = 'all' | 'pre_trip' | number;

export interface BudgetItem {
  id: string;
  name: string;
  budgetTwd: number;
  order: number;
}

export interface ExpenseRecord {
  id: string;
  title: string;
  categoryId: string;
  phase: ExpensePhase;
  dayNumber: number | null;
  expenseDate: string;
  currency: CurrencyCode;
  originalAmount: number;
  paymentMethod: PaymentMethod;
  exchangeRate: number;
  feeRate: number;
  feeTwd: number;
  totalTwd: number;
  rateSource: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface LedgerSettings {
  tripName: string;
  startDate: string;
  endDate?: string;
  tripDays: number;
  currencies: CurrencyCode[];
  customCurrencyNames?: Record<string, string>;
  cashRates: Record<string, number>;
  visaRates?: Record<string, number>;
  visaRateSource?: string;
  visaRateDate?: string;
  visaRateUpdatedAt?: number;
}

export interface TravelLedger {
  code: string;
  version: number;
  updatedAt: number;
  settings: LedgerSettings;
  budgets: BudgetItem[];
  expenses: ExpenseRecord[];
}

export interface LedgerSummary {
  code: string;
  tripName: string;
  startDate: string;
  tripDays: number;
  currencies: CurrencyCode[];
  expenseCount: number;
  totalBudgetTwd: number;
  totalActualTwd: number;
  updatedAt: number;
}

export interface LiveRatesPayload {
  base: 'TWD';
  ratesToTwd: Record<string, number>;
  visaDirectCurrencies: string[];
  source: string;
  fetchedAt: number;
  rateDate: string;
}

export interface RegisteredPasskeyInfo {
  id: string;
  name: string;
  deviceType: string;
  rpID: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface AuthStatusPayload {
  enabled: boolean;
  authenticated: boolean;
  hasPin: boolean;
  passkeys: RegisteredPasskeyInfo[];
}

