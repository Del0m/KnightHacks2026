import { useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import { TabSwipeBoundary } from './SwipeTabs';
import { PolishedPressable } from '@/components/PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { colors, typography } from '@/theme/tokens';
import type { ExerciseId } from '@/data/workout';
import { modelCommand, modelEvent, modelNavigationAllowed, modelScroll } from './bodyPreviewBridge';
import { PageScroll } from './PageScroll';
import modelSource from './bodyModel.generated.json';

export function BodyPreview({ selected, playing, height = 300, rotation = 0 }: { rotation?: number; selected: ExerciseId | null; playing: boolean; height?: number }) {
  const frame = useRef<WebView>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const focused = useRef(false), foreground = useRef(AppState.currentState === 'active');
  const rotationSent = useRef(0);
  const reduced = useReducedMotion();
  const scrollPage = useContext(PageScroll);
  const send = useCallback((data: Parameters<typeof modelCommand>[0]) => frame.current?.injectJavaScript(modelCommand(data)), []);
  const syncPlayback = useCallback(() => {
    const active = focused.current && foreground.current;
    send({ type: 'spotter:active', active });
    send({ type: 'spotter:pause', playing: active && playing });
  }, [playing, send]);
  const syncSelection = useEffectEvent(() => {
    send({ type: 'spotter:motion', reduced: reduced !== false });
    send({ type: 'spotter:select', id: selected });
    rotationSent.current = rotation;
    if (rotation) send({ type: 'spotter:rotate', degrees: rotation });
    syncPlayback();
  });
  useEffect(() => { if (ready) syncSelection(); }, [selected, ready]);
  useEffect(() => { if (ready && rotation !== rotationSent.current) { send({ type: 'spotter:rotate', degrees: rotation }); rotationSent.current = rotation; } }, [rotation, ready, send]);
  useEffect(() => { if (ready) syncPlayback(); }, [playing, ready, syncPlayback]);
  useEffect(() => { if (ready) send({ type: 'spotter:motion', reduced: reduced !== false }); }, [reduced, ready, send]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (ready) syncPlayback();
    return () => { focused.current = false; send({ type: 'spotter:active', active: false }); };
  }, [ready, send, syncPlayback]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { foreground.current = state === 'active'; if (ready) syncPlayback(); });
    return () => subscription.remove();
  }, [ready, syncPlayback]);
  useEffect(() => {
    if (ready || failed) return;
    const timer = setTimeout(() => setFailed(true), 20000);
    return () => clearTimeout(timer);
  }, [ready, failed, attempt]);
  return <TabSwipeBoundary><View style={{ height, marginHorizontal: -12 }}>
    <WebView ref={frame} key={attempt} source={modelSource} originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => modelNavigationAllowed(request.url)}
      onMessage={event => {
        const delta = modelScroll(event.nativeEvent.data);
        if (delta !== null) { scrollPage?.(delta); return; }
        const result = modelEvent(event.nativeEvent.data);
        if (result === 'ready') { setReady(true); setFailed(false); }
        if (result === 'error') { setReady(false); setFailed(true); }
      }}
      onError={() => { setReady(false); setFailed(true); }}
      onContentProcessDidTerminate={() => { setReady(false); setFailed(true); }}
      onRenderProcessGone={() => { setReady(false); setFailed(true); }}
      scrollEnabled={false} bounces={false} overScrollMode="never" setBuiltInZoomControls={false}
      javaScriptCanOpenWindowsAutomatically={false} allowFileAccess={false} allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never" thirdPartyCookiesEnabled={false} sharedCookiesEnabled={false}
      accessibilityLabel="Interactive workout figure. Scroll the page with one finger. Use the rotation slider to turn the figure, and pinch with two fingers to zoom."
      style={{ backgroundColor: 'transparent' }} containerStyle={{ backgroundColor: 'transparent' }} />
    {(!ready || failed) && <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 8, alignItems: 'center' }}>
      <Text style={{ color: colors.muted, fontFamily: typography.family, fontSize: 14 }}>{failed ? 'The figure couldn’t load. Your workout list is still available.' : 'Loading your workout figure…'}</Text>
      {failed && <PolishedPressable accessibilityRole="button" onPress={() => { setReady(false); setFailed(false); setAttempt(a => a + 1); }}><Text style={{ color: colors.primary, padding: 12 }}>Retry figure</Text></PolishedPressable>}
    </View>}
  </View></TabSwipeBoundary>;
}
