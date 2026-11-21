import type { ExpenseRecord, TravelLedger } from '../types';
import { sanitizeImportedLedgerClient } from './ledgerBackup';
import {
  getStaticLedgersMapRaw,
  loadStaticTombstones,
  replaceStaticSyncState,
  type StaticTombstones,
} from './staticFallbackStore';

const CLOUD_SYNC_CONFIG_KEY = 'triple_cloud_sync_config_v1';
const GIST_FILENAME = 'tripledger-sync.json';

export interface CloudSyncConfig {
  gistId: string;
  token: string;
  lastSyncedAt?: number;
}

export interface SyncBundle {
  format: 'trip-ledger-sync-bundle';
  version: 1;
  updatedAt: number;
  ledgers: Record<string, TravelLedger>;
  deletedLedgers: Record<string, number>;
  deletedExpenses: Record<string, number>;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padLen = (4 - (encoded.length % 4)) % 4;
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function loadCloudSyncConfig(): CloudSyncConfig | null {
  try {
    const raw = localStorage.getItem(CLOUD_SYNC_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudSyncConfig>;
    if (
      typeof parsed.gistId === 'string' &&
      parsed.gistId.trim() &&
      typeof parsed.token === 'string' &&
      parsed.token.trim()
    ) {
      return {
        gistId: parsed.gistId.trim(),
        token: parsed.token.trim(),
        lastSyncedAt: typeof parsed.lastSyncedAt === 'number' ? parsed.lastSyncedAt : undefined,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveCloudSyncConfig(config: CloudSyncConfig | null): void {
  try {
    if (!config) {
      localStorage.removeItem(CLOUD_SYNC_CONFIG_KEY);
    } else {
      localStorage.setItem(CLOUD_SYNC_CONFIG_KEY, JSON.stringify(config));
    }
  } catch {
    // ignore
  }
}

export function buildServerTripShareUrl(tripCode: string): string {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set('trip', tripCode);
  return url.toString();
}

export function buildGistPairingUrl(config: CloudSyncConfig, tripCode: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('trip', tripCode);
  const payload = `${encodeURIComponent(config.gistId)}:${encodeURIComponent(config.token)}`;
  url.hash = `sync=${payload}`;
  return url.toString();
}

export function buildSnapshotShareUrl(ledger: TravelLedger): {
  url: string;
  qrSupported: boolean;
} {
  const url = new URL(window.location.href);
  url.searchParams.set('trip', ledger.code);
  const encoded = toBase64Url(JSON.stringify(ledger));
  url.hash = `snapshot=${encoded}`;
  const fullUrl = url.toString();
  return {
    url: fullUrl,
    qrSupported: fullUrl.length <= 2400,
  };
}

export function extractStartupHashPayload(): {
  pairing?: { gistId: string; token: string };
  snapshot?: TravelLedger;
} {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#sync=') && !hash.startsWith('#snapshot=')) {
    return {};
  }

  // Strip sensitive/large hash immediately so it does not linger in URL bar
  try {
    const cleanUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', cleanUrl);
  } catch {
    // ignore
  }

  if (hash.startsWith('#sync=')) {
    const raw = hash.slice('#sync='.length);
    const sepIdx = raw.indexOf(':');
    if (sepIdx > 0) {
      const gistId = decodeURIComponent(raw.slice(0, sepIdx)).trim();
      const token = decodeURIComponent(raw.slice(sepIdx + 1)).trim();
      if (gistId && token) {
        return { pairing: { gistId, token } };
      }
    }
    return {};
  }

  if (hash.startsWith('#snapshot=')) {
    try {
      const encoded = hash.slice('#snapshot='.length);
      const parsed = JSON.parse(fromBase64Url(encoded));
      const clean = sanitizeImportedLedgerClient(parsed);
      if (clean) {
        return { snapshot: clean };
      }
    } catch {
      // ignore malformed snapshot
    }
  }
  return {};
}

export function buildLocalSyncBundle(): SyncBundle {
  const ledgers = getStaticLedgersMapRaw();
  const tombstones = loadStaticTombstones();
  let maxUpdatedAt = 0;
  for (const l of Object.values(ledgers)) {
    if (l.updatedAt > maxUpdatedAt) maxUpdatedAt = l.updatedAt;
  }
  return {
    format: 'trip-ledger-sync-bundle',
    version: 1,
    updatedAt: maxUpdatedAt || Date.now(),
    ledgers,
    deletedLedgers: tombstones.deletedLedgers,
    deletedExpenses: tombstones.deletedExpenses,
  };
}

export function mergeSyncBundles(local: SyncBundle, remote: SyncBundle | null): {
  merged: SyncBundle;
  remoteNeedsPush: boolean;
} {
  if (!remote) {
    return { merged: local, remoteNeedsPush: true };
  }

  const deletedLedgers: Record<string, number> = { ...remote.deletedLedgers };
  for (const [code, ts] of Object.entries(local.deletedLedgers)) {
    deletedLedgers[code] = Math.max(deletedLedgers[code] || 0, ts);
  }

  const deletedExpenses: Record<string, number> = { ...remote.deletedExpenses };
  for (const [key, ts] of Object.entries(local.deletedExpenses)) {
    deletedExpenses[key] = Math.max(deletedExpenses[key] || 0, ts);
  }

  const allCodes = new Set([
    ...Object.keys(local.ledgers),
    ...Object.keys(remote.ledgers),
  ]);

  const mergedLedgers: Record<string, TravelLedger> = {};

  for (const code of allCodes) {
    const l = local.ledgers[code];
    const r = remote.ledgers[code];
    const delTs = deletedLedgers[code] || 0;

    const lActive = l && l.updatedAt > delTs ? l : undefined;
    const rActive = r && r.updatedAt > delTs ? r : undefined;

    if (!lActive && !rActive) continue;

    const pickExpenses = (baseA?: TravelLedger, baseB?: TravelLedger): ExpenseRecord[] => {
      const expMap = new Map<string, ExpenseRecord>();
      for (const exp of baseA?.expenses || []) {
        const expDelTs = deletedExpenses[`${code}:${exp.id}`] || 0;
        if (exp.updatedAt > expDelTs) expMap.set(exp.id, exp);
      }
      for (const exp of baseB?.expenses || []) {
        const expDelTs = deletedExpenses[`${code}:${exp.id}`] || 0;
        if (exp.updatedAt <= expDelTs) continue;
        const existing = expMap.get(exp.id);
        if (!existing || exp.updatedAt > existing.updatedAt) {
          expMap.set(exp.id, exp);
        }
      }
      return Array.from(expMap.values()).sort((a, b) => b.createdAt - a.createdAt);
    };

    if (lActive && !rActive) {
      mergedLedgers[code] = {
        ...lActive,
        expenses: pickExpenses(lActive),
      };
    } else if (!lActive && rActive) {
      mergedLedgers[code] = {
        ...rActive,
        expenses: pickExpenses(rActive),
      };
    } else if (lActive && rActive) {
      const newer = lActive.updatedAt >= rActive.updatedAt ? lActive : rActive;
      const mergedExpenses = pickExpenses(lActive, rActive);
      const maxExpTs = mergedExpenses.reduce((m, e) => Math.max(m, e.updatedAt), 0);
      mergedLedgers[code] = {
        code,
        version: Math.max(lActive.version, rActive.version),
        updatedAt: Math.max(lActive.updatedAt, rActive.updatedAt, maxExpTs),
        settings: newer.settings,
        budgets: newer.budgets,
        expenses: mergedExpenses,
      };
    }
  }

  // Fallback safeguard: never wipe all ledgers
  if (Object.keys(mergedLedgers).length === 0) {
    const fallbackEntries = Object.entries(local.ledgers);
    if (fallbackEntries.length > 0) {
      mergedLedgers[fallbackEntries[0][0]] = fallbackEntries[0][1];
    }
  }

  const maxLedgerTs = Object.values(mergedLedgers).reduce(
    (m, l) => Math.max(m, l.updatedAt),
    0
  );

  const merged: SyncBundle = {
    format: 'trip-ledger-sync-bundle',
    version: 1,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt, maxLedgerTs),
    ledgers: mergedLedgers,
    deletedLedgers,
    deletedExpenses,
  };

  const remoteJson = JSON.stringify({
    ledgers: remote.ledgers,
    deletedLedgers: remote.deletedLedgers,
    deletedExpenses: remote.deletedExpenses,
  });
  const mergedJson = JSON.stringify({
    ledgers: merged.ledgers,
    deletedLedgers: merged.deletedLedgers,
    deletedExpenses: merged.deletedExpenses,
  });

  return {
    merged,
    remoteNeedsPush: remoteJson !== mergedJson,
  };
}

async function fetchGistJson(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export async function createPrivateSyncGist(token: string): Promise<CloudSyncConfig> {
  const cleanedToken = token.trim();
  if (!cleanedToken) {
    throw new Error('請輸入 GitHub Personal Access Token（需勾選 gist 權限）');
  }
  const bundle = buildLocalSyncBundle();
  const resp = await fetchGistJson('https://api.github.com/gists', cleanedToken, {
    method: 'POST',
    body: JSON.stringify({
      description: 'TripLedger 旅費帳本跨裝置同步資料（私人）',
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(bundle, null, 2),
        },
      },
    }),
  });
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('GitHub Token 無效或缺少 gist 權限，請確認 Token 是否勾選 gist');
    }
    throw new Error(`建立私人同步空間失敗 (HTTP ${resp.status})`);
  }
  const data = (await resp.json()) as { id?: string };
  if (!data.id) {
    throw new Error('未能取得 GitHub Gist 同步代碼');
  }
  const config: CloudSyncConfig = {
    gistId: data.id,
    token: cleanedToken,
    lastSyncedAt: Date.now(),
  };
  saveCloudSyncConfig(config);
  return config;
}

export async function syncWithCloudGist(
  config: CloudSyncConfig
): Promise<{
  merged: SyncBundle;
  pushed: boolean;
  syncedAt: number;
}> {
  const resp = await fetchGistJson(
    `https://api.github.com/gists/${encodeURIComponent(config.gistId)}`,
    config.token
  );
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('GitHub Token 授權無效或已過期');
    }
    if (resp.status === 404) {
      throw new Error('找不到此同步空間代碼 (Gist ID)');
    }
    throw new Error(`讀取雲端同步資料失敗 (HTTP ${resp.status})`);
  }

  const gistData = (await resp.json()) as {
    files?: Record<string, { content?: string; truncated?: boolean; raw_url?: string }>;
  };
  const fileEntry = gistData.files?.[GIST_FILENAME];
  let remoteContent = fileEntry?.content || '';
  if (fileEntry?.truncated && fileEntry.raw_url) {
    const rawResp = await fetch(fileEntry.raw_url, { cache: 'no-store' });
    if (rawResp.ok) remoteContent = await rawResp.text();
  }

  let remoteBundle: SyncBundle | null = null;
  if (remoteContent.trim()) {
    try {
      const parsed = JSON.parse(remoteContent) as Partial<SyncBundle>;
      if (parsed && parsed.ledgers && typeof parsed.ledgers === 'object') {
        const cleanMap: Record<string, TravelLedger> = {};
        for (const [k, v] of Object.entries(parsed.ledgers)) {
          const clean = sanitizeImportedLedgerClient(v, k);
          if (clean) cleanMap[clean.code] = clean;
        }
        remoteBundle = {
          format: 'trip-ledger-sync-bundle',
          version: 1,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
          ledgers: cleanMap,
          deletedLedgers:
            parsed.deletedLedgers && typeof parsed.deletedLedgers === 'object'
              ? parsed.deletedLedgers
              : {},
          deletedExpenses:
            parsed.deletedExpenses && typeof parsed.deletedExpenses === 'object'
              ? parsed.deletedExpenses
              : {},
        };
      }
    } catch {
      remoteBundle = null;
    }
  }

  const localBundle = buildLocalSyncBundle();
  const { merged, remoteNeedsPush } = mergeSyncBundles(localBundle, remoteBundle);

  const nextTombstones: StaticTombstones = {
    deletedLedgers: merged.deletedLedgers,
    deletedExpenses: merged.deletedExpenses,
  };
  replaceStaticSyncState(merged.ledgers, nextTombstones);

  if (remoteNeedsPush) {
    const patchResp = await fetchGistJson(
      `https://api.github.com/gists/${encodeURIComponent(config.gistId)}`,
      config.token,
      {
        method: 'PATCH',
        body: JSON.stringify({
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(merged, null, 2),
            },
          },
        }),
      }
    );
    if (!patchResp.ok) {
      throw new Error(`推送變更至雲端同步空間失敗 (HTTP ${patchResp.status})`);
    }
  }

  const syncedAt = Date.now();
  saveCloudSyncConfig({ ...config, lastSyncedAt: syncedAt });

  return {
    merged,
    pushed: remoteNeedsPush,
    syncedAt,
  };
}
