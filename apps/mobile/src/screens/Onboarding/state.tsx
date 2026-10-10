import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/screens/Auth/session';
import { createDraft, draftFromProfile, type Draft, type OnboardingProfile } from './model';
import { loadProfile, saveOnboarding } from './api';

type Status = 'guest' | 'loading' | 'incomplete' | 'complete' | 'error';
type Value = { draft: Draft; setDraft: (draft: Draft) => void; status: Status; error: string | null; busy: boolean; step: number; setStep: (step: number) => void; reload: () => Promise<void>; save: (skipInjury?: boolean) => Promise<boolean>; profile: OnboardingProfile | null };
const Onboarding = createContext<Value | null>(null);

/** Root keys this provider by account ID. Drafts stay in memory and never cross accounts. */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [draft, setDraft] = useState(createDraft), [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>(auth.user ? 'loading' : 'guest');
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const mounted = useRef(true), saving = useRef(false), sequence = useRef(0), touched = useRef(false);
  async function fetchProfile() {
    if (!auth.user || saving.current) return;
    const version = ++sequence.current;
    return loadProfile(auth.apiFetch).then(saved => {
      if (!mounted.current || version !== sequence.current) return;
      setProfile(saved); setStatus(saved?.onboarding_completed ? 'complete' : 'incomplete');
      if (saved && !touched.current) setDraft(draftFromProfile(saved));
    }).catch(failure => {
      if (mounted.current && version === sequence.current) { setStatus('error'); setError(failure instanceof Error ? failure.message : 'Could not load your profile.'); }
    });
  }
  async function reload() { setStatus('loading'); setError(null); await fetchProfile(); }
  const initialLoad = useEffectEvent(() => { void fetchProfile(); });
  useEffect(() => { mounted.current = true; initialLoad(); return () => { mounted.current = false; }; }, []);
  async function save(skipInjury = false) {
    if (saving.current) return false;
    if (!auth.user) { setError('Log in to save your setup. Your answers will stay here while you train.'); return false; }
    saving.current = true; ++sequence.current; setBusy(true); setError(null);
    const submitted = skipInjury ? { ...draft, injury: '' } : draft;
    try {
      const saved = await saveOnboarding(auth.apiFetch, submitted);
      if (mounted.current) { setProfile(saved); setDraft(submitted); setStatus('complete'); }
      return mounted.current;
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not save. Please try again.'); return false; }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return <Onboarding.Provider value={{ draft, setDraft: value => { if (saving.current) return; touched.current = true; setDraft(value); setError(null); }, status, error, busy, step, setStep, reload, save, profile }}>{children}</Onboarding.Provider>;
}
export function useOnboarding() {
  const value = useContext(Onboarding);
  if (!value) throw new Error('OnboardingProvider missing');
  return value;
}
