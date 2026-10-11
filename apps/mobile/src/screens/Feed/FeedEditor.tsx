import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View, Pressable, Linking, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action, pageStyles } from '@/components/AppPage';
import { GlassSurface } from '@/components/GlassSurface';
import { PolishedPressable } from '@/components/PolishedPressable';
import type { ApiRequest } from '@/services/workoutApi';
import { createAdvice, createComment, createPost, fetchComments, sourceUrl, type AdviceResult, type FeedComment, type FeedPost, type AdviceSource } from './feedApi';
import { FeedIcon } from './FeedCard';
const ui = pageStyles('Feed');
export function FeedEditor({ post, request, examples, onClose, onCreated, advice = false, onAdviceCreated, initialComments = [], notice, onSourceThread }: { post: FeedPost | null; request: ApiRequest; examples: boolean; onClose: () => void; onCreated: (body: string, title?: string) => void; advice?: boolean; onAdviceCreated?: (result: AdviceResult) => void; initialComments?: FeedComment[]; notice?: string; onSourceThread?: (source: AdviceSource) => void }) {
 const { height } = useWindowDimensions();
 const limit = post ? 1000 : 500;
 const [title, setTitle] = useState('');
 const [text, setText] = useState(''), [rows, setRows] = useState<FeedComment[]>(() => examples && post ? Array.from({ length: post.comment_count }, (_, i) => ({ id: `example-comment-${i}`, body: ['Nice work!', 'That last set looked strong.', 'Keep it up!'][i % 3], created_at: post.created_at, author: { id: `example-commenter-${i}`, handle: null, display_name: ['Casey', 'Morgan', 'Jamie'][i % 3] } })) : initialComments), [loading, setLoading] = useState(!!post && !examples), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
 const active = useRef(true), sending = useRef(false), latestRequest = useRef(request);
 useEffect(() => { latestRequest.current = request; }, [request]);
 const [reload, setReload] = useState(0);
 useEffect(() => {
  active.current = true; const controller = new AbortController();
  if (post && !examples) void fetchComments(latestRequest.current, post.id, controller.signal).then(value => { if (!controller.signal.aborted) setRows(previous => { const ids = new Set(value.map(row => row.id)); return [...value, ...previous.filter(row => !ids.has(row.id))]; }); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load comments.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  return () => { active.current = false; controller.abort(); };
 }, [post, examples, reload]);
 async function send() {
  const body = text.trim(); if (!body || body.length > limit || sending.current) return;
  sending.current = true; setBusy(true); setError(null);
  try {
   if (advice) {
    const result = await createAdvice(latestRequest.current, body);
    if (active.current) onAdviceCreated?.(result);
    return;
   }
   const result = examples ? { id: `example-comment-${Date.now()}`, created_at: new Date().toISOString() } : post ? await createComment(latestRequest.current, post.id, body) : await createPost(latestRequest.current, body, title);
   if (!active.current) return;
   if (title.trim() && !post) onCreated(body, title.trim()); else onCreated(body);
   if (post) { setRows(previous => previous.some(row => row.id === result.id) ? previous : [...previous, { id: result.id, body, created_at: result.created_at, author: { id: null, handle: null, display_name: 'You' } }]); setText(''); }
   else onClose();
  } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Could not post.'); }
  finally { sending.current = false; if (active.current) setBusy(false); }
 }
 return <Modal visible transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => { if (!busy) onClose(); }}>
  <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
   <Pressable accessibilityLabel="Dismiss editor" accessibilityRole="button" onPress={() => { if (!busy) onClose(); }} style={{ position: 'absolute', inset: 0 }} />
   <SafeAreaView testID="feed-editor-sheet" style={{ height: height * (post ? .85 : .55), flexShrink: 1, minHeight: 0, backgroundColor: '#FCF9FF', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }} edges={['bottom']}>
    <GlassSurface tint="#F4EEFC" colored radius={28} />
    <View pointerEvents="none" style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBBFD4', marginTop: 10 }} />
    <View style={{ padding: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text style={[ui.pageTitle, { marginTop: 0 }]}>{post ? 'Comments' : advice ? 'Ask for advice' : 'New post'}</Text><PolishedPressable accessibilityRole="button" accessibilityLabel="Close editor" disabled={busy} onPress={onClose} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}><GlassSurface radius={22} /><FeedIcon name="close" /></PolishedPressable></View>
    {!post && advice && <Text style={[ui.muted, { paddingHorizontal: 24, paddingBottom: 12, fontSize: 14 }]}>Include the exercise, your goal and what feels difficult.</Text>}
    {examples && <Text style={[ui.muted, { paddingHorizontal: 24, paddingBottom: 12 }]}>Example preview · changes stay here</Text>}
    {post && <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
     {notice && <Text style={ui.muted}>{notice}</Text>}
     {post && <View style={{ gap: 6, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#E6DCEE' }}><Text style={ui.rowTitle}>{post.author.display_name || post.author.handle || 'Member'}</Text><Text style={ui.text}>{post.body}</Text></View>}
     {loading && <ActivityIndicator accessibilityLabel="Loading comments" />}
     {post && !loading && !rows.length && !error && <Text style={ui.muted}>No comments yet</Text>}
     {rows.map(row => <View key={row.id} style={{ gap: 5 }}><Text style={[ui.label, { color: '#443354' }]}>{row.author?.display_name || row.author?.handle || (!row.author?.id ? 'SteadyForum' : 'Member')}</Text>{row.ai_suggested && <Text style={[ui.muted, { fontSize: 12 }]}>AI-suggested answer</Text>}<Text style={ui.text}>{row.body}</Text><View style={{ gap: 4 }}>{Array.isArray(row.sources) && row.sources.map(source => { const url = sourceUrl(source.url); return url || source.post_id && onSourceThread ? <PolishedPressable key={source.id} accessibilityRole="link" accessibilityLabel={`Source: ${source.title}`} onPress={() => { if (url) void Linking.openURL(url).catch(() => { if (active.current) setError('Could not open this source.'); }); else onSourceThread?.(source); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={[ui.label, { color: '#6B4C93' }]}>{source.title}</Text></PolishedPressable> : <Text key={source.id} style={[ui.muted, { fontSize: 13 }]}>{source.title}</Text>; })}</View></View>)}
     {error && <Text accessibilityRole="alert" style={ui.muted}>{error}</Text>}
     {post && !loading && error && !rows.length && <Action secondary onPress={() => { setLoading(true); setError(null); setReload(v => v + 1); }}>Retry comments</Action>}
    </ScrollView>}
    <View style={{ flex: post ? undefined : 1, minHeight: 0, padding: 24, paddingTop: 12, gap: 10 }}>{!post && !advice && <View style={{ borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 }}><GlassSurface tint="#EDE4FB" colored subtle radius={14} /><TextInput accessibilityLabel="Post title" placeholder="Title (optional)" placeholderTextColor="#776982" value={title} onChangeText={setTitle} maxLength={100} style={ui.rowTitle} /></View>}{!post && error && <Text accessibilityRole="alert" style={ui.muted}>{error}</Text>}<View style={{ flex: post ? undefined : 1, minHeight: 0, borderRadius: 18, padding: 14 }}><GlassSurface tint="#EDE4FB" colored radius={18} /><TextInput accessibilityLabel={post ? 'Your comment' : advice ? 'Your question' : 'Post text'} placeholder={post ? 'Add a comment…' : advice ? 'What would you like help with?' : 'What’s on your mind?'} placeholderTextColor="#776982" value={text} onChangeText={value => setText(value.slice(0, limit))} multiline maxLength={limit} style={[ui.text, { flex: post ? undefined : 1, minHeight: post ? 48 : 0, textAlignVertical: 'top' }]} /></View><Text style={[ui.muted, { alignSelf: 'flex-end', fontSize: 13 }]}>{text.length}/{limit}</Text><Action disabled={busy || !text.trim()} onPress={() => { void send(); }}>{busy ? 'Posting…' : post ? 'Post comment' : advice ? 'Ask the community' : 'Post'}</Action></View>
   </SafeAreaView>
  </KeyboardAvoidingView>
 </Modal>;
}
