const AUTH_TOKEN_KEY = 'triple_auth_token';

export function getStoredAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getStoredAuthToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}

export function getSseAuthUrl(basePath: string): string {
  const token = getStoredAuthToken();
  if (!token) return basePath;
  const sep = basePath.includes('?') ? '&' : '?';
  return `${basePath}${sep}token=${encodeURIComponent(token)}`;
}

export function detectDefaultDeviceLabel(): string {
  if (typeof navigator === 'undefined') return '我的裝置生物辨識';
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone Face ID';
  if (/iPad/i.test(ua)) return 'iPad Face ID / Touch ID';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac Touch ID';
  if (/Android/i.test(ua)) return 'Android 手機生物辨識';
  if (/Windows/i.test(ua)) return 'Windows Hello 生物辨識';
  return '我的裝置生物辨識';
}
