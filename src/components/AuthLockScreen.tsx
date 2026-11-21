import React, { useEffect, useState } from 'react';
import {
  ScanFace,
  KeyRound,
  ShieldCheck,
  Sun,
  Moon,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
} from '@simplewebauthn/browser';
import type { AuthStatusPayload } from '../types';
import { authFetch, setStoredAuthToken } from '../utils/authClient';
import { staticSetSessionUnlocked, staticVerifyPin } from '../utils/staticFallbackStore';

interface AuthLockScreenProps {
  authStatus: AuthStatusPayload;
  staticMode?: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onUnlocked: (nextStatus: AuthStatusPayload) => void;
}

function randomBase64UrlChallenge(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const AuthLockScreen: React.FC<AuthLockScreenProps> = ({
  authStatus,
  staticMode = false,
  darkMode,
  onToggleDarkMode,
  onUnlocked,
}) => {
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [iframeHint, setIframeHint] = useState(false);
  const [webAuthnReady, setWebAuthnReady] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState(false);

  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
  const hasMatchingPasskey = authStatus.passkeys.some((p) => p.rpID === currentHost);

  useEffect(() => {
    const supported = browserSupportsWebAuthn();
    setWebAuthnReady(supported);
    if (supported) {
      platformAuthenticatorIsAvailable()
        .then((avail) => setPlatformAvailable(avail))
        .catch(() => setPlatformAvailable(false));
    }
    if (!hasMatchingPasskey) {
      setShowPinForm(true);
    }
  }, [hasMatchingPasskey]);

  const handleFaceIdUnlock = async () => {
    setErrorMsg('');
    setIframeHint(false);
    setBiometricLoading(true);
    try {
      if (staticMode) {
        const matching = authStatus.passkeys.filter((p) => p.rpID === currentHost);
        if (matching.length === 0) {
          throw new Error('目前網域尚無已註冊的生物辨識金鑰，請使用備援密碼解鎖。');
        }
        const assertion = await startAuthentication({
          optionsJSON: {
            challenge: randomBase64UrlChallenge(),
            rpId: currentHost,
            userVerification: 'required',
            allowCredentials: matching.map((c) => ({ id: c.id, type: 'public-key' })),
            timeout: 60000,
          },
        });
        if (!matching.some((c) => c.id === assertion.id)) {
          throw new Error('找不到對應的裝置生物辨識金鑰');
        }
        staticSetSessionUnlocked(true);
        onUnlocked({ ...authStatus, authenticated: true });
        return;
      }

      const optResp = await authFetch('/api/auth/webauthn/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const optData = (await optResp.json()) as {
        options?: Parameters<typeof startAuthentication>[0]['optionsJSON'];
        challengeId?: string;
        error?: string;
      };
      if (!optResp.ok || !optData.options || !optData.challengeId) {
        throw new Error(optData.error || '無法取得生物辨識驗證選項');
      }

      const assertion = await startAuthentication({ optionsJSON: optData.options });

      const verifyResp = await authFetch('/api/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: optData.challengeId,
          response: assertion,
        }),
      });
      const verifyData = (await verifyResp.json()) as {
        verified?: boolean;
        token?: string;
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!verifyResp.ok || !verifyData.verified || !verifyData.status) {
        throw new Error(verifyData.error || '人臉 / 生物辨識驗證失敗');
      }

      if (verifyData.token) {
        setStoredAuthToken(verifyData.token);
      }
      onUnlocked(verifyData.status);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const msg = err instanceof Error ? err.message : '生物辨識驗證取消或失敗';
      if (
        name === 'SecurityError' ||
        (name === 'NotAllowedError' && msg.toLowerCase().includes('feature is not enabled')) ||
        msg.toLowerCase().includes('publickey-credentials')
      ) {
        setIframeHint(true);
        setErrorMsg('目前嵌入預覽視窗限制了系統生物辨識權限，請改以獨立分頁開啟或使用備援密碼解鎖。');
        setShowPinForm(true);
      } else if (name === 'NotAllowedError') {
        setErrorMsg('已取消人臉 / 生物辨識驗證，請重試或改用備援密碼。');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setBiometricLoading(false);
    }
  };

  const handlePinUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pinInput.trim();
    if (!cleaned) return;
    setErrorMsg('');
    setPinLoading(true);
    try {
      if (staticMode) {
        const nextStatus = await staticVerifyPin(cleaned);
        if (!nextStatus) {
          throw new Error('備援解鎖密碼不正確');
        }
        setPinInput('');
        onUnlocked(nextStatus);
        return;
      }

      const resp = await authFetch('/api/auth/pin-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleaned }),
      });
      const data = (await resp.json()) as {
        token?: string;
        status?: AuthStatusPayload;
        error?: string;
      };
      if (!resp.ok || !data.status) {
        throw new Error(data.error || '密碼驗證失敗');
      }
      if (data.token) {
        setStoredAuthToken(data.token);
      }
      setPinInput('');
      onUnlocked(data.status);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '解鎖失敗');
    } finally {
      setPinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-6">
      {/* Minimal Top Bar */}
      <div className="max-w-md w-full mx-auto flex items-center justify-between pt-1">
        <span className="font-display text-lg font-bold tracking-tight">旅費帳本</span>
        <button
          type="button"
          onClick={onToggleDarkMode}
          className="control-green h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
        >
          {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          <span>{darkMode ? '切換日間模式' : '切換夜間模式'}</span>
        </button>
      </div>

      {/* Focused Verification Card */}
      <div className="max-w-md w-full mx-auto my-auto py-8">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="space-y-1.5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-950 dark:text-white pt-1">
              旅費帳本已鎖定保護
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              請使用 iPhone 人臉辨識（Face ID / 生物辨識通行金鑰）或備援解鎖密碼驗證身分後檢視與編輯帳本。
            </p>
          </div>

          {/* Read-only registered status summary (Yellow) */}
          <div className="display-yellow-soft rounded-xl px-3.5 py-2.5 text-xs flex items-center justify-between gap-2">
            <span>已登錄生物辨識裝置</span>
            <span className="font-mono-num font-bold">
              {authStatus.passkeys.length} 台
              {hasMatchingPasskey ? ' · 本網域可用' : ''}
            </span>
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
                    <span>改於瀏覽器獨立分頁開啟以使用 Face ID</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Primary Face ID / WebAuthn Trigger */}
          {webAuthnReady && hasMatchingPasskey && (
            <button
              type="button"
              onClick={handleFaceIdUnlock}
              disabled={biometricLoading}
              className="control-green-active w-full h-12 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <ScanFace className="w-5 h-5" />
              <span>
                {biometricLoading
                  ? '正在喚起人臉 / 生物辨識...'
                  : platformAvailable
                    ? '使用 iPhone Face ID / 生物辨識驗證'
                    : '使用生物辨識 / 裝置金鑰驗證'}
              </span>
            </button>
          )}

          {!hasMatchingPasskey && authStatus.passkeys.length > 0 && (
            <div className="display-yellow rounded-xl px-3.5 py-2.5 text-xs leading-relaxed">
              目前的生物辨識金鑰註冊於其他網址網域，請先使用備援密碼解鎖後，於「驗證保護」中將此裝置加入清單。
            </div>
          )}

          {/* Backup PIN Form */}
          {authStatus.hasPin && (
            <div className="space-y-3 pt-1">
              {!showPinForm ? (
                <button
                  type="button"
                  onClick={() => setShowPinForm(true)}
                  className="control-green w-full h-11 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>改用備援密碼解鎖</span>
                </button>
              ) : (
                <form onSubmit={handlePinUnlock} className="space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <label
                    htmlFor="unlock-pin-input"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    備援解鎖密碼（4–8 位數字）
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="unlock-pin-input"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="請輸入備援密碼"
                      className="input-green flex-1 h-11 px-3.5 rounded-xl text-sm font-mono-num tracking-widest"
                    />
                    <button
                      type="submit"
                      disabled={pinLoading || pinInput.length < 4}
                      className="control-green-active h-11 px-4 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0 disabled:opacity-45"
                    >
                      {pinLoading ? '驗證中...' : '解鎖'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-[11px] text-slate-500 dark:text-slate-500 pb-2">
        所有裝置生物辨識簽章皆於伺服器端以 WebAuthn 標準進行加密驗證
      </div>
    </div>
  );
};
