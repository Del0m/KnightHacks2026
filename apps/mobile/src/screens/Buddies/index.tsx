import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { GlassChoice } from '@/components/GlassChoice';
import { PolishedPressable } from '@/components/PolishedPressable';
import { useAuth } from '@/screens/Auth/session';
import { pageColors, typography } from '@/theme/tokens';
import { buddyAction, loadBuddies, saveMatchingPreferences, type BuddyData, type MatchingPreferences } from './api';
const c = pageColors('Buddies'), ui = pageStyles('Buddies');
const sections = ['Suggestions', 'Incoming', 'Outgoing', 'Buddies'] as const;
type Section = typeof sections[number];
const days = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;
const parts = [['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening']] as const;
function message(error: unknown) { return error instanceof Error ? error.message : 'Could not load buddies. Try again.'; }
export default function BuddiesScreen() {
 const auth = useAuth();
 return <BuddyAccountScreen key={auth.user?.id ?? 'signed-out'} auth={auth} />;
}
function BuddyAccountScreen({ auth }: { auth: ReturnType<typeof useAuth> }) {
 const account = auth.user?.id ?? null;
 const request = useRef(auth.apiFetch);
 useLayoutEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
 const activeAccount = useRef(account);
 const controller = useRef(new AbortController()), sequence = useRef(0), pending = useRef(false);
 const [data, setData] = useState<BuddyData | null>(null), [owner, setOwner] = useState(account);
 const [section, setSection] = useState<Section>('Suggestions'), [busy, setBusy] = useState(false), [mutation, setMutation] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
 const [editing, setEditing] = useState(false), [draft, setDraft] = useState<MatchingPreferences>({ gym_name: null, gym_place_id: null, schedule: [] });
 const current = owner === account ? data : null;
 const load = useCallback(async () => {
  if (!account) return;
  const generation = ++sequence.current, signal = controller.current.signal;
  setBusy(true); setError(null);
  try {
   const next = await loadBuddies(request.current, signal);
   if (!signal.aborted && generation === sequence.current && activeAccount.current === account) { setData(next); setOwner(account); }
  } catch (e) { if (!signal.aborted && generation === sequence.current && activeAccount.current === account) setError(message(e)); }
  finally { if (!signal.aborted && generation === sequence.current && activeAccount.current === account) setBusy(false); }
 }, [account]);
 useFocusEffect(useCallback(() => {
  controller.current = new AbortController(); pending.current = false; setMutation(null); void load();
  return () => { controller.current.abort(); ++sequence.current; };
 }, [load]));
 async function mutate(id: string, action: 'request' | 'accept' | 'decline', name: string) {
  if (pending.current || !account) return;
  pending.current = true; setMutation(id); setError(null);
  const signal = controller.current.signal;
  try {
   await buddyAction(request.current, id, action, signal);
   if (signal.aborted || activeAccount.current !== account) return;
   setData(previous => previous && ({ ...previous, suggestions: previous.suggestions.filter(s => s.user.id !== id), matches: action === 'request'
    ? [...previous.matches.filter(m => m.user_id !== id), { user_id: id, handle: name, status: 'requested', direction: 'outgoing', reasons: previous.suggestions.find(s => s.user.id === id)?.reasons ?? [] }]
    : action === 'accept' ? previous.matches.map(m => m.user_id === id ? { ...m, status: 'accepted' } : m) : previous.matches.filter(m => m.user_id !== id) }));
   await load();
  } catch (e) { if (!signal.aborted && activeAccount.current === account) { setError(message(e)); } }
  finally { if (!signal.aborted && activeAccount.current === account) { pending.current = false; setMutation(null); } }
 }
 async function savePreferences() {
  if (pending.current || !account) return;
  pending.current = true; setMutation('preferences'); setError(null);
  const signal = controller.current.signal;
  try {
   const saved = await saveMatchingPreferences(request.current, draft, signal);
   if (signal.aborted || activeAccount.current !== account) return;
   setData(previous => previous && ({ ...previous, preferences: saved })); setEditing(false); await load();
  } catch (e) { if (!signal.aborted && activeAccount.current === account) setError(message(e)); }
  finally { if (!signal.aborted && activeAccount.current === account) { pending.current = false; setMutation(null); } }
 }
 if (!account) return <AppPage title="Buddies" intro="Gym buddies"><Text style={ui.muted}>Log in to find training partners.</Text><Action onPress={() => router.push('/login')}>Log in</Action></AppPage>;
 const matches = current?.matches.filter(m => section === 'Buddies' ? m.status === 'accepted' : m.status === 'requested' && m.direction === section.toLowerCase()) ?? [];
 return <AppPage title="Buddies" intro="Gym buddies" headerAction={<PolishedPressable accessibilityRole="button" accessibilityLabel="Refresh buddies" disabled={busy || !!mutation} onPress={() => void load()} style={s.refresh}><GlassSurface radius={23} /><Text style={[ui.text, { fontSize: 24 }]}>↻</Text></PolishedPressable>}>
  <View style={s.gym}><GlassSurface colored tint={c.primarySoft} radius={24} /><View style={{ flex: 1, gap: 4 }}><Text style={ui.label}>Your gym</Text><Text style={ui.text}>{current?.preferences.gym_name || 'Add your gym'}</Text></View><PolishedPressable accessibilityRole="button" accessibilityLabel="Edit matching preferences" disabled={!current || !!mutation} onPress={() => { setDraft(current!.preferences); setEditing(v => !v); }} style={s.smallButton}><Text style={[ui.label, { color: c.text }]}>{editing ? 'Close' : 'Edit'}</Text></PolishedPressable></View>
  {editing && <View style={s.preferences}><GlassSurface radius={24} /><Text style={ui.heading}>Matching preferences</Text><Text style={ui.label}>Gym name</Text><TextInput accessibilityLabel="Gym name" value={draft.gym_name ?? ''} maxLength={120} editable={!mutation} onChangeText={gym_name => setDraft(d => ({ ...d, gym_name }))} style={ui.input} placeholder="Campus Gym" placeholderTextColor={c.muted} />
   <Text style={ui.label}>Shared gym ID</Text><TextInput accessibilityLabel="Shared gym ID" value={draft.gym_place_id ?? ''} maxLength={200} autoCapitalize="none" autoCorrect={false} editable={!mutation} onChangeText={gym_place_id => setDraft(d => ({ ...d, gym_place_id }))} style={ui.input} placeholder="Your gym’s Google place ID" placeholderTextColor={c.muted} /><Text style={ui.muted}>Use the same gym ID as your training partners. Your home address isn’t needed.</Text>
   <Text style={ui.heading}>When you train</Text>{days.map(([day, label]) => <View key={day} style={{ gap: 8 }}><Text style={ui.label}>{label}</Text><View style={s.choices}>{parts.map(([part, title]) => { const slot = `${day}_${part}`; return <GlassChoice key={slot} label={`${label} ${title}`} selected={draft.schedule.includes(slot)} disabled={!!mutation} compact onPress={() => setDraft(d => ({ ...d, schedule: d.schedule.includes(slot) ? d.schedule.filter(s => s !== slot) : [...d.schedule, slot] }))} />; })}</View></View>)}
   <Action disabled={!!mutation} onPress={() => void savePreferences()}>{mutation === 'preferences' ? 'Saving…' : 'Save preferences'}</Action>
  </View>}
  <View accessibilityRole="tablist" style={s.choices}>{sections.map(value => <GlassChoice key={value} label={value} compact selected={section === value} onPress={() => setSection(value)} />)}</View>
  {busy && <ActivityIndicator accessibilityLabel="Loading buddies" color={c.primary} />}
  {error && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={ui.muted}>{error}</Text><Action secondary disabled={busy || !!mutation} onPress={() => void load()}>Try again</Action></View>}
  {section === 'Suggestions' ? current?.suggestions.map(item => { const name = item.user.display_name || item.user.handle; return <View key={item.user.id} style={s.card}><GlassSurface radius={26} colored tint={c.primarySoft} /><Text style={ui.rowTitle}>{name}</Text><Text style={ui.muted}>@{item.user.handle}{item.user.gym_name ? ` · ${item.user.gym_name}` : ''}</Text><Text style={ui.label}>Why you match</Text>{item.reasons.map((reason, i) => <Text key={i} style={ui.text}>{reason}</Text>)}<PolishedPressable accessibilityRole="button" accessibilityLabel={`Request ${name}`} disabled={!!mutation} onPress={() => void mutate(item.user.id, 'request', name)} style={s.request}><GlassSurface radius={18} colored tint="#C9EDDE" /><Text style={s.requestText}>{mutation === item.user.id ? 'Sending…' : 'Request buddy'}</Text></PolishedPressable></View>; }) : matches.map(item => <View key={item.user_id} style={s.card}><GlassSurface radius={26} colored tint={c.primarySoft} /><Text style={ui.rowTitle}>{item.handle}</Text>{item.reasons.map((reason, i) => <Text key={i} style={ui.muted}>{reason}</Text>)}{section === 'Incoming' ? <View style={s.choices}>{(['accept', 'decline'] as const).map(action => <PolishedPressable key={action} accessibilityRole="button" accessibilityLabel={`${action === 'accept' ? 'Accept' : 'Decline'} ${item.handle}`} disabled={!!mutation} onPress={() => void mutate(item.user_id, action, item.handle)} style={[s.smallButton, { flex: 1 }]}><GlassSurface radius={18} colored tint={action === 'accept' ? '#C9EDDE' : '#EFF1F5'} /><Text style={ui.text}>{mutation === item.user_id ? 'Updating…' : action === 'accept' ? 'Accept' : 'Decline'}</Text></PolishedPressable>)}</View> : <Text style={ui.label}>{section === 'Outgoing' ? 'Request sent' : 'Training partners'}</Text>}</View>)}
  {current && !busy && (section === 'Suggestions' ? current.suggestions.length === 0 : matches.length === 0) && <View style={ui.empty}><Text style={ui.emptyTitle}>{section === 'Suggestions' ? 'No suggestions yet' : section === 'Incoming' ? 'No incoming requests' : section === 'Outgoing' ? 'No outgoing requests' : 'No buddies yet'}</Text>{section === 'Suggestions' && current.hint && <Text style={ui.muted}>{current.hint}</Text>}</View>}
 </AppPage>;
}
const s = StyleSheet.create({
 refresh: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
 gym: { padding: 18, borderRadius: 24, flexDirection: 'row', gap: 12, alignItems: 'center' },
 preferences: { padding: 18, borderRadius: 24, gap: 12 }, choices: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
 card: { padding: 20, borderRadius: 26, gap: 10 }, smallButton: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
 request: { minHeight: 48, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, requestText: { color: '#165737', fontFamily: typography.strong, fontSize: 17 },
});
