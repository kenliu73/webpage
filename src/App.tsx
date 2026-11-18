import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun,
  Moon,
  PlusCircle,
  LineChart,
  Receipt,
  Wallet,
  Settings,
  RefreshCw,
  Trash2,
  ScanFace,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import type {
  AuthStatusPayload,
  BudgetItem,
  CurrencyCode,
  ExpenseRecord,
  LedgerSettings,
  LedgerSummary,
  LiveRatesPayload,
  ScopeFilter,
  TravelLedger,
} from './types';
import { formatCurrencyAmount, formatTwd } from './constants/currencies';
import { authFetch, getSseAuthUrl, setStoredAuthToken } from './utils/authClient';
import {
  staticCreateLedger,
  staticDeleteExpense,
  staticDeleteLedger,
  staticFetchLiveRates,
  staticGetAuthStatus,
  staticGetLedger,
  staticGetLedgerSummaries,
  staticSaveExpense,
  staticSetSessionUnlocked,
  staticUpdateBudgets,
  staticUpdateSettings,
} from './utils/staticFallbackStore';
import { BudgetCurveChart } from './components/BudgetCurveChart';
import { BudgetPieChart } from './components/BudgetPieChart';
import { BudgetManagerPanel } from './components/BudgetManagerPanel';
import { ExpenseFormPanel } from './components/ExpenseFormPanel';
import { ExpenseListPanel } from './components/ExpenseListPanel';
import { TripSettingsPanel } from './components/TripSettingsPanel';
import { NewTripModal } from './components/NewTripModal';
import { AuthLockScreen } from './components/AuthLockScreen';
import { AuthSettingsModal } from './components/AuthSettingsModal';

type AppTab = 'ledger' | 'chart' | 'budgets' | 'settings';

