/** Attach a fresh JWT only to the configured API; callers pass relative paths. */
export function createAuthenticatedFetch(baseUrl: string, getToken: () => Promise<string | null>, onUnauthorized: () => void, send: typeof fetch = fetch) {
  return async (path: string, options: RequestInit = {}) => {
    if (!baseUrl) throw new Error('The API is not connected yet.');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || options.redirect && options.redirect !== 'error') throw new Error('Use an API-relative path without redirects.');
    const base = new URL(baseUrl.replace(/\/$/, '') + '/');
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('The API must use HTTPS.');
    const url = new URL(path.slice(1), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error('The request must stay inside the configured API.');
    const token = await getToken();
    if (!token) throw new Error('Please log in to continue.');
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await send(url.toString(), { ...options, headers, redirect: 'error', credentials: 'omit' });
    if (response.status === 401) { onUnauthorized(); throw new Error('Your session was rejected. Please log in again.'); }
    return response;
  };
}
