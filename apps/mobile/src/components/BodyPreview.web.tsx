import { PolishedPressable } from '@/components/PolishedPressable';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, typography } from '@/theme/tokens';
import type { ExerciseId } from '@/data/workout';
export function BodyPreview({ selected, playing, height = 300, rotation = 0 }: { rotation?: number; selected: ExerciseId | null; playing: boolean; height?: number }) {
  const frame = useRef<HTMLIFrameElement>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const rotationSent = useRef(0);
  function send(data: object) { frame.current?.contentWindow?.postMessage(data, window.location.origin); }
  const onMessage = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
    if (event.data?.type === 'spotter:model-ready') { setReady(true); setFailed(false); send({ type: 'spotter:select', id: selected }); rotationSent.current = rotation; if (rotation) send({ type: 'spotter:rotate', degrees: rotation }); send({ type: 'spotter:pause', playing }); }
    if (event.data?.type === 'spotter:model-error') setFailed(true);
  });
  useEffect(() => { const handle = (e: MessageEvent) => onMessage(e); window.addEventListener('message', handle); return () => window.removeEventListener('message', handle); }, []);
  const syncSelection = useEffectEvent(() => { send({ type: 'spotter:select', id: selected }); rotationSent.current = rotation; if (rotation) send({ type: 'spotter:rotate', degrees: rotation }); send({ type: 'spotter:pause', playing }); });
  useEffect(() => { if (ready) syncSelection(); }, [selected, ready]); // Selection starts a new exercise; play changes preserve its position.
  useEffect(() => { if (ready) send({ type: 'spotter:pause', playing }); }, [playing, ready]);
  useEffect(() => { if (ready && rotation !== rotationSent.current) { send({ type: 'spotter:rotate', degrees: rotation }); rotationSent.current = rotation; } }, [rotation, ready]);
  useFocusEffect(() => { if (ready) send({ type: 'spotter:pause', playing }); return () => send({ type: 'spotter:pause', playing: false }); });
  useEffect(() => { if (ready || failed) return; const timer = setTimeout(() => setFailed(true), 20000); return () => clearTimeout(timer); }, [ready, failed, attempt]);
  return <View style={{ height, marginHorizontal: -12 }}>
    <iframe ref={frame} key={attempt} src="/model/index.html?v=glass-depth-2" title="Interactive workout figure. Drag to rotate and scroll to zoom." style={{ width: '100%', height: '100%', border: 0, background: 'transparent', display: 'block' }} />
    {(!ready || failed) && <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 8, alignItems: 'center' }}>
      <Text style={{ color: colors.muted, fontFamily: typography.family, fontSize: 14 }}>{failed ? 'The figure couldn’t load. Your workout list is still available.' : 'Loading your workout figure…'}</Text>
      {failed && <PolishedPressable accessibilityRole="button" onPress={() => { setReady(false); setFailed(false); setAttempt(a => a + 1); }}><Text style={{ color: colors.primary, padding: 12 }}>Retry figure</Text></PolishedPressable>}
    </View>}
  </View>;
}