function getInitialDarkMode(): boolean {
  const saved = localStorage.getItem('travel_ledger_theme');
  if (saved === 'dark') return true;
  if (saved === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function getInitialTripCode(): string {
  return localStorage.getItem('travel_ledger_active') || 'TRIP2026';
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(getInitialDarkMode);
  const [activeTab, setActiveTab] = useState<AppTab>('ledger');
  const [tripCode, setTripCode] = useState<string>(getInitialTripCode);
  const [tripList, setTripList] = useState<LedgerSummary[]>([]);
  const [ledger, setLedger] = useState<TravelLedger | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  const [rates, setRates] = useState<LiveRatesPayload | null>(null);
  const [ratesLoading, setRatesLoading] = useState<boolean>(false);

  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  const [submittingExpense, setSubmittingExpense] = useState<boolean>(false);
  const [savingBudgets, setSavingBudgets] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [foreignOnly, setForeignOnly] = useState<boolean>(false);
  const [newTripModalOpen, setNewTripModalOpen] = useState<boolean>(false);
  const [confirmDeleteTrip, setConfirmDeleteTrip] = useState<boolean>(false);

  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [staticMode, setStaticMode] = useState<boolean>(false);
  const [authStatus, setAuthStatus] = useState<AuthStatusPayload>({
    enabled: false,
    authenticated: true,
    hasPin: false,
    passkeys: [],
  });
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);

  const formSectionRef = useRef<HTMLElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);

  const isJsonResponse = (resp: Response) =>
    (resp.headers.get('content-type') || '').toLowerCase().includes('application/json');

  // Apply .dark class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('travel_ledger_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('travel_ledger_theme', 'light');
    }
  }, [darkMode]);

  // Fetch live VISA / FX exchange rates (falls back to direct CORS FX feed in static mode)
  const fetchRates = useCallback(
    async (force = false, extraCurrencies: string[] = []) => {
      setRatesLoading(true);
      try {
        if (!staticMode) {
          const params = new URLSearchParams();
          if (force) params.set('refresh', '1');
          if (extraCurrencies.length > 0) params.set('extra', extraCurrencies.join(','));
          const qs = params.toString();
          const resp = await fetch(`/api/rates${qs ? `?${qs}` : ''}`);
          if (resp.ok && isJsonResponse(resp)) {
            const data = (await resp.json()) as LiveRatesPayload;
            setRates(data);
            return;
          }
        }
        const staticRates = await staticFetchLiveRates();
        setRates(staticRates);
      } catch {
        const staticRates = await staticFetchLiveRates();
        setRates(staticRates);
      } finally {
        setRatesLoading(false);
      }
    },
    [staticMode]
  );

  useEffect(() => {
    fetchRates(false);
  }, [fetchRates]);

  const isUnlocked = authChecked && (!authStatus.enabled || authStatus.authenticated);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/auth/status');
      if (resp.ok && isJsonResponse(resp)) {
        const data = (await resp.json()) as AuthStatusPayload;
        setStaticMode(false);
        setAuthStatus(data);
      } else {
        setStaticMode(true);
        setAuthStatus(staticGetAuthStatus());
      }
    } catch {
      setStaticMode(true);
      setAuthStatus(staticGetAuthStatus());
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    refreshAuthStatus();
  }, [refreshAuthStatus]);

  const handleLockNow = async () => {
    if (staticMode) {
      staticSetSessionUnlocked(false);
    } else {
      try {
        await authFetch('/api/auth/logout', { method: 'POST' });
      } catch {
        // ignore
      }
      setStoredAuthToken(null);
    }
    setSseConnected(false);
    setAuthStatus((prev) => ({
      ...prev,
      authenticated: !prev.enabled,
    }));
  };

  const handleUnauthorized = useCallback(() => {
    setStoredAuthToken(null);
    setSseConnected(false);
    setAuthStatus((prev) => ({ ...prev, enabled: true, authenticated: false }));
  }, []);

  // Fetch all trip ledgers list & subscribe to live list updates (only when unlocked)
  const fetchTripList = useCallback(async () => {
    if (!isUnlocked) return;
    if (staticMode) {
      const summaries = staticGetLedgerSummaries();
      setTripList(summaries);
      if (summaries.length > 0 && !summaries.some((t) => t.code === tripCode)) {
        const firstCode = summaries[0].code;
        localStorage.setItem('travel_ledger_active', firstCode);
        setTripCode(firstCode);
      }
      return;
    }
    try {
      const resp = await authFetch('/api/ledgers');
      if (resp.status === 401) {
        handleUnauthorized();
        return;
      }
      if (resp.ok && isJsonResponse(resp)) {
        const data = (await resp.json()) as { ledgers: LedgerSummary[] };
        if (Array.isArray(data.ledgers) && data.ledgers.length > 0) {
          setTripList(data.ledgers);
          if (!data.ledgers.some((t) => t.code === tripCode)) {
            const firstCode = data.ledgers[0].code;
            localStorage.setItem('travel_ledger_active', firstCode);
            setTripCode(firstCode);
          }
        }
      }
    } catch {
      // ignore transient list fetch errors
    }
  }, [tripCode, isUnlocked, staticMode, handleUnauthorized]);

  useEffect(() => {
    if (!isUnlocked) return;
    fetchTripList();
    if (staticMode) return;
    const listEs = new EventSource(getSseAuthUrl('/api/ledgers-stream'));
    listEs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { ledgers?: LedgerSummary[] };
        if (Array.isArray(data.ledgers)) {
          setTripList(data.ledgers);
        }
      } catch {
        // ignore heartbeat
      }
    };
    return () => listEs.close();
  }, [fetchTripList, isUnlocked, staticMode]);

  // Fetch active trip ledger
  const fetchLedger = useCallback(
    async (code: string) => {
      if (!isUnlocked) return;
      if (staticMode) {
        setLedger(staticGetLedger(code));
        setLoadError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const resp = await authFetch(`/api/ledgers/${encodeURIComponent(code)}`);
        if (resp.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!resp.ok || !isJsonResponse(resp)) throw new Error('無法讀取旅遊帳本資料');
        const data = (await resp.json()) as TravelLedger;
        setLedger(data);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : '連線失敗');
      } finally {
        setLoading(false);
      }
    },
    [isUnlocked, staticMode, handleUnauthorized]
  );

  useEffect(() => {
    if (!isUnlocked) return;
    fetchLedger(tripCode);
  }, [tripCode, fetchLedger, isUnlocked]);

  // Real-time SSE sync for active trip ledger
  useEffect(() => {
    if (!isUnlocked || staticMode) return;
    const url = getSseAuthUrl(`/api/ledgers/${encodeURIComponent(tripCode)}/stream`);
    const es = new EventSource(url);

    es.onopen = () => {
      setSseConnected(true);
    };
    es.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as TravelLedger;
        if (incoming && incoming.code === tripCode) {
          setLedger((prev) => {
            if (!prev || incoming.version >= prev.version) {
              return incoming;
            }
            return prev;
          });
        }
      } catch {
        // ignore malformed heartbeat
      }
    };
    es.onerror = () => {
      setSseConnected(false);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchLedger(tripCode);
        fetchTripList();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      es.close();
      setSseConnected(false);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tripCode, fetchLedger, fetchTripList, isUnlocked, staticMode]);

  const handleSelectTrip = (nextCode: string) => {
    localStorage.setItem('travel_ledger_active', nextCode);
    setEditingExpense(null);
    setScopeFilter('all');
    setConfirmDeleteTrip(false);
    setTripCode(nextCode);
  };

  const handleCreateTrip = async (settings: Partial<LedgerSettings>) => {
    if (staticMode) {
      const created = staticCreateLedger(settings);
      setLedger(created);
      localStorage.setItem('travel_ledger_active', created.code);
      setTripCode(created.code);
      setEditingExpense(null);
      setScopeFilter('all');
      await fetchTripList();
      await fetchRates(true, created.settings.currencies);
      return;
    }
    const resp = await authFetch('/api/ledgers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (resp.status === 401) {
      handleUnauthorized();
      return;
    }
    if (resp.ok) {
      const created = (await resp.json()) as TravelLedger;
      setLedger(created);
      localStorage.setItem('travel_ledger_active', created.code);
      setTripCode(created.code);
      setEditingExpense(null);
      setScopeFilter('all');
      await fetchTripList();
      await fetchRates(true, created.settings.currencies);
    }
  };

  const handleDeleteCurrentTrip = async () => {
    if (tripList.length <= 1) return;
    if (staticMode) {
      const summaries = staticDeleteLedger(tripCode);
      setTripList(summaries);
      setConfirmDeleteTrip(false);
      if (summaries.length > 0) {
        const nextCode = summaries[0].code;
        localStorage.setItem('travel_ledger_active', nextCode);
        setTripCode(nextCode);
      }
      return;
    }
    const resp = await authFetch(`/api/ledgers/${encodeURIComponent(tripCode)}`, {
      method: 'DELETE',
    });
    if (resp.status === 401) {
      handleUnauthorized();
      return;
    }
    if (resp.ok) {
      const data = (await resp.json()) as { ledgers: LedgerSummary[] };
      setTripList(data.ledgers);
      setConfirmDeleteTrip(false);
      if (data.ledgers.length > 0) {
        const nextCode = data.ledgers[0].code;
        localStorage.setItem('travel_ledger_active', nextCode);
        setTripCode(nextCode);
      }
    }
  };

  const handleSaveSettings = async (nextSettings: LedgerSettings) => {
    setSavingSettings(true);
    try {
      if (staticMode) {
        const updated = staticUpdateSettings(tripCode, nextSettings);
        setLedger(updated);
        setTripList(staticGetLedgerSummaries());
        fetchRates(false, updated.settings.currencies);
        return;
      }
      const resp = await authFetch(`/api/ledgers/${encodeURIComponent(tripCode)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (resp.status === 401) {
        handleUnauthorized();
        return;
      }
      if (resp.ok) {
        const updated = (await resp.json()) as TravelLedger;
        setLedger(updated);
        fetchRates(false, updated.settings.currencies);
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveBudgets = async (nextBudgets: BudgetItem[]) => {
    setSavingBudgets(true);
    try {
      if (staticMode) {
        const updated = staticUpdateBudgets(tripCode, nextBudgets);
        setLedger(updated);
        setTripList(staticGetLedgerSummaries());
        return;
      }
      const resp = await authFetch(`/api/ledgers/${encodeURIComponent(tripCode)}/budgets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgets: nextBudgets }),
      });
      if (resp.status === 401) {
        handleUnauthorized();
        return;
      }
      if (resp.ok) {
        const updated = (await resp.json()) as TravelLedger;
        setLedger(updated);
      }
    } finally {
      setSavingBudgets(false);
    }
  };

  const handleSubmitExpense = async (expense: ExpenseRecord, isEdit: boolean) => {
    setSubmittingExpense(true);
    try {
      if (staticMode) {
        const updated = staticSaveExpense(tripCode, expense, isEdit);
        setLedger(updated);
        setTripList(staticGetLedgerSummaries());
        return;
      }
      const endpoint = isEdit
        ? `/api/ledgers/${encodeURIComponent(tripCode)}/expenses/${encodeURIComponent(expense.id)}`
        : `/api/ledgers/${encodeURIComponent(tripCode)}/expenses`;
      const resp = await authFetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expense }),
      });
      if (resp.status === 401) {
        handleUnauthorized();
        return;
      }
      if (resp.ok) {
        const updated = (await resp.json()) as TravelLedger;
        setLedger(updated);
      }
    } finally {
      setSubmittingExpense(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (staticMode) {
      const updated = staticDeleteExpense(tripCode, expenseId);
      setLedger(updated);
      setTripList(staticGetLedgerSummaries());
      if (editingExpense?.id === expenseId) {
        setEditingExpense(null);
      }
      return;
    }
    const resp = await authFetch(
      `/api/ledgers/${encodeURIComponent(tripCode)}/expenses/${encodeURIComponent(expenseId)}`,
      { method: 'DELETE' }
    );
    if (resp.status === 401) {
      handleUnauthorized();
      return;
    }
    if (resp.ok) {
      const updated = (await resp.json()) as TravelLedger;
      setLedger(updated);
      if (editingExpense?.id === expenseId) {
        setEditingExpense(null);
      }
    }
  };

  const handleStartEditExpense = (expense: ExpenseRecord) => {
    setEditingExpense(expense);
    setActiveTab('ledger');
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  // Global KPI computations
  const kpis = useMemo(() => {
    if (!ledger) {
      return {
        totalBudget: 0,
        totalActual: 0,
        remaining: 0,
        preTripTwd: 0,
        onTripTwd: 0,
        foreignTotalTwd: 0,
        foreignOriginals: '',
      };
    }

    const totalBudget = ledger.budgets.reduce((s, b) => s + (b.budgetTwd || 0), 0);
    let totalActual = 0;
    let preTripTwd = 0;
    let onTripTwd = 0;
    let foreignTotalTwd = 0;
    const foreignByCurr = new Map<CurrencyCode, number>();

    for (const exp of ledger.expenses) {
      totalActual += exp.totalTwd;
      if (exp.phase === 'pre_trip') preTripTwd += exp.totalTwd;
      else onTripTwd += exp.totalTwd;

      if (exp.currency !== 'TWD') {
        foreignTotalTwd += exp.totalTwd;
        foreignByCurr.set(
          exp.currency,
          (foreignByCurr.get(exp.currency) || 0) + exp.originalAmount
        );
      }
    }

    const foreignOriginals = Array.from(foreignByCurr.entries())
      .map(([c, amt]) => formatCurrencyAmount(amt, c))
      .join(' · ');

    return {
      totalBudget,
      totalActual,
      remaining: totalBudget - totalActual,
      preTripTwd,
      onTripTwd,
      foreignTotalTwd,
      foreignOriginals,
    };
  }, [ledger]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="display-yellow rounded-2xl px-6 py-5 text-sm font-semibold">
          正在確認裝置驗證狀態...
        </div>
      </div>
    );
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return (
      <AuthLockScreen
        authStatus={authStatus}
        staticMode={staticMode}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onUnlocked={(nextStatus) => {
          setAuthStatus(nextStatus);
        }}
      />
    );
  }

  if (loading && !ledger) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="display-yellow rounded-2xl px-6 py-5 text-sm font-semibold">
          正在載入旅遊預算紀錄簿...
        </div>
      </div>
    );
  }

  if (loadError && !ledger) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-4 p-6">
        <div className="display-yellow rounded-2xl px-6 py-5 text-sm font-semibold">
          讀取帳本失敗：{loadError}
        </div>
        <button
          type="button"
          onClick={() => fetchLedger(tripCode)}
          className="control-green-active h-11 px-5 rounded-xl text-sm font-semibold"
        >
          重新載入
        </button>
      </div>
    );
  }

  if (!ledger) return null;

  const tabs: { id: AppTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { id: 'ledger', label: '記帳輸入與明細', shortLabel: '記帳明細', icon: <Receipt className="w-5 h-5" /> },
    { id: 'chart', label: '花費總覽', shortLabel: '花費總覽', icon: <LineChart className="w-5 h-5" /> },
    { id: 'budgets', label: '預算設定', shortLabel: '預算設定', icon: <Wallet className="w-5 h-5" /> },
    { id: 'settings', label: '行程與貨幣設定', shortLabel: '行程貨幣', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden md:h-auto md:min-h-screen md:block md:overflow-visible bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:pb-12">
      {/* Desktop Top Bar: Strict 3-Zone Contract with 4 Tabs */}
      <header className="hidden md:block sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0">
            旅費帳本
          </span>

          <nav aria-label="主頁籤導覽" className="flex items-center gap-6 text-sm font-medium">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300 font-bold'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setNewTripModalOpen(true)}
            className="control-green-active h-10 px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            <span>開新旅行帳本</span>
          </button>
        </div>
      </header>

      {/* Mobile Compact Top App Bar (56px height, permanently pinned at top) */}
      <header className="md:hidden shrink-0 relative z-30 h-14 px-2.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2.5">
        {confirmDeleteTrip && tripList.length > 1 ? (
          <div className="absolute inset-0 z-10 px-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-rose-700 dark:text-rose-300 truncate min-w-0">
              確定刪除「{ledger.settings.tripName}」？
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleDeleteCurrentTrip}
                className="h-11 px-3 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 whitespace-nowrap"
              >
                確定刪除
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteTrip(false)}
                className="control-green h-11 px-3 rounded-lg text-xs font-semibold whitespace-nowrap"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {tripList.length > 1 && (
            <button
              type="button"
              onClick={() => setConfirmDeleteTrip(true)}
              title="刪除選取帳本"
              aria-label="刪除選取帳本"
              className="control-green h-11 w-11 rounded-lg flex items-center justify-center shrink-0 text-rose-700 dark:text-rose-300"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <select
            aria-label="選擇旅行帳本"
            value={tripCode}
            onChange={(e) => {
              setConfirmDeleteTrip(false);
              handleSelectTrip(e.target.value);
            }}
            className="input-green h-11 pl-2.5 pr-1 rounded-lg text-sm font-semibold cursor-pointer min-w-0 flex-1 truncate"
          >
            {tripList.length === 0 ? (
              <option value={ledger.code}>{ledger.settings.tripName}</option>
            ) : (
              tripList.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.tripName}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => fetchRates(true, ledger.settings.currencies)}
            disabled={ratesLoading}
            title="手動更新VISA匯率"
            aria-label="手動更新VISA匯率"
            className="control-green h-11 min-w-[42px] px-1.5 rounded-lg text-[11px] leading-none font-semibold flex flex-col items-center justify-center gap-1 whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 shrink-0 ${ratesLoading ? 'animate-spin' : ''}`} />
            <span>匯率</span>
          </button>

          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            title={authStatus.enabled ? '人臉驗證保護中' : '設定人臉驗證'}
            aria-label={authStatus.enabled ? '人臉驗證保護中' : '設定人臉驗證'}
            className={`h-11 min-w-[42px] px-1.5 rounded-lg text-[11px] leading-none font-semibold flex flex-col items-center justify-center gap-1 whitespace-nowrap ${
              authStatus.enabled ? 'control-green-active' : 'control-green'
            }`}
          >
            {authStatus.enabled ? (
              <ShieldCheck className="w-4 h-4 shrink-0" />
            ) : (
              <ScanFace className="w-4 h-4 shrink-0" />
            )}
            <span>{authStatus.enabled ? '保護' : '驗證'}</span>
          </button>

          {authStatus.enabled && (
            <button
              type="button"
              onClick={handleLockNow}
              title="立即鎖定"
              aria-label="立即鎖定"
              className="control-green h-11 min-w-[42px] px-1.5 rounded-lg text-[11px] leading-none font-semibold flex flex-col items-center justify-center gap-1 whitespace-nowrap"
            >
              <Lock className="w-4 h-4 shrink-0" />
              <span>鎖定</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setNewTripModalOpen(true)}
            className="control-green-active h-11 min-w-[46px] px-1.5 rounded-lg text-[11px] leading-none font-semibold flex flex-col items-center justify-center gap-1 whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4 shrink-0" />
            <span>新旅行</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main
        ref={mainScrollRef}
        id="top"
        className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-4 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-y-contain md:overflow-visible md:pb-0"
      >
        {/* Compact Workspace Toolbar: Desktop Only (Hidden on mobile per request) */}
        <section className="hidden md:block rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5 space-y-2.5">
          <div className="space-y-1.5 min-w-0">
            {/* Desktop Trip Bookshelf Switcher */}
            <div className="flex items-center gap-2 min-w-0">
              <label
                htmlFor="trip-switcher"
                className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0"
              >
                目前旅行帳本：
              </label>
              <select
                id="trip-switcher"
                value={tripCode}
                onChange={(e) => handleSelectTrip(e.target.value)}
                className="input-green h-9 px-3 rounded-lg text-sm font-bold cursor-pointer min-w-0 max-w-[260px] lg:max-w-md"
              >
                {tripList.length === 0 ? (
                  <option value={ledger.code}>{ledger.settings.tripName}</option>
                ) : (
                  tripList.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.tripName}（{item.startDate} · {item.tripDays}天 · {item.expenseCount}筆）
                    </option>
                  ))
                )}
              </select>

              {tripList.length > 1 && (
                confirmDeleteTrip ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDeleteCurrentTrip}
                      className="h-9 px-3 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
                    >
                      確定刪除此帳本
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteTrip(false)}
                      className="control-green h-9 px-2.5 rounded-lg text-xs font-semibold"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTrip(true)}
                    title="刪除目前這本旅行帳本"
                    aria-label="刪除目前這本旅行帳本"
                    className="control-green h-9 w-9 rounded-lg flex items-center justify-center text-rose-700 dark:text-rose-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-mono-num">{ledger.settings.startDate} 出發</span>
              <span aria-hidden="true">·</span>
              <span>共 {ledger.settings.tripDays} 天</span>
              <span aria-hidden="true">·</span>
              <span>使用幣別：{ledger.settings.currencies.join(' / ')}</span>
              <span aria-hidden="true">·</span>
              <span>
                {rates
                  ? `${rates.source} (${rates.rateDate})`
                  : '載入即時匯率中'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="hidden md:flex flex-wrap items-center gap-2">
              {/* Day / Night Mode Toggle (Desktop only) */}
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="control-green h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{darkMode ? '切換日間模式' : '切換夜間模式'}</span>
              </button>

              {/* Manual Refresh VISA Rates Tool */}
              <button
                type="button"
                onClick={() => fetchRates(true, ledger.settings.currencies)}
                disabled={ratesLoading}
                className="control-green h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${ratesLoading ? 'animate-spin' : ''}`} />
                <span>手動更新VISA匯率</span>
              </button>

              {/* Face ID / Biometric & PIN Security Button */}
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                  authStatus.enabled ? 'control-green-active' : 'control-green'
                }`}
              >
                {authStatus.enabled ? (
                  <ShieldCheck className="w-3.5 h-3.5" />
                ) : (
                  <ScanFace className="w-3.5 h-3.5" />
                )}
                <span>{authStatus.enabled ? '人臉驗證保護中' : '設定人臉驗證'}</span>
              </button>

              {authStatus.enabled && (
                <button
                  type="button"
                  onClick={handleLockNow}
                  className="control-green h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>立即鎖定</span>
                </button>
              )}
            </div>

            <span className="text-xs text-slate-500 dark:text-slate-400 md:ml-auto whitespace-nowrap">
              {staticMode
                ? `靜態網頁模式（已儲存 ${tripList.length} 本旅行帳本 · 本機儲存）`
                : sseConnected
                  ? `已儲存 ${tripList.length} 本旅行帳本 · 桌機與手機資料同步中`
                  : '雲端同步連線中'}
            </span>
          </div>
        </section>

        {/* Tab 1: Expense Input & Expense List */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            <section
              ref={formSectionRef}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4"
            >
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                  {editingExpense ? '編輯修改消費紀錄' : '新增旅遊消費紀錄'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  選擇「信用卡」外幣消費自動抓取 VISA 即時匯率並加計 1.5% 手續費；選擇「現金」外幣消費則套用第 4 頁籤預先設定之固定現金匯率。
                </p>
              </div>

              <ExpenseFormPanel
                settings={ledger.settings}
                budgets={ledger.budgets}
                rates={rates}
                ratesLoading={ratesLoading}
                onRefreshRates={() => fetchRates(true, ledger.settings.currencies)}
                editingExpense={editingExpense}
                onCancelEdit={() => setEditingExpense(null)}
                onSubmitExpense={handleSubmitExpense}
                submitting={submittingExpense}
              />
            </section>

            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                  消費明細與篩選統計
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  可依「整趟行程」、「行前」或「每一日」篩選總支出與外幣消費總額，並可隨時編輯或刪除紀錄。
                </p>
              </div>

              <ExpenseListPanel
                settings={ledger.settings}
                budgets={ledger.budgets}
                expenses={ledger.expenses}
                scopeFilter={scopeFilter}
                onScopeFilterChange={setScopeFilter}
                foreignOnly={foreignOnly}
                onForeignOnlyChange={setForeignOnly}
                onEditExpense={handleStartEditExpense}
                onDeleteExpense={handleDeleteExpense}
              />
            </section>
          </div>
        )}

        {/* Tab 2: Spending Overview, Budget Proportion Pie Chart & Curve Chart */}
        {activeTab === 'chart' && (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-6">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                花費總覽（台幣 TWD）
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                以台幣為統一比較基準，掌握整趟總預算、實際支出、外幣消費總額、預算分類占比圓餅圖與預算執行曲線。
              </p>
            </div>

            {/* KPI Summary Row (Yellow Read-Only Display Cards) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="display-yellow rounded-xl px-4 py-3">
                <div className="text-xs font-medium opacity-80">本趟總預算 (TWD)</div>
                <div className="text-lg sm:text-2xl font-mono-num font-bold mt-1">
                  {formatTwd(kpis.totalBudget)}
                </div>
                <div className="text-[11px] opacity-75 mt-0.5">
                  共 {ledger.budgets.length} 項預算類別
                </div>
              </div>

              <div className="display-yellow rounded-xl px-4 py-3">
                <div className="text-xs font-medium opacity-80">本趟實際總支出</div>
                <div className="text-lg sm:text-2xl font-mono-num font-bold mt-1">
                  {formatTwd(kpis.totalActual)}
                </div>
                <div className="text-[11px] opacity-75 mt-0.5 font-mono-num truncate">
                  行前 {formatTwd(kpis.preTripTwd)} · 行程 {formatTwd(kpis.onTripTwd)}
                </div>
              </div>

              <div className="display-yellow rounded-xl px-4 py-3">
                <div className="text-xs font-medium opacity-80">
                  {kpis.remaining >= 0 ? '預算剩餘額度' : '預算已超支'}
                </div>
                <div
                  className={`text-lg sm:text-2xl font-mono-num font-bold mt-1 ${
                    kpis.remaining < 0 ? 'text-rose-700 dark:text-rose-300' : ''
                  }`}
                >
                  {kpis.remaining >= 0
                    ? formatTwd(kpis.remaining)
                    : `-${formatTwd(Math.abs(kpis.remaining))}`}
                </div>
                <div className="text-[11px] opacity-75 mt-0.5 font-mono-num">
                  執行率{' '}
                  {kpis.totalBudget > 0
                    ? `${Math.round((kpis.totalActual / kpis.totalBudget) * 100)}%`
                    : '0%'}
                </div>
              </div>

              <div className="display-yellow rounded-xl px-4 py-3">
                <div className="text-xs font-medium opacity-80">本趟外幣消費總額</div>
                <div className="text-lg sm:text-2xl font-mono-num font-bold mt-1">
                  {formatTwd(kpis.foreignTotalTwd)}
                </div>
                <div className="text-[11px] opacity-75 mt-0.5 font-mono-num truncate">
                  {kpis.foreignOriginals || '尚無外幣消費'}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-white">
                  預算金額與實際消費對比曲線圖
                </h3>
              </div>
              <BudgetCurveChart budgets={ledger.budgets} expenses={ledger.expenses} />
            </div>

            <div className="border-t border-slate-100 dark:border-slate-800 pt-5">
              <BudgetPieChart budgets={ledger.budgets} expenses={ledger.expenses} />
            </div>
          </section>
        )}

        {/* Tab 3: Budget Setup */}
        {activeTab === 'budgets' && (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                各項預算項目與金額設定
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                自由新增、編輯或刪除預算項目名稱與台幣預算額度（支援計算機輸入）。
              </p>
            </div>

            <BudgetManagerPanel
              budgets={ledger.budgets}
              onSaveBudgets={handleSaveBudgets}
              saving={savingBudgets}
            />
          </section>
        )}

        {/* Tab 4: Trip & Currency Settings */}
        {activeTab === 'settings' && (
          <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                行程與貨幣設定
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                設定本次旅遊名稱、出發與回程日期、使用貨幣（可自行輸入新增），以及出國前換匯的固定現金匯率。
              </p>
            </div>

            <TripSettingsPanel
              settings={ledger.settings}
              onSaveSettings={handleSaveSettings}
              saving={savingSettings}
            />
          </section>
        )}
      </main>

      {/* Mobile Permanently Pinned Bottom Navigation Bar (4 Exact Tabs) */}
      <nav
        aria-label="行動版主要導覽"
        className="md:hidden shrink-0 z-40 min-h-14 pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4"
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                mainScrollRef.current?.scrollTo({ top: 0 });
              }}
              className={`h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                active
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {tab.icon}
              <span>{tab.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Create New Independent Travel Ledger Modal */}
      <NewTripModal
        isOpen={newTripModalOpen}
        onClose={() => setNewTripModalOpen(false)}
        onCreateTrip={handleCreateTrip}
      />

      {/* Face ID / WebAuthn & PIN Security Settings Modal */}
      <AuthSettingsModal
        isOpen={authModalOpen}
        authStatus={authStatus}
        staticMode={staticMode}
        onClose={() => setAuthModalOpen(false)}
        onStatusChange={(nextStatus) => setAuthStatus(nextStatus)}
        onLockNow={handleLockNow}
      />
    </div>
  );
}
