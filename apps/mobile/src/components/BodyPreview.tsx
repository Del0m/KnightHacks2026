import { useCallback, useContext, useEffect, useEffectEvent, useRef, useState, useMemo } from 'react';
import { AppState, PanResponder, Text, View } from 'react-native';
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
  const pinchDistance = useRef(0);
  const send = useCallback((data: Parameters<typeof modelCommand>[0]) => frame.current?.injectJavaScript(modelCommand(data)), []);
  // Reserve two-finger pinch only. One finger reaches the native page ScrollView.
  /* eslint-disable react-hooks/refs, react-hooks/preserve-manual-memoization -- PanResponder stores callbacks; refs are accessed only during touch events. */
  const pinch = useMemo(() => {
    const distance = (touches: readonly { pageX: number; pageY: number }[]) => touches.length === 2 ? Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY) : 0;
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: event => event.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: event => event.nativeEvent.touches.length === 2,
      onPanResponderGrant: event => { pinchDistance.current = distance(event.nativeEvent.touches); },
      onPanResponderMove: event => {
        const next = distance(event.nativeEvent.touches), previous = pinchDistance.current;
        if (next > 8 && previous > 8) send({ type: 'steadyforum:zoom', factor: Math.max(.5, Math.min(2, previous / next)) });
        pinchDistance.current = next;
      },
      onPanResponderRelease: () => { pinchDistance.current = 0; },
      onPanResponderTerminate: () => { pinchDistance.current = 0; },
      onPanResponderTerminationRequest: () => false,
    });
  }, [send]);
  /* eslint-enable react-hooks/refs, react-hooks/preserve-manual-memoization */
  const syncPlayback = useCallback(() => {
    const active = focused.current && foreground.current;
    send({ type: 'steadyforum:active', active });
    send({ type: 'steadyforum:pause', playing: active && playing });
  }, [playing, send]);
  const syncSelection = useEffectEvent(() => {
    send({ type: 'steadyforum:motion', reduced: reduced !== false });
    send({ type: 'steadyforum:select', id: selected });
    rotationSent.current = rotation;
    if (rotation) send({ type: 'steadyforum:rotate', degrees: rotation });
    syncPlayback();
  });
  useEffect(() => { if (ready) syncSelection(); }, [selected, ready]);
  useEffect(() => { if (ready && rotation !== rotationSent.current) { send({ type: 'steadyforum:rotate', degrees: rotation }); rotationSent.current = rotation; } }, [rotation, ready, send]);
  useEffect(() => { if (ready) syncPlayback(); }, [playing, ready, syncPlayback]);
  useEffect(() => { if (ready) send({ type: 'steadyforum:motion', reduced: reduced !== false }); }, [reduced, ready, send]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    if (ready) syncPlayback();
    return () => { focused.current = false; send({ type: 'steadyforum:active', active: false }); };
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
  return <TabSwipeBoundary><View {...pinch.panHandlers} style={{ height, marginHorizontal: -12 }}>
    <View pointerEvents="none" style={{ flex: 1 }}>
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
      style={{ backgroundColor: 'transparent' }} containerStyle={{ backgroundColor: 'transparent' }} /></View>
    {(!ready || failed) && <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 8, alignItems: 'center' }}>
      <Text style={{ color: colors.muted, fontFamily: typography.family, fontSize: 14 }}>{failed ? 'The figure couldn’t load. Your workout list is still available.' : 'Loading your workout figure…'}</Text>
      {failed && <PolishedPressable accessibilityRole="button" onPress={() => { setReady(false); setFailed(false); setAttempt(a => a + 1); }}><Text style={{ color: colors.primary, padding: 12 }}>Retry figure</Text></PolishedPressable>}
    </View>}
  </View></TabSwipeBoundary>;
}
