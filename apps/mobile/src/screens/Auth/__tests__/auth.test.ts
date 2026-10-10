import { validateCredentials } from '../validation';
import { createAuthenticatedFetch } from '../api';

describe('credentials', () => {
  it('validates signup without changing the password', () => {
    expect(validateCredentials('signup', { name: ' ', email: 'bad', password: '12345678' })).toMatchObject({ field: 'name' });
    expect(validateCredentials('signup', { name: 'Brayden', email: 'bad', password: '12345678' })).toMatchObject({ field: 'email' });
    expect(validateCredentials('signup', { name: 'Brayden', email: 'a@b.com', password: 'short' })).toMatchObject({ field: 'password' });
    expect(validateCredentials('login', { name: '', email: ' a@b.com ', password: ' x ' })).toBeNull();
  });
});

describe('authenticated API requests', () => {
  const getToken = jest.fn(async () => 'real-jwt'), expired = jest.fn();
  const send = jest.fn(async () => ({ status: 200, ok: true } as Response));
  beforeEach(() => { jest.clearAllMocks(); getToken.mockResolvedValue('real-jwt'); });
  const request = () => createAuthenticatedFetch('https://api.example.com/v1', getToken, expired, send as typeof fetch);
  it('sends the current token and preserves caller headers', async () => {
    await request()('/sessions', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer stale' } });
    const [url, options] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/sessions');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer real-jwt');
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
  });
  it('never sends a token to an external or traversed URL', async () => {
    for (const path of ['https://evil.example/a', '//evil.example/a', '/../escape', '/%2e%2e/escape']) {
      await expect(request()(path)).rejects.toThrow();
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('does not send requests when configuration or authentication is missing', async () => {
    await expect(createAuthenticatedFetch('', getToken, expired, send as typeof fetch)('/me')).rejects.toThrow();
    await expect(createAuthenticatedFetch('https://api.example.com', async () => null, expired, send as typeof fetch)('/me')).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('handles a rejected token once without retrying the request', async () => {
    send.mockResolvedValueOnce({ status: 401, ok: false } as Response);
    await expect(request()('/me')).rejects.toThrow('session');
    expect(expired).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('blocks a caller-controlled redirect from exposing the token', async () => {
    await expect(request()('/me', { redirect: 'follow' })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
