import * as Haptics from 'expo-haptics';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View, LayoutAnimation, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { PolishedPressable } from '@/components/PolishedPressable';
import { pageColors } from '@/theme/tokens';
import { useAuth } from '@/screens/Auth/session';
import { fetchFeed, postType, toggleKudos, type FeedPost, type FeedType } from './feedApi';
import { FeedCard, FeedIcon } from './FeedCard';
import { FeedEditor } from './FeedEditor';
import { examplePosts } from './examples';
export { FeedCard } from './FeedCard';
const c = pageColors('Feed'), ui = pageStyles('Feed');
export default function FeedScreen() {
 const { user } = useAuth();
 return user ? <FeedSession key={user.id} /> : null;
}
export function FeedExamples() { return <FeedSession initialExamples />; }
function FeedSession({ initialExamples = false }: { initialExamples?: boolean }) {
 const auth = useAuth(), request = useRef(auth.apiFetch); useLayoutEffect(() => { request.current = auth.apiFetch; }, [auth.apiFetch]);
 const [posts, setPosts] = useState<FeedPost[]>([]), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false), [hasMore, setHasMore] = useState(false);
 const cachedPosts = useRef(posts); useLayoutEffect(() => { cachedPosts.current = posts; }, [posts]);
 const [type, setType] = useState<FeedType>('recent'), [filtersOpen, setFiltersOpen] = useState(false), [examples, setExamples] = useState(initialExamples), [preview, setPreview] = useState(examplePosts), [editor, setEditor] = useState<FeedPost | null | undefined>(undefined);
 const cursor = useRef<string | null>(null), loading = useRef(false), controller = useRef<AbortController | null>(null), failedRefresh = useRef(false), loaded = useRef(false), selection = useRef<string | null>(null);
 const [pendingKudos, setPendingKudos] = useState<string[]>([]), kudosLocks = useRef(new Set<string>());
 const load = useCallback(async (refresh = false, retain = false) => {
  if (examples) { setReady(true); setHasMore(false); setBusy(false); setRefreshing(false); setError(null); return; }
  if (loading.current || !controller.current || controller.current.signal.aborted || (!refresh && !cursor.current)) return;
  const signal = controller.current.signal, keepLoaded = retain && loaded.current;
  loading.current = true; failedRefresh.current = refresh; setBusy(true); setRefreshing(refresh && !keepLoaded); setError(null);
  try {
   let page = await fetchFeed(request.current, refresh ? undefined : cursor.current!, signal, type);
   const cachedIds = new Set(cachedPosts.current.map(p => p.id));
   const refreshedPosts = [...page.posts];
   let overlaps = page.posts.some(p => cachedIds.has(p.id));
   // Catch up through new pages before resuming at the cached tail's cursor.
   while (keepLoaded && cachedIds.size > 0 && !overlaps && page.next_cursor && !signal.aborted) {
    page = await fetchFeed(request.current, page.next_cursor, signal, type);
    refreshedPosts.push(...page.posts);
    overlaps = page.posts.some(p => cachedIds.has(p.id));
   }
   if (signal.aborted) return;
   const cached = cachedPosts.current;
   const refreshedIds = new Set(refreshedPosts.map(p => p.id));
   const coveredEnd = cached.reduce((end, p, index) => refreshedIds.has(p.id) ? index : end, -1);
   const keepTail = keepLoaded && overlaps && page.next_cursor !== null && coveredEnd < cached.length - 1;
   if (!keepTail) { cursor.current = page.next_cursor; setHasMore(page.next_cursor !== null); }
   setPosts(previous => {
    // The server replaces the refreshed prefix, including entries it removed.
    const tail = keepTail ? previous.slice(coveredEnd + 1) : [];
    const combined = keepTail ? [...refreshedPosts, ...tail] : refresh ? refreshedPosts : [...previous, ...refreshedPosts];
    const ids = new Set<string>();
    return combined.filter(p => { if (ids.has(p.id)) return false; ids.add(p.id); return true; });
   });
   loaded.current = true; setReady(true);
  } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the feed.'); }
  finally { if (controller.current?.signal === signal && !signal.aborted) { loading.current = false; setBusy(false); setRefreshing(false); } }
 }, [type, examples]);
 useFocusEffect(useCallback(() => {
  const nextSelection = `${type}:${examples}`, changed = selection.current !== nextSelection;
  selection.current = nextSelection;
  controller.current = new AbortController(); loading.current = false; setError(null); setPendingKudos([...kudosLocks.current]);
  if (changed) { cursor.current = null; loaded.current = false; setPosts([]); setReady(false); }
  void load(true, !changed);
  return () => { controller.current?.abort(); };
 }, [load, type, examples]));
 async function kudos(post: FeedPost) {
  if (examples) { if (!post.viewer_gave_kudos && Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {}); setPreview(rows => rows.map(p => p.id === post.id ? { ...p, viewer_gave_kudos: !p.viewer_gave_kudos, kudos_count: p.kudos_count + (p.viewer_gave_kudos ? -1 : 1) } : p)); return; }
  if (kudosLocks.current.has(post.id) || !controller.current) return;
  const signal = controller.current.signal;
  kudosLocks.current.add(post.id); setPendingKudos([...kudosLocks.current]);
  try {
   await toggleKudos(request.current, post.id, post.viewer_gave_kudos);
   if (!signal.aborted && !post.viewer_gave_kudos && Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
   if (!signal.aborted) setPosts(rows => rows.map(p => p.id === post.id ? { ...p, viewer_gave_kudos: !post.viewer_gave_kudos, kudos_count: Math.max(0, p.kudos_count + (p.viewer_gave_kudos === !post.viewer_gave_kudos ? 0 : post.viewer_gave_kudos ? -1 : 1)) } : p));
  } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not update rep.'); }
  finally { kudosLocks.current.delete(post.id); if (controller.current && !controller.current.signal.aborted) setPendingKudos([...kudosLocks.current]); }
 }
 function retry() { void load(failedRefresh.current || !ready); }
 function toggleFilters() { LayoutAnimation.configureNext({ duration: 220, create: { type: 'easeInEaseOut', property: 'scaleY' }, update: { type: 'easeInEaseOut' }, delete: { type: 'easeInEaseOut', property: 'opacity' } }); setFiltersOpen(v => !v); }
 const visible = examples ? preview.filter(p => type === 'recent' || postType(p) === type) : posts;
 function created(body: string, title?: string) {
  if (editor) {
   const id = editor.id;
   const update = (rows: FeedPost[]) => rows.map(p => p.id === id ? { ...p, comment_count: p.comment_count + 1 } : p);
   if (examples) setPreview(update); else setPosts(update);
  } else {
   if (examples) setPreview(rows => [{ id: `example-new-${Date.now()}`, kind: 'goal', body, created_at: new Date().toISOString(), author: { id: 'example-you', handle: null, display_name: 'You' }, data: { post_type: 'custom', ...(title ? { title } : {}) }, kudos_count: 0, comment_count: 0, viewer_gave_kudos: false }, ...rows]);
   if (type !== 'recent') setType('recent'); else if (!examples) void load(true);
  }
 }
 return <AppPage title="Feed" scrollable={false}>
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={[ui.pageTitle, { marginTop: 8 }]}>Feed</Text><View style={{ flexDirection: 'row', gap: 10 }}>
   <PolishedPressable accessibilityRole="button" accessibilityLabel="New post" onPress={() => setEditor(null)} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }}><GlassSurface radius={23} tint="#EDE4FB" colored /><FeedIcon name="plus" /></PolishedPressable>
   <PolishedPressable accessibilityRole="button" accessibilityLabel="Filter feed" accessibilityState={{ expanded: filtersOpen }} onPress={() => toggleFilters()} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }}><GlassSurface radius={23} /><FeedIcon name="filter" /></PolishedPressable>
  </View></View>
  {filtersOpen && <View style={{ borderRadius: 20, padding: 12, gap: 4 }}><GlassSurface radius={20} tint="#EDE4FB" colored />{([['recent', 'Recent'], ['custom', 'Custom posts'], ['medal', 'Medals'], ['pr', 'Personal records']] as const).map(([value, label]) => <PolishedPressable key={value} accessibilityRole="button" accessibilityState={{ selected: type === value }} onPress={() => { setType(value); setFiltersOpen(false); }} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: type === value ? 'rgba(255,255,255,.65)' : 'transparent' }}><Text style={[ui.label, { color: c.text }]}>{label}</Text></PolishedPressable>)}
   <PolishedPressable accessibilityRole="button" onPress={() => { setExamples(v => !v); setType('recent'); setFiltersOpen(false); }} style={{ minHeight: 44, borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 12, justifyContent: 'center' }}><Text style={ui.label}>{examples ? 'Return to live feed' : 'Preview 10 examples'}</Text></PolishedPressable>
  </View>}
  {(examples || type !== 'recent') && <Text style={ui.label}>{examples ? 'Example posts · preview only' : ({ custom: 'Custom posts', medal: 'Medals', pr: 'Personal records' } as const)[type as Exclude<FeedType, 'recent'>]}</Text>}
  <FlatList data={visible} keyExtractor={p => p.id} onEndReached={() => { if (!error) void load(); }} onEndReachedThreshold={.5} onRefresh={() => { void load(true); }} refreshing={refreshing} contentContainerStyle={{ paddingTop: 8, paddingBottom: 134, gap: 18 }}
   renderItem={({ item }) => <FeedCard post={item} pending={pendingKudos.includes(item.id)} onKudos={() => { void kudos(item); }} onComment={() => setEditor(item)} />}
   ListEmptyComponent={!busy && ready ? <View style={ui.empty}><Text style={ui.emptyTitle}>No posts yet</Text><Text style={ui.muted}>Shared workouts and updates will appear here.</Text></View> : null}
   ListFooterComponent={<View style={{ gap: 12 }}>{busy && !refreshing && <ActivityIndicator accessibilityLabel="Loading feed" color={c.primary} />}{error && <><Text accessibilityRole="alert" style={ui.muted}>{error}</Text><Action secondary onPress={retry}>Try again</Action></>}{ready && visible.length > 0 && !hasMore && !busy && <Text style={[ui.muted, { textAlign: 'center', padding: 12 }]}>You’re caught up</Text>}</View>} />
  {editor !== undefined && <FeedEditor key={editor?.id ?? 'new-post'} post={editor} request={auth.apiFetch} examples={examples} onClose={() => setEditor(undefined)} onCreated={created} />}
 </AppPage>;
}
