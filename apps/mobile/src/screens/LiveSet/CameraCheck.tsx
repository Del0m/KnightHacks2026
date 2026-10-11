import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { GlassChoice } from '@/components/GlassChoice';
import { MIN_ON_DEVICE_FPS } from '@/pose/mode';
import { usePoseOutput, type PoseEngine } from '@/pose/usePoseOutput';
import { startPoseBenchmark, usePoseMode } from '@/pose/usePoseMode';
import { useCloudConfig } from '@/pose/useCloudConfig';
import type { PoseResult } from '@/pose/types';
import { useAuth } from '@/screens/Auth/session';
import { colors as c, typography as t } from '@/theme/tokens';
import { assessFraming, FRAME_STALE_MS, updateStability, type Size } from './framing';
import { cameraSpec } from './exercises';
import { FramingGuide } from './FramingGuide';
import { useTorchPulse } from './useTorchPulse';

type Continue = (mode?: 'camera' | 'manual', position?: 'front' | 'back') => void;
/** Cloud for this camera-check session: the signed-in account and its token source. */
type Cloud = { userId: string; getToken: () => Promise<string | null> };
/** After this long failing, continuing without the camera becomes the main choice. */
const RECOVERY_PRIMARY_MS = 15_000;
const SOURCE: Record<PoseEngine, string> = { cloud: 'Cloud tracking', coreml: 'On-device tracking', vision: 'Basic tracking (Apple Vision)' };

