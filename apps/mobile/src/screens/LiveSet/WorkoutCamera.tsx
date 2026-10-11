import { createSetRecorder } from '@/engine/setRecord';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { usePoseMode, startPoseBenchmark } from '@/pose/usePoseMode';
import { usePoseOutput, type PoseEngine } from '@/pose/usePoseOutput';
import { PoseSkeleton } from '@/pose/PoseSkeleton';
import type { PoseDetection } from '@/pose/types';
import { useFormEngine } from '@/engine/useFormEngine';
import { useFormRules } from '@/engine/useFormRules';
import type { ExerciseSpec } from '@/engine/types';
import type { WorkoutSet } from '@/services/workoutApi';
import { GlassChoice } from '@/components/GlassChoice';
import { ui } from '@/components/AppPage';
import { useTorchPulse } from './useTorchPulse';
import { setFeedback, type SetFeedback } from './setRecord';

type Props = { setIndex?: number; onFinishing?: () => void; manualLabel?: string; initialPosition?: 'front' | 'back'; spec: ExerciseSpec; onComplete: (record: WorkoutSet, feedback: SetFeedback, inferenceMode: PoseEngine) => void; onManual: () => void; baseline: number };
export default function WorkoutCamera(props: Props) {
  if (Platform.OS !== 'ios') return <Fallback label={props.manualLabel} onManual={props.onManual} message="Camera rep tracking is available in the iPhone app." />;
  return <PermissionCamera {...props} />;
}
function PermissionCamera(props: Props) {
  const permission = useCameraPermission();
  const mode = usePoseMode();
  useEffect(() => { void startPoseBenchmark(); }, []);
  const [error, setError] = useState(false);
  if (!permission.hasPermission) return <View style={s.group}><Text style={ui.heading}>Allow camera access</Text>{error && <Text style={ui.muted}>Could not open camera access. Try again.</Text>}<GlassChoice primary label={permission.canRequestPermission ? 'Allow camera' : 'Open camera settings'} onPress={() => { void (permission.canRequestPermission ? permission.requestPermission() : Linking.openSettings()).catch(() => setError(true)); }} /><GlassChoice compact label={props.manualLabel ?? "Track manually"} onPress={props.onManual} /></View>;
  if (mode.mode === 'pending') return <Text style={ui.muted}>Preparing camera tracking…</Text>;
  if (mode.mode !== 'coreml' && mode.mode !== 'vision') return <Fallback label={props.manualLabel} onManual={props.onManual} message="Camera tracking is unavailable on this device. You can still log your reps." />;
  return <TrackedCamera {...props} engine={mode.mode} size={mode.size} />;
}
function Fallback({ message, onManual, label = 'Track manually' }: { message: string; onManual: () => void; label?: string }) { return <View style={s.group}><Text style={ui.muted}>{message}</Text><GlassChoice compact label={label} onPress={onManual} /></View>; }
function TrackedCamera({ spec, engine, size, onComplete, onManual, onFinishing, baseline, initialPosition, setIndex = 0, manualLabel = 'Track manually' }: Props & { engine: PoseEngine; size: 320 | 256 }) {
  const [position, setPosition] = useState<'front' | 'back'>(initialPosition ?? 'front');
  const device = useCameraDevice(position);
  const [detection, setDetection] = useState<PoseDetection | null>(null);
  const [view, setView] = useState<{ width: number; height: number } | null>(null), [image, setImage] = useState<{ width: number; height: number } | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active'), [focused, setFocused] = useState(true), [cameraError, setCameraError] = useState(false);
  const pulse = useTorchPulse(position === 'back' && Boolean(device?.hasTorch) && active && focused && !cameraError);
  const completed = useRef(false), lastFrame = useRef(0), resolution = useRef<{ currentResolution?: { width: number; height: number } } | null>(null);
  const capture = useMemo(() => createSetRecorder(spec, { setIndex }), [spec, setIndex]);
  const rules = useFormRules(spec, { onSetFlags: summary => {
    if (completed.current || summary.total_reps === 0) return;
    completed.current = true; onFinishing?.();
    const record = capture.finish(summary), feedback = setFeedback(spec, summary, baseline);
    pulse.signal(() => onComplete(record, feedback, engine));
  } });
  const form = useFormEngine(spec, { imageAspect: image ? image.width / image.height : undefined, onEvent: event => { capture.event(event); rules.onEvent(event); } });
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setActive(state === 'active')); return () => subscription.remove(); }, []);
  const running = active && focused && (!form.ended || pulse.flashing) && !cameraError;
  const output = usePoseOutput({ engine, size, maxFps: 15, onPose: d => {
    if (!running || completed.current) return;
    lastFrame.current = Date.now(); setDetection(d);
    const r = resolution.current?.currentResolution;
    if (r && !image) setImage({ width: Math.min(r.width, r.height), height: Math.max(r.width, r.height) });
    if (d.result) capture.pose(d.result);
    form.onPose(d);
  } });
  useLayoutEffect(() => { resolution.current = output.frameOutput; }, [output.frameOutput]);
  // Preserve a counted set if the app backgrounds; never count unseen movement on resume.
  const { repCount, endSet } = form;
  useEffect(() => { if ((!active || !focused) && repCount > 0 && !completed.current) endSet(); }, [active, focused, repCount, endSet]);
  const [stale, setStale] = useState(false);
  useEffect(() => { const timer = setInterval(() => setStale(lastFrame.current > 0 && Date.now() - lastFrame.current > 1500), 500); return () => clearInterval(timer); }, []);
  if (!device) return <Fallback label={manualLabel} message="This camera is unavailable." onManual={onManual} />;
  const interrupted = cameraError || output.error || form.error || rules.error;
  return <View style={s.group}>
    <Text style={ui.muted}>{spec.recommended_view === 'side' ? 'Film from your side.' : 'Face the camera.'}</Text>
    <View style={s.preview} onLayout={e => setView(e.nativeEvent.layout)}>
      <Camera style={[StyleSheet.absoluteFill, position === 'front' && { transform: [{ scaleX: -1 }] }]} device={device} outputs={[output.frameOutput]} isActive={running} torchMode={pulse.torchMode} mirrorMode="off" orientationSource="interface" resizeMode="cover" onError={() => setCameraError(true)} />
      {!stale && image && view && <PoseSkeleton result={detection?.result} imageSize={image} viewSize={view} mirrored={position === 'front'} fit="cover" highlight={rules.tintJoints} />}
      <View pointerEvents="none" style={s.counter}><Text style={s.count} testID="live-rep-count">{form.repCount}</Text><Text style={s.label}>REPS</Text></View>
    </View>
    {!!interrupted && <Text style={ui.muted}>Tracking interrupted. Finish your counted reps or switch to manual tracking.</Text>}
    {!interrupted && (!detection?.result || stale) && <Text style={ui.muted}>Keep your whole body in view.</Text>}
    <GlassChoice primary label="Done with set" disabled={form.repCount === 0 || form.ended} onPress={form.endSet} />
    {form.repCount === 0 && <GlassChoice compact label={position === 'front' ? 'Use back camera' : 'Use front camera'} onPress={() => { setPosition(p => p === 'front' ? 'back' : 'front'); setDetection(null); setImage(null); lastFrame.current = 0; setCameraError(false); capture.reset(); form.reset(); rules.reset(); }} />}
    <GlassChoice compact label={manualLabel} disabled={form.ended || pulse.flashing} onPress={() => { if (!completed.current) onManual(); }} />
  </View>;
}
const s = StyleSheet.create({ group: { gap: 12 }, preview: { height: 430, borderRadius: 28, overflow: 'hidden', backgroundColor: '#153F58' }, counter: { position: 'absolute', top: 18, left: 18, minWidth: 96, alignItems: 'center', borderRadius: 24, padding: 14, backgroundColor: 'rgba(15,38,52,.65)' }, count: { color: '#FFFFFF', fontSize: 60, fontWeight: '700', fontVariant: ['tabular-nums'] }, label: { color: '#FFFFFF', fontSize: 13, letterSpacing: 2 } });
