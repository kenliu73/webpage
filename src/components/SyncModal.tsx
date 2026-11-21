import React, { useMemo, useState } from 'react';
import {
  X,
  RefreshCw,
  Copy,
  Check,
  Smartphone,
  Cloud,
  CloudOff,
  Link2,
  AlertCircle,
  Unlink,
  QrCode,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { TravelLedger } from '../types';
import {
  buildGistPairingUrl,
  buildServerTripShareUrl,
  buildSnapshotShareUrl,
  createPrivateSyncGist,
  saveCloudSyncConfig,
  type CloudSyncConfig,
} from '../utils/cloudGistSync';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  staticMode: boolean;
  sseConnected: boolean;
  currentLedger: TravelLedger;
  tripCount: number;
  lastSyncedAt: number | null;
  syncing: boolean;
  cloudConfig: CloudSyncConfig | null;
  onCloudConfigChange: (next: CloudSyncConfig | null) => void;
  onSyncNow: () => Promise<void>;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  staticMode,
  sseConnected,
  currentLedger,
  tripCount,
  lastSyncedAt,
  syncing,
  cloudConfig,
  onCloudConfigChange,
  onSyncNow,
}) => {
  const [tokenInput, setTokenInput] = useState(cloudConfig?.token || '');
  const [gistIdInput, setGistIdInput] = useState(cloudConfig?.gistId || '');
  const [connecting, setConnecting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const serverShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return buildServerTripShareUrl(currentLedger.code);
  }, [currentLedger.code]);

  const pairingUrl = useMemo(() => {
    if (typeof window === 'undefined' || !cloudConfig) return '';
    return buildGistPairingUrl(cloudConfig, currentLedger.code);
  }, [cloudConfig, currentLedger.code]);

  const snapshotShare = useMemo(() => {
    if (typeof window === 'undefined') return { url: '', qrSupported: false };
    return buildSnapshotShareUrl(currentLedger);
  }, [currentLedger]);

  if (!isOpen) return null;

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setErrorMsg('無法自動複製，請長按網址手動選取複製');
    }
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return '尚未同步';
    return new Date(ts).toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleCreateSpace = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setConnecting(true);
    try {
      const cfg = await createPrivateSyncGist(tokenInput);
      setGistIdInput(cfg.gistId);
      onCloudConfigChange(cfg);
      setSuccessMsg('已建立私人同步空間！現在可用手機掃描下方 QR Code 立即配對同步。');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '建立同步空間失敗');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedToken = tokenInput.trim();
    const cleanedGist = gistIdInput.trim();
    if (!cleanedToken || !cleanedGist) {
      setErrorMsg('請填寫 GitHub Token 與同步空間代碼 (Gist ID)');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setConnecting(true);
    try {
      const nextCfg: CloudSyncConfig = { gistId: cleanedGist, token: cleanedToken };
      saveCloudSyncConfig(nextCfg);
      onCloudConfigChange(nextCfg);
      await onSyncNow();
      setSuccessMsg('已成功連線並同步雙裝置資料！');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '連線同步失敗');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectCloud = () => {
    saveCloudSyncConfig(null);
    onCloudConfigChange(null);
    setSuccessMsg('已中斷 GitHub 雲端同步（本機帳本資料仍完整保留）。');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-modal-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2
              id="sync-modal-title"
              className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2"
            >
              <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>手機與電腦跨裝置同步編輯</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              讓手機與電腦連線同一份旅行帳本，在兩種設備上隨時新增、修改與即時同步資料。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉同步視窗"
            className="control-green h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Summary Card (Yellow Read-Only) */}
        <div className="display-yellow rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-xs font-medium opacity-80">目前同步模式</div>
            <div className="text-sm font-bold flex items-center gap-1.5">
              {!staticMode ? (
                <>
                  <Cloud className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
                  <span>
                    {sseConnected
                      ? '即時伺服器雙向同步中（手機 ⇄ 電腦）'
                      : '伺服器同步模式（自動重連中）'}
                  </span>
                </>
              ) : cloudConfig ? (
                <>
                  <Cloud className="w-4 h-4 text-emerald-700 dark:text-emerald-300 shrink-0" />
                  <span>GitHub 私人雲端雙向同步中（手機 ⇄ 電腦）</span>
                </>
              ) : (
                <>
                  <CloudOff className="w-4 h-4 opacity-75 shrink-0" />
                  <span>靜態本機儲存模式（尚未開啟跨裝置同步）</span>
                </>
              )}
            </div>
            <div className="text-[11px] opacity-80 font-mono-num">
              帳本：{currentLedger.settings.tripName}（共 {tripCount} 本）· 最近同步：
              {formatTime(lastSyncedAt)}
            </div>
          </div>

          {(!staticMode || cloudConfig) && (
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncing}
              className="control-green-active h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? '同步中...' : '立即同步'}</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2 font-semibold">
            <Check className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Mode 1: Server Mode QR & Link Sharing */}
        {!staticMode && (
          <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
            <div>
              <h3 className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>掃碼在另一台裝置開啟並即時共同編輯</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                用手機相機掃描下方 QR Code（或複製連結傳給電腦/手機），兩台裝置會即時同步所有新增、修改與刪除紀錄。
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
              <div className="p-2.5 bg-white rounded-xl border border-slate-200 shrink-0">
                <QRCodeSVG value={serverShareUrl} size={136} level="M" />
              </div>
              <div className="space-y-2.5 min-w-0 flex-1 w-full">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  目前開啟帳本：{currentLedger.settings.tripName}
                </div>
                <div className="display-yellow-soft rounded-lg px-2.5 py-1.5 text-[11px] font-mono-num break-all">
                  {serverShareUrl}
                </div>
                <button
                  type="button"
                  onClick={() => copyText(serverShareUrl, 'server')}
                  className="control-green-active h-10 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 w-full sm:w-auto"
                >
                  {copiedKey === 'server' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>已複製同步連結</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>複製跨裝置同步連結</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mode 2: Static / GitHub Pages Cloud Gist Bidirectional Sync */}
        {staticMode && (
          <>
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>1. GitHub 私人雲端同步（手機與電腦自動雙向合併）</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  目前為靜態網頁模式（無後端伺服器）。填入一次含{' '}
                  <span className="font-mono-num font-semibold">gist</span> 權限的 GitHub Token
                  建立私人同步空間後，掃碼即可讓手機與電腦隨時雙向編輯、自動合併資料。
                </p>
              </div>

              {cloudConfig ? (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
                    <div className="p-2.5 bg-white rounded-xl border border-slate-200 shrink-0">
                      <QRCodeSVG value={pairingUrl} size={136} level="M" />
                    </div>
                    <div className="space-y-2 min-w-0 flex-1 w-full">
                      <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                        用另一台裝置（手機/電腦）掃碼即可自動完成配對
                      </div>
                      <div className="text-[11px] font-mono-num text-slate-600 dark:text-slate-300 break-all">
                        同步空間代碼：{cloudConfig.gistId}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyText(pairingUrl, 'pairing')}
                          className="control-green-active h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                        >
                          {copiedKey === 'pairing' ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>已複製配對連結</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>複製配對連結</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectCloud}
                          className="control-green h-9 px-3 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                          <span>中斷同步連線</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleConnectExisting} className="space-y-2.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      GitHub Personal Access Token（僅需勾選 gist 權限）
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="貼上 ghp_... 或 github_pat_... Token"
                      className="input-green w-full h-11 px-3 rounded-xl text-sm font-mono-num"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      現有同步空間代碼 Gist ID（首次使用請留空，直接點下方「建立新同步空間」）
                    </label>
                    <input
                      type="text"
                      value={gistIdInput}
                      onChange={(e) => setGistIdInput(e.target.value)}
                      placeholder="若已有另一台裝置建立的 Gist ID 可貼於此處"
                      className="input-green w-full h-11 px-3 rounded-xl text-sm font-mono-num"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCreateSpace}
                      disabled={connecting || !tokenInput.trim()}
                      className="control-green-active h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45"
                    >
                      <Cloud className="w-4 h-4" />
                      <span>{connecting ? '建立中...' : '建立新私人同步空間'}</span>
                    </button>
                    <button
                      type="submit"
                      disabled={connecting || !tokenInput.trim() || !gistIdInput.trim()}
                      className="control-green h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45"
                    >
                      <Link2 className="w-4 h-4" />
                      <span>連線現有同步空間</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Instant One-Way Snapshot Share (Zero Token Required) */}
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
                  <QrCode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>2. 免設定單次快速傳送目前帳本</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  不需任何帳號或 Token，將「{currentLedger.settings.tripName}」打包成一次性連結傳給另一台裝置即時匯入編輯。
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3.5">
                {snapshotShare.qrSupported ? (
                  <div className="p-2 bg-white rounded-xl border border-slate-200 shrink-0">
                    <QRCodeSVG value={snapshotShare.url} size={120} level="L" />
                  </div>
                ) : (
                  <div className="display-yellow-soft rounded-xl p-3 text-[11px] shrink-0 max-w-[140px] text-center">
                    帳本紀錄較多，請直接點右側按鈕複製連結傳送
                  </div>
                )}

                <div className="space-y-2 min-w-0 flex-1 w-full">
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    在另一台裝置開啟此連結後，會自動匯入並切換至「{currentLedger.settings.tripName}」。
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(snapshotShare.url, 'snapshot')}
                    className="control-green-active h-10 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 w-full sm:w-auto"
                  >
                    {copiedKey === 'snapshot' ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>已複製快照傳送連結</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>複製目前帳本傳送連結</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
