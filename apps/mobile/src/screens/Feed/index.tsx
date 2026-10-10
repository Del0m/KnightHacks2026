import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { PolishedPressable } from '@/components/PolishedPressable';
import { pageColors } from '@/theme/tokens';
import { useAuth } from '@/screens/Auth/session';
import { fetchFeed, isGoldWorkout, toggleKudos, type FeedPost } from './feedApi';
const c = pageColors('Feed'), ui = pageStyles('Feed');
export default function FeedScreen() {
 const { user } = useAuth();
 return user ? <FeedSession key={user.id} /> : null;
}
function FeedSession() {
 const auth = useAuth(), request = useRef(auth.apiFetch); useLayoutEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
 const [posts, setPosts] = useState<FeedPost[]>([]), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false), [hasMore, setHasMore] = useState(false);
 const cursor = useRef<string | null>(null), loading = useRef(false), controller = useRef<AbortController | null>(null), failedRefresh = useRef(false);
 const [pendingKudos, setPendingKudos] = useState<string[]>([]), kudosLocks = useRef(new Set<string>());
 const load = useCallback(async (refresh = false) => {
  if (loading.current || !controller.current || controller.current.signal.aborted || (!refresh && !cursor.current)) return;
  const signal = controller.current.signal;
  loading.current = true; failedRefresh.current = refresh; setBusy(true); setRefreshing(refresh); setError(null);
  try {
   const page = await fetchFeed(request.current, refresh ? undefined : cursor.current!, signal);
   if (signal.aborted) return;
   cursor.current = page.next_cursor; setHasMore(page.next_cursor !== null);
   setPosts(previous => { const next = refresh ? [] : previous; const ids = new Set(next.map(p => p.id)); return [...next, ...page.posts.filter(p => { if (ids.has(p.id)) return false; ids.add(p.id); return true; })]; });
   setReady(true);
  } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the feed.'); }
  finally { if (controller.current?.signal === signal && !signal.aborted) { loading.current = false; setBusy(false); setRefreshing(false); } }
 }, []);
 useFocusEffect(useCallback(() => {
  controller.current = new AbortController(); loading.current = false; setPendingKudos([...kudosLocks.current]);
  void load(true);
  return () => { controller.current?.abort(); };
 }, [load]));
 async function kudos(post: FeedPost) {
  if (kudosLocks.current.has(post.id) || !controller.current) return;
  const signal = controller.current.signal;
  kudosLocks.current.add(post.id); setPendingKudos([...kudosLocks.current]);
  try {
   await toggleKudos(request.current, post.id, post.viewer_gave_kudos);
   if (!signal.aborted) setPosts(rows => rows.map(p => p.id === post.id ? { ...p, viewer_gave_kudos: !post.viewer_gave_kudos, kudos_count: Math.max(0, p.kudos_count + (p.viewer_gave_kudos === !post.viewer_gave_kudos ? 0 : post.viewer_gave_kudos ? -1 : 1)) } : p));
  } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not update kudos.'); }
  finally { kudosLocks.current.delete(post.id); if (controller.current && !controller.current.signal.aborted) setPendingKudos([...kudosLocks.current]); }
 }
 function retry() { void load(failedRefresh.current || !ready); }
 return <AppPage title="Feed" scrollable={false}>
  <Text style={ui.pageTitle}>Feed</Text>
  <FlatList data={posts} keyExtractor={p => p.id} onEndReached={() => { if (!error) void load(); }} onEndReachedThreshold={.5} onRefresh={() => { void load(true); }} refreshing={refreshing} contentContainerStyle={{ paddingTop: 8, paddingBottom: 134, gap: 18 }}
   renderItem={({ item }) => <FeedCard post={item} pending={pendingKudos.includes(item.id)} onKudos={() => { void kudos(item); }} />}
   ListEmptyComponent={!busy && ready ? <View style={ui.empty}><Text style={ui.emptyTitle}>No posts yet</Text><Text style={ui.muted}>Shared workouts and updates will appear here.</Text></View> : null}
   ListFooterComponent={<View style={{ gap: 12 }}>{busy && !refreshing && <ActivityIndicator accessibilityLabel="Loading feed" color={c.primary} />}{error && <><Text accessibilityRole="alert" style={ui.muted}>{error}</Text><Action secondary onPress={retry}>Try again</Action></>}{ready && posts.length > 0 && !hasMore && !busy && <Text style={[ui.muted, { textAlign: 'center', padding: 12 }]}>You’re caught up</Text>}</View>} />
 </AppPage>;
}
export function FeedCard({ post, pending, onKudos }: { post: FeedPost; pending: boolean; onKudos: () => void }) {
 const gold = isGoldWorkout(post), name = post.author.display_name || post.author.handle || 'Member';
 const label = gold ? 'Gold workout' : ({ session: 'Workout', pr: 'Personal record', medal: 'Medal', goal: 'Goal', advice: 'Advice' }[post.kind] ?? 'Update');
 return <View style={{ borderRadius: 24, overflow: 'hidden', padding: 20, gap: 14, borderWidth: 1, borderColor: gold ? '#CDB76D' : c.border }}>
  <GlassSurface radius={24} tint={gold ? '#F8EAC0' : c.primarySoft} colored />
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
   <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,.65)', alignItems: 'center', justifyContent: 'center' }}><Text style={ui.rowTitle}>{name.slice(0, 1).toUpperCase()}</Text></View>
   <View style={{ flex: 1 }}><Text style={ui.rowTitle}>{name}</Text><Text style={ui.muted}>{new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></View>
   <Text style={[ui.label, gold && { color: '#71540B' }]}>{label}</Text>
  </View>
  <Text style={ui.text}>{post.body}</Text>
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: gold ? '#DCCEAA' : c.border, paddingTop: 8 }}>
   <PolishedPressable accessibilityRole="button" accessibilityLabel={`${post.viewer_gave_kudos ? 'Remove' : 'Give'} kudos, ${post.kudos_count}`} accessibilityState={{ selected: post.viewer_gave_kudos, disabled: pending }} disabled={pending} onPress={onKudos} style={{ minHeight: 44, justifyContent: 'center', paddingRight: 20 }}><Text style={[ui.label, { color: post.viewer_gave_kudos ? c.primary : c.text }]}>{post.viewer_gave_kudos ? '♥' : '♡'} {post.kudos_count} kudos</Text></PolishedPressable>
   <Text style={ui.muted}>{post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}</Text>
  </View>
 </View>;
}
