import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { GlassChoice } from '@/components/GlassChoice';
import { usePoseOutput, type PoseEngine } from '@/pose/usePoseOutput';
import { startPoseBenchmark, usePoseMode } from '@/pose/usePoseMode';
import type { PoseResult } from '@/pose/types';
import { colors as c, typography as t } from '@/theme/tokens';
import { assessFraming, FRAME_STALE_MS, updateStability, type Size } from './framing';
import { cameraSpec } from './exercises';
import { FramingGuide } from './FramingGuide';

export default function CameraCheck({ exercise, onContinue }: { exercise: string; onContinue: (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void }) {
  if (Platform.OS !== 'ios') return <View style={s.group}><Text style={s.heading}>Live framing is available on iPhone.</Text><Text style={s.text}>Use the placement guide above, or continue with manual tracking on this device.</Text><GlassChoice label="Continue without camera" onPress={() => onContinue('manual')} compact /></View>;
  return <IPhoneCheck exercise={exercise} onContinue={onContinue} />;
}
function IPhoneCheck({ exercise, onContinue }: { exercise: string; onContinue: (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void }) {
  const permission = useCameraPermission();
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  if (!permission.hasPermission) return <View style={s.group}>
    <Text style={s.heading}>Allow camera access</Text><Text style={s.text}>Camera frames are processed on your iPhone. This setup check doesn’t record video.</Text>
    {permissionError && <Text accessibilityRole="alert" style={s.error}>{permissionError}</Text>}
    <GlassChoice label={permission.canRequestPermission ? 'Allow camera' : 'Open camera settings'} primary selected onPress={() => { setPermissionError(null); void (permission.canRequestPermission ? permission.requestPermission() : Linking.openSettings()).catch(() => setPermissionError('Could not open camera access. Please try again.')); }} />
    <GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
  </View>;
  // Unmounting the live check clears all detection/stability state when backgrounded or unfocused.
  if (!foreground || !focused) return <Text style={s.text}>Camera paused. Return to Steady forum to check your framing.</Text>;
  return <ModeCheck exercise={exercise} onContinue={onContinue} />;
}
function ModeCheck({ exercise, onContinue }: { exercise: string; onContinue: (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void }) {
  const mode = usePoseMode();
  useEffect(() => { void startPoseBenchmark(); }, []);
  if (mode.benchmarking || mode.mode === 'pending') return <View style={s.group}><ActivityIndicator accessibilityLabel="Preparing the camera" color={c.primary} /><Text style={s.text}>Getting the camera ready…</Text><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} /></View>;
  if (mode.mode !== 'coreml' && mode.mode !== 'vision') return <View style={s.group}>
    <Text style={s.heading}>Try basic on-device tracking.</Text><Text style={s.text}>The main tracker isn’t available on this phone right now. Basic tracking uses Apple Vision on your iPhone.</Text>
    <GlassChoice label="Use basic tracking" primary selected onPress={() => mode.setPreference('vision')} /><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
  </View>;
  return <LiveCheck key={`${mode.mode}:${mode.size}`} engine={mode.mode} size={mode.size} exercise={exercise} onContinue={onContinue} />;
}
function LiveCheck({ engine, size, exercise, onContinue }: { engine: PoseEngine; size: 320 | 256; exercise: string; onContinue: (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void }) {
  const [position, setPosition] = useState<'front' | 'back'>('front');
  return <CameraPreview key={position} position={position} engine={engine} size={size} exercise={exercise} onFlip={() => setPosition(p => p === 'front' ? 'back' : 'front')} onContinue={onContinue} />;
}
function CameraPreview({ position, engine, size, exercise, onFlip, onContinue }: { position: 'front' | 'back'; engine: PoseEngine; size: 320 | 256; exercise: string; onFlip: () => void; onContinue: (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void }) {
  const device = useCameraDevice(position);
  const [result, setResult] = useState<PoseResult | undefined>();
  const [view, setView] = useState<Size | null>(null), [image, setImage] = useState<Size | null>(null);
  const [cameraError, setCameraError] = useState(false), [now, setNow] = useState(Date.now);
  const stableSince = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const outputRef = useRef<{ currentResolution?: Size } | null>(null);
  const mirrored = position === 'front';
  function resolution() {
    const r = outputRef.current?.currentResolution;
    // app.json locks the app to portrait; native results are upright and unmirrored.
    if (r) setImage({ width: Math.min(r.width, r.height), height: Math.max(r.width, r.height) });
  }
  const output = usePoseOutput({ engine, size, maxFps: 15, onPose: detection => {
    const time = Date.now(); setNow(time); setResult(detection.result); resolution();
    if (image && view) {
      const next = updateStability(stableSince.current, assessFraming(detection.result, image, view, mirrored, time).kind === 'ready', time);
      stableSince.current = next.since; setReady(next.ready);
    }
  } });
  useLayoutEffect(() => { outputRef.current = output.frameOutput; }, [output.frameOutput]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!result || now - result.timestamp_ms > FRAME_STALE_MS || output.error || cameraError) stableSince.current = null;
  }, [now, result, output.error, cameraError]);
  const framing = image && view ? assessFraming(result, image, view, mirrored, now) : null;
  const valid = ready && framing?.kind === 'ready' && !output.error && !cameraError;
  if (!device) return <View style={s.group}><Text style={s.heading}>This camera isn’t available.</Text><GlassChoice compact label="Switch camera" onPress={onFlip} /><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} /></View>;
  return <View style={s.group}>
    <View style={s.status} accessibilityLiveRegion="polite"><Text style={[s.heading, valid && { color: '#14744C' }]}>{cameraError || output.error ? 'Camera check interrupted' : valid ? '✓ Ready' : framing?.kind === 'ready' ? 'Hold your position…' : framing?.title ?? 'Looking for you'}</Text><Text style={s.text}>{cameraError || output.error ? 'Try switching cameras, or continue with manual tracking.' : framing?.hint ?? 'Return to your exercise spot with your whole body visible.'}</Text></View>
    <View testID="framing-preview" style={s.preview} onLayout={event => { setView(event.nativeEvent.layout); stableSince.current = null; setReady(false); }}>
      <Camera style={[StyleSheet.absoluteFill, mirrored && { transform: [{ scaleX: -1 }] }]} device={device} outputs={[output.frameOutput]} isActive mirrorMode="off" orientationSource="interface" resizeMode="cover" onConfigured={() => { resolution(); setCameraError(false); stableSince.current = null; setReady(false); setResult(undefined); }} onError={() => { setCameraError(true); stableSince.current = null; setReady(false); }} />
      <FramingGuide ready={Boolean(valid)} />
    </View>
    {(cameraSpec(exercise).recommended_view === 'side') && <Text style={s.text}>Side-on view: face across the camera, so it can see your movement from the side.</Text>}
    <Text style={s.caption}>Keep your full rep inside the frame. The eight-foot guide is approximate.</Text>
    <GlassChoice compact label={position === 'front' ? 'Use back camera' : 'Use front camera'} onPress={onFlip} />
    <GlassChoice label="Framing checked · continue" primary selected disabled={!valid} onPress={() => onContinue('camera', position)} />
    <GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
    <Text style={s.caption}>Your workout uses the camera to count reps.</Text>
  </View>;
}
const s = StyleSheet.create({
  group: { gap: 16 }, preview: { width: '100%', aspectRatio: 0.8, maxHeight: 400, borderRadius: 28, overflow: 'hidden', backgroundColor: '#153F58' }, status: { gap: 6 },
  heading: { fontFamily: t.label, fontSize: 21, lineHeight: 27, color: c.text }, text: { fontFamily: t.family, fontSize: 16, lineHeight: 24, color: c.muted }, caption: { fontFamily: t.family, fontSize: 13, lineHeight: 19, color: c.muted }, error: { fontFamily: t.label, color: '#963C30', fontSize: 15 },
});
