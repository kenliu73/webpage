import React, { useEffect, useState } from 'react';
import {
  X,
  ScanFace,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Lock,
  ExternalLink,
  AlertCircle,
  Check,
} from 'lucide-react';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
} from '@simplewebauthn/browser';
import type { AuthStatusPayload } from '../types';
import {
  authFetch,
  detectDefaultDeviceLabel,
  setStoredAuthToken,
} from '../utils/authClient';
import {
  staticDeletePasskey,
  staticSavePasskey,
  staticSetupPin,
  staticToggleAuth,
} from '../utils/staticFallbackStore';

interface AuthSettingsModalProps {
  isOpen: boolean;
  authStatus: AuthStatusPayload;
  staticMode?: boolean;
  onClose: () => void;
  onStatusChange: (nextStatus: AuthStatusPayload) => void;
  onLockNow: () => Promise<void>;
}

function randomChallengeBase64Url(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const AuthSettingsModal: React.FC<AuthSettingsModalProps> = ({
  isOpen,
  authStatus,
  staticMode = false,
  onClose,
  onStatusChange,
  onLockNow,
}) => {
  const [deviceName, setDeviceName] = useState(detectDefaultDeviceLabel);
  const [preferPlatform, setPreferPlatform] = useState(true);
  const [pinInput, setPinInput] = useState('');
  const [registering, setRegistering] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [iframeHint, setIframeHint] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState(true);
  const [platformReady, setPlatformReady] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setSuccessMsg('');
    setIframeHint(false);
    setDeviceName(detectDefaultDeviceLabel());

    const supported = browserSupportsWebAuthn();
    setWebAuthnSupported(supported);
    if (supported) {
      platformAuthenticatorIsAvailable()
        .then((avail) => {
          setPlatformReady(avail);
          setPreferPlatform(avail);
        })
        .catch(() => {
          setPlatformReady(false);
          setPreferPlatform(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const showSuccess = (text: string) => {
    setSuccessMsg(text);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleRegisterFaceId = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setIframeHint(false);
    setRegistering(true);
    try {
      if (staticMode) {
        const host = window.location.hostname;
        const attestation = await startRegistration({
          optionsJSON: {
            challenge: randomChallengeBase64Url(),
            rp: { name: '旅費帳本 TripLedger', id: host },
            user: {
              id: randomChallengeBase64Url(),
              name: '旅費帳本持有者',
              displayName: '旅費帳本持有者',
            },
            pubKeyCredParams: [
              { alg: -7, type: 'public-key' },
              { alg: -257, type: 'public-key' },
            ],
            authenticatorSelection: {
              ...(preferPlatform ? { authenticatorAttachment: 'platform' } : {}),
              residentKey: 'preferred',
              userVerification: 'required',
            },
            timeout: 60000,
          },
        });
        const nextStatus = staticSavePasskey(
          {
            id: attestation.id,
            name: deviceName.trim() || detectDefaultDeviceLabel(),
            deviceType: 'singleDevice',
            rpID: host,
            createdAt: Date.now(),
          },
          true
        );
        onStatusChange(nextStatus);
        showSuccess('已完成生物辨識金鑰註冊，並開啟帳本驗證保護');
        return;
      }

      const optResp = await authFetch('/api/auth/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferPlatform }),
      });
      const optData = (await optResp.json()) as {
        options?: Parameters<typeof startRegistration>[0]['optionsJSON'];
        challengeId?: string;
        error?: string;
      };
      if (!optResp.ok || !optData.options || !optData.challengeId) {
        throw new Error(optData.error || '無法啟動裝置生物辨識註冊');
      }

      const attestation = await startRegistration({ optionsJSON: optData.options });

      const verifyResp = await authFetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: optData.challengeId,
          deviceName: deviceName.trim() || detectDefaultDeviceLabel(),
          enableLock: true,
          response: attestation,
        }),
      });
      const verifyData = (await verifyResp.json()) as {
        verified?: boolean;
        token?: string;
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!verifyResp.ok || !verifyData.verified || !verifyData.status) {
        throw new Error(verifyData.error || '裝置註冊驗證失敗');
      }

      if (verifyData.token) {
        setStoredAuthToken(verifyData.token);
      }
      onStatusChange(verifyData.status);
      showSuccess('已完成生物辨識金鑰註冊，並開啟帳本驗證保護');
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const msg = err instanceof Error ? err.message : '生物辨識註冊失敗或已取消';
      if (
        name === 'SecurityError' ||
        (name === 'NotAllowedError' && msg.toLowerCase().includes('feature is not enabled')) ||
        msg.toLowerCase().includes('publickey-credentials')
      ) {
        setIframeHint(true);
        setErrorMsg(
          '目前嵌入預覽視窗（iframe）限制了系統 Face ID 註冊權限。請先於下方連結「在獨立分頁開啟」並於 iPhone Safari 進行 Face ID 註冊，或先設定備援密碼。'
        );
      } else if (name === 'NotAllowedError') {
        setErrorMsg('已取消此次人臉 / 生物辨識註冊。');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pinInput.trim();
    if (!/^\d{4,8}$/.test(cleaned)) {
      setErrorMsg('備援解鎖密碼請輸入 4 至 8 位數字');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setSavingPin(true);
    try {
      if (staticMode) {
        const nextStatus = await staticSetupPin(cleaned);
        setPinInput('');
        onStatusChange(nextStatus);
        showSuccess('已儲存備援解鎖密碼');
        return;
      }

      const resp = await authFetch('/api/auth/setup-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleaned, enable: !authStatus.enabled ? false : true }),
      });
      const data = (await resp.json()) as {
        token?: string;
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!resp.ok || !data.status) {
        throw new Error(data.error || '儲存備援密碼失敗');
      }
      if (data.token) {
        setStoredAuthToken(data.token);
      }
      setPinInput('');
      onStatusChange(data.status);
      showSuccess('已儲存備援解鎖密碼');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '設定備援密碼失敗');
    } finally {
      setSavingPin(false);
    }
  };

  const handleToggleProtection = async () => {
    const nextEnabled = !authStatus.enabled;
    setErrorMsg('');
    setSuccessMsg('');
    setToggling(true);
    try {
      if (staticMode) {
        if (nextEnabled && !authStatus.hasPin && authStatus.passkeys.length === 0) {
          throw new Error('請先註冊至少一組人臉辨識金鑰或設定備援密碼');
        }
        const nextStatus = staticToggleAuth(nextEnabled);
        onStatusChange(nextStatus);
        showSuccess(nextEnabled ? '已開啟帳本驗證保護' : '已關閉帳本驗證保護');
        return;
      }

      const resp = await authFetch('/api/auth/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = (await resp.json()) as {
        token?: string | null;
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!resp.ok || !data.status) {
        throw new Error(data.error || '切換保護狀態失敗');
      }
      if (data.token) {
        setStoredAuthToken(data.token);
      }
      onStatusChange(data.status);
      showSuccess(nextEnabled ? '已開啟帳本驗證保護' : '已關閉帳本驗證保護');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '操作失敗');
    } finally {
      setToggling(false);
    }
  };

  const handleRemovePasskey = async (id: string) => {
    setErrorMsg('');
    setDeletingId(id);
    try {
      if (staticMode) {
        if (authStatus.enabled && authStatus.passkeys.length <= 1 && !authStatus.hasPin) {
          throw new Error('保護開啟中且無備援密碼，無法移除最後一組金鑰');
        }
        const nextStatus = staticDeletePasskey(id);
        onStatusChange(nextStatus);
        showSuccess('已移除該裝置的生物辨識金鑰');
        return;
      }

      const resp = await authFetch(`/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = (await resp.json()) as {
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!resp.ok || !data.status) {
        throw new Error(data.error || '移除生物辨識金鑰失敗');
      }
      onStatusChange(data.status);
      showSuccess('已移除該裝置的生物辨識金鑰');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '移除失敗');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2
              id="auth-modal-title"
              className="text-lg font-bold text-slate-950 dark:text-white flex items-center gap-2"
            >
              <ScanFace className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>人臉辨識與驗證保護設定</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              支援 iPhone Face ID、Mac Touch ID 與備援密碼驗證，保護您的跨裝置旅遊帳本。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="control-green h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Summary (Yellow Read-Only) */}
        <div className="display-yellow rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium opacity-80">目前帳本驗證保護狀態</div>
            <div className="text-sm font-bold mt-0.5 flex items-center gap-1.5">
              {authStatus.enabled ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                  <span>已啟用驗證鎖定保護</span>
                </>
              ) : (
                <>
                  <ShieldOff className="w-4 h-4 opacity-70" />
                  <span>尚未啟用保護（開啟網址即可直接檢視）</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {authStatus.enabled && (
              <button
                type="button"
                onClick={async () => {
                  await onLockNow();
                  onClose();
                }}
                className="control-green h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>立即鎖定</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleProtection}
              disabled={
                toggling || (!authStatus.enabled && !authStatus.hasPin && authStatus.passkeys.length === 0)
              }
              className={`h-9 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap disabled:opacity-45 ${
                authStatus.enabled ? 'control-green' : 'control-green-active'
              }`}
            >
              {toggling
                ? '處理中...'
                : authStatus.enabled
                  ? '關閉保護鎖定'
                  : '啟用保護鎖定'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p>{errorMsg}</p>
              {iframeHint && typeof window !== 'undefined' && (
                <a
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline text-emerald-700 dark:text-emerald-300"
                >
                  <span>在瀏覽器獨立分頁開啟此網址</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-center gap-2 font-semibold">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Section 1: Register iPhone Face ID / WebAuthn Biometric Passkey */}
        <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-white">
              1. 註冊 iPhone 人臉辨識 / 裝置生物辨識
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              於 iPhone Safari 開啟本頁面並點擊註冊，即可直接喚起 Face ID 建立專屬生物辨識通行金鑰。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-center">
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="裝置名稱（例如：我的 iPhone Face ID）"
              maxLength={40}
              className="input-green w-full h-11 px-3 rounded-xl text-sm"
            />
            <button
              type="button"
              onClick={handleRegisterFaceId}
              disabled={registering || !webAuthnSupported}
              className="control-green-active h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-45"
            >
              <ScanFace className="w-4 h-4" />
              <span>{registering ? '等待裝置驗證...' : '註冊此裝置 Face ID'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setPreferPlatform(true)}
              className={`h-8 px-3 rounded-lg font-semibold ${
                preferPlatform ? 'control-green-active' : 'control-green'
              }`}
            >
              本機 Face ID / Touch ID
            </button>
            <button
              type="button"
              onClick={() => setPreferPlatform(false)}
              className={`h-8 px-3 rounded-lg font-semibold ${
                !preferPlatform ? 'control-green-active' : 'control-green'
              }`}
            >
              跨裝置金鑰（可用 iPhone 掃碼）
            </button>
            {!platformReady && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                目前環境未偵測到本機生物辨識感測器，建議選「跨裝置金鑰」或改用 iPhone 開啟。
              </span>
            )}
          </div>

          {/* Registered Passkeys List */}
          {authStatus.passkeys.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                已登錄的生物辨識裝置（{authStatus.passkeys.length}）
              </div>
              <div className="space-y-1.5">
                {authStatus.passkeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="display-yellow-soft rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold truncate">{pk.name}</div>
                      <div className="text-[11px] opacity-75 font-mono-num truncate">
                        網域 {pk.rpID} · 登錄於 {formatDate(pk.createdAt)}
                        {pk.lastUsedAt ? ` · 最近驗證 ${formatDate(pk.lastUsedAt)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePasskey(pk.id)}
                      disabled={deletingId === pk.id}
                      aria-label={`移除 ${pk.name}`}
                      className="control-green h-9 px-2.5 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>移除</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section 2: Backup PIN Setup */}
        <form
          onSubmit={handleSavePin}
          className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-4"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-950 dark:text-white flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>2. 備援解鎖密碼（建議設定）</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {authStatus.hasPin
                ? '已設定備援密碼；若需更換，請於下方輸入新的 4–8 位數字密碼。'
                : '設定 4–8 位數字備援密碼，方便在未支援生物辨識的桌機或預覽視窗中解鎖。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
              placeholder={authStatus.hasPin ? '輸入新 4–8 位數字密碼' : '設定 4–8 位數字備援密碼'}
              className="input-green flex-1 h-11 px-3 rounded-xl text-sm font-mono-num tracking-widest"
            />
            <button
              type="submit"
              disabled={savingPin || pinInput.length < 4}
              className="control-green-active h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 disabled:opacity-45"
            >
              {savingPin ? '儲存中...' : authStatus.hasPin ? '更新密碼' : '設定密碼'}
            </button>
          </div>
        </form>

        {/* Note on Google Account Auth */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          說明：Google 帳號登入驗證需啟用 Firebase / Google OAuth 專案授權（目前未啟用）；本帳本已透過裝置原生 WebAuthn（iPhone Face ID / Touch ID）與伺服器端加密簽章提供完整保護。
        </div>
      </div>
    </div>
  );
};