export default function CameraCheck({ exercise, onContinue }: { exercise: string; onContinue: Continue }) {
  if (Platform.OS !== 'ios') return <View style={s.group}><Text style={s.heading}>Live framing is available on iPhone.</Text><Text style={s.text}>Use the placement guide above, or continue with manual tracking on this device.</Text><GlassChoice label="Continue without camera" onPress={() => onContinue('manual')} compact /></View>;
  return <IPhoneCheck exercise={exercise} onContinue={onContinue} />;
}
function IPhoneCheck({ exercise, onContinue }: { exercise: string; onContinue: Continue }) {
  const permission = useCameraPermission();
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  // Core ML instead of failing cloud, for this camera-check session only; the saved preference is unchanged.
  const [local, setLocal] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  if (!permission.hasPermission) return <View style={s.group}>
    <Text style={s.heading}>Allow camera access</Text><Text style={s.text}>Camera frames are processed on your iPhone. This setup check doesn’t record video.</Text>
    {permissionError && <Text accessibilityRole="alert" style={s.error}>{permissionError}</Text>}
    <GlassChoice label={permission.canRequestPermission ? 'Allow camera' : 'Open camera settings'} primary selected onPress={() => { setPermissionError(null); void (permission.canRequestPermission ? permission.requestPermission() : Linking.openSettings()).catch(() => setPermissionError('Could not open camera access. Please try again.')); }} />
    <GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
  </View>;
  // Unmounting the live check clears all detection/stability state when backgrounded or unfocused.
  if (!foreground || !focused) return <Text style={s.text}>Camera paused. Return to SteadyForum to check your framing.</Text>;
  return <ModeCheck exercise={exercise} local={local} onUseLocal={() => setLocal(true)} onContinue={onContinue} />;
}
function ModeCheck({ exercise, local, onUseLocal, onContinue }: { exercise: string; local: boolean; onUseLocal: () => void; onContinue: Continue }) {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const mode = usePoseMode(userId);
  useEffect(() => { void startPoseBenchmark(); }, []);
  if (mode.benchmarking || mode.mode === 'pending') return <View style={s.group}><ActivityIndicator accessibilityLabel="Preparing the camera" color={c.primary} /><Text style={s.text}>Getting the camera ready…</Text><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} /></View>;
  const cloudMode = mode.mode === 'cloud' || mode.mode === 'paused';
  if (mode.mode === 'unavailable' && mode.needsCloudConsent && userId) return <View style={s.group}>
    <Text style={s.heading}>Turn on cloud tracking?</Text><Text style={s.text}>This iPhone is too slow to track reps on its own. Cloud tracking sends camera frames to the SteadyForum API for pose detection. Frames are processed in memory and never stored.</Text>
    <GlassChoice label="Allow cloud tracking" primary selected onPress={() => mode.setCloudConsent(true)} /><GlassChoice compact label="Use basic tracking" onPress={() => mode.setPreference('vision')} /><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
  </View>;
  if (!cloudMode && mode.mode !== 'coreml' && mode.mode !== 'vision') return <View style={s.group}>
    <Text style={s.heading}>Try basic on-device tracking.</Text><Text style={s.text}>The main tracker isn’t available on this phone right now. Basic tracking uses Apple Vision on your iPhone.</Text>
    <GlassChoice label="Use basic tracking" primary selected onPress={() => mode.setPreference('vision')} /><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />
  </View>;
  // Cloud and paused both run the cloud transport, so it can recover; Core ML replaces it only on a tap,
  // and only on a phone whose benchmark passed. Apple Vision is never offered as this fallback.
  const capable = (mode.benchmark?.fps ?? 0) >= MIN_ON_DEVICE_FPS;
  const engine: PoseEngine = cloudMode ? local ? 'coreml' : 'cloud' : mode.mode as PoseEngine;
  const cloud = cloudMode && !local && userId && mode.cloudConsent ? { userId, getToken: auth.getApiToken } : null;
  // Keyed by engine, not mode: a cloud <-> paused flip keeps the camera and its transport.
  return <LiveCheck key={`${engine}:${mode.size}`} engine={engine} size={mode.size} cloud={cloud} onUseLocal={cloudMode && capable ? onUseLocal : undefined} exercise={exercise} onContinue={onContinue} />;
}
type LiveProps = { engine: PoseEngine; size: 320 | 256; cloud: Cloud | null; onUseLocal?: () => void; exercise: string; onContinue: Continue };
function LiveCheck(props: LiveProps) {
  const [position, setPosition] = useState<'front' | 'back'>('front');
  return <CameraPreview key={position} {...props} position={position} onFlip={() => setPosition(p => p === 'front' ? 'back' : 'front')} />;
}
const noToken = async () => null;
function CameraPreview({ position, engine, size, cloud, onUseLocal, exercise, onFlip, onContinue }: LiveProps & { position: 'front' | 'back'; onFlip: () => void }) {
  const device = useCameraDevice(position);
  // Set on the first cloud failure; cleared by a fresh tracked result or a retry.
  const [failingSince, setFailingSince] = useState<number | null>(null), [attempt, setAttempt] = useState(0);
  const cloudConfig = useCloudConfig({ enabled: engine === 'cloud' && cloud != null, userId: cloud?.userId, getToken: cloud?.getToken ?? noToken, attempt, onFailure: () => setFailingSince(since => since ?? Date.now()) });
  const [result, setResult] = useState<PoseResult | undefined>();
  const [view, setView] = useState<Size | null>(null), [image, setImage] = useState<Size | null>(null);
  const [cameraError, setCameraError] = useState(false), [now, setNow] = useState(Date.now);
  const stableSince = useRef<number | null>(null);
  const lastDetection = useRef(0);
  const confirmed = useRef(false);
  const { signal, torchMode } = useTorchPulse(position === 'back' && Boolean(device?.hasTorch) && !cameraError);
  const [ready, setReady] = useState(false);
  const outputRef = useRef<{ currentResolution?: Size } | null>(null);
  const mirrored = position === 'front';
  function resolution() {
    const r = outputRef.current?.currentResolution;
    // app.json locks the app to portrait; native results are upright and unmirrored.
    if (r) setImage({ width: Math.min(r.width, r.height), height: Math.max(r.width, r.height) });
  }
  const output = usePoseOutput({ engine, size, maxFps: 15, cloud: cloudConfig, onPose: detection => {
    const time = Date.now(); setNow(time); setResult(detection.result); resolution(); setFailingSince(null);
    if (time - lastDetection.current > FRAME_STALE_MS) stableSince.current = null;
    lastDetection.current = time;
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
  useEffect(() => {
    if (!valid || confirmed.current) return;
    confirmed.current = true;
    signal(() => onContinue('camera', position));
  }, [valid, signal, onContinue, position]);
  const recovering = engine === 'cloud' && failingSince != null;
  const giveUp = recovering && now - failingSince >= RECOVERY_PRIMARY_MS;
  const waiting = engine === 'cloud' && output.cloudStatus !== 'tracking' ? output.cloudStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…' : null;
  if (!device) return <View style={s.group}><Text style={s.heading}>This camera isn’t available.</Text><GlassChoice compact label="Switch camera" onPress={onFlip} /><GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} /></View>;
  return <View style={s.group}>
    <View style={s.status} accessibilityLiveRegion="polite"><Text style={[s.heading, valid && { color: '#14744C' }]}>{cameraError || output.error ? 'Camera check interrupted' : waiting ?? (valid ? '✓ Ready' : framing?.kind === 'ready' ? 'Hold your position…' : framing?.title ?? 'Looking for you')}</Text><Text style={s.text}>{cameraError || output.error ? 'Try switching cameras, or continue with manual tracking.' : waiting ? 'Waiting for cloud tracking. Your camera stays on.' : framing?.hint ?? 'Return to your exercise spot with your whole body visible.'}</Text><Text style={s.caption}>{SOURCE[engine]}</Text></View>
    {recovering && <View style={s.group}>
      <Text style={s.text}>Cloud tracking isn’t responding.{onUseLocal ? ' You can track on this iPhone instead.' : ''}</Text>
      {onUseLocal && <GlassChoice label="Use local tracking" primary={!giveUp} selected={!giveUp} compact={giveUp} onPress={onUseLocal} />}
      <GlassChoice compact label="Retry cloud" onPress={() => { setFailingSince(null); setAttempt(a => a + 1); }} />
      <GlassChoice label="Continue without camera" primary={giveUp} selected={giveUp} compact={!giveUp} onPress={() => onContinue('manual')} />
    </View>}
    <View testID="framing-preview" style={s.preview} onLayout={event => { setView(event.nativeEvent.layout); stableSince.current = null; setReady(false); }}>
      <Camera style={[StyleSheet.absoluteFill, mirrored && { transform: [{ scaleX: -1 }] }]} device={device} outputs={[output.frameOutput]} isActive torchMode={torchMode} mirrorMode="off" orientationSource="interface" resizeMode="cover" onConfigured={() => { resolution(); setCameraError(false); stableSince.current = null; setReady(false); setResult(undefined); }} onError={() => { setCameraError(true); stableSince.current = null; setReady(false); }} />
      <FramingGuide ready={Boolean(valid)} />
    </View>
    {(cameraSpec(exercise).recommended_view === 'side') && <Text style={s.text}>Side-on view: face across the camera, so it can see your movement from the side.</Text>}
    <Text style={s.caption}>Keep your full rep inside the frame. The eight-foot guide is approximate.</Text>
    <GlassChoice compact label={position === 'front' ? 'Use back camera' : 'Use front camera'} onPress={onFlip} />
    <Text style={s.caption}>Hold your position for one second. Your workout starts automatically.{position === 'back' && device.hasTorch ? ' The light flashes when you’re ready.' : ''}</Text>
    {!recovering && <GlassChoice compact label="Continue without camera" onPress={() => onContinue('manual')} />}
    <Text style={s.caption}>Your workout uses the camera to count reps.</Text>
  </View>;
}
const s = StyleSheet.create({
  group: { gap: 16 }, preview: { width: '100%', aspectRatio: 0.8, maxHeight: 400, borderRadius: 28, overflow: 'hidden', backgroundColor: '#153F58' }, status: { gap: 6 },
  heading: { fontFamily: t.label, fontSize: 21, lineHeight: 27, color: c.text }, text: { fontFamily: t.family, fontSize: 16, lineHeight: 24, color: c.muted }, caption: { fontFamily: t.family, fontSize: 13, lineHeight: 19, color: c.muted }, error: { fontFamily: t.label, color: '#963C30', fontSize: 15 },
});
