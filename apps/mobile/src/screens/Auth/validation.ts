export type AuthMode = 'login' | 'signup';
export type Credentials = { name: string; email: string; password: string };
export function validateCredentials(mode: AuthMode, fields: Credentials) {
  if (mode === 'signup' && !fields.name.trim()) return { field: 'name', message: 'Enter your name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) return { field: 'email', message: 'Enter a valid email address.' };
  if (!fields.password) return { field: 'password', message: 'Enter your password.' };
  if (mode === 'signup' && fields.password.length < 8) return { field: 'password', message: 'Use at least 8 characters.' };
  return null;
}
