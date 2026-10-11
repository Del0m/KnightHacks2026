import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { PoseSkeleton } from '@/pose/PoseSkeleton';
import { usePoseOutput } from '@/pose/usePoseOutput';
import type { PoseDetection } from '@/pose/types';
import { createPoseClock } from '@/engine/poseClock';
import { createFormEngine } from '@/engine/engine';
import { evaluateRep } from '@/engine/rules';
import type { EngineEvent } from '@/engine/types';
import { getSpec } from '@/engine/specs';
import { colors as c, typography as t } from '@/theme/tokens';
import { createCapture } from '../../../../../ml/labelling/src/capture';
import { EXERCISE_IDS, LABEL_VIEWS, type ConsentRecord, type DatasetClip, type ExerciseId, type RepAnnotation } from '../../../../../ml/labelling/src/contract';
import { coverage } from '../../../../../ml/labelling/src/coverage';
import { deleteAnnotation, saveAnnotation } from '../../../../../ml/labelling/src/annotation';
import { drafts, exportAndShare, newId, readConsents, saveConsent, shareConsentEvidence, withdrawParticipant } from './storage';

type Size = { width: number; height: number };
type Ready = { image: Size; model: string };
type Capture = ReturnType<typeof createCapture>;
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e);
const title = (id: string) => id.replaceAll('_', ' ');
function collectSuggestions(active: Capture, events: EngineEvent[]) {
  if (!events.some(event => event.type === 'rep_closed')) return;
  const clip = active.snapshot();
  const spec = getSpec(clip.exercise_id)!;
  for (const event of events) {
    if (event.type !== 'rep_closed') continue;
    const flags = evaluateRep(spec, event.rep, { view: clip.view }).outcomes.filter(item => item.status === 'flag').map(item => item.rule_id);
    active.addSuggestion(event.rep.startedAt, event.rep.closedAt, flags);
  }
}
function Button({ label, onPress, disabled = false, selected = false, testID }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} testID={testID} disabled={disabled} onPress={onPress} style={[s.button, selected && s.selected, disabled && s.disabled]}><Text style={[s.buttonText, selected && s.selectedText]}>{label}</Text></Pressable>;
}

export function LabellingScreen() {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [clips, setClips] = useState<DatasetClip[]>([]);
  const [selected, setSelected] = useState<DatasetClip | null>(null);
  const [exercise, setExercise] = useState<ExerciseId>('squat');
  const [view, setView] = useState<'front' | 'side'>('side');
  const [position, setPosition] = useState<'front' | 'back'>('back');
  const [side, setSide] = useState<DatasetClip['side']>('bilateral');
  const [context, setContext] = useState<DatasetClip['context']>('standard');
  const [ready, setReady] = useState<Ready | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Loading saved clips…');
  const capture = useRef<Capture | null>(null);
  const capturedReady = useRef<Ready | null>(null);
  const engine = useRef<ReturnType<typeof createFormEngine> | null>(null);
  const clock = useRef(createPoseClock());
  const started = useRef(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishing = useRef(false);
  const pendingStart = useRef<symbol | null>(null);
  const checkpointing = useRef(false);
  const consent = consents.find(item => item.status === 'active');
  const locked = busy || recording || countdown !== null;
  const report = coverage(clips, consents);

  useEffect(() => {
    let mounted = true;
    Promise.all([readConsents(), drafts.list()]).then(([registry, restored]) => {
      if (!mounted) return;
      setConsents(registry); setClips(restored.filter(clip => registry.some(item => item.reference === clip.consent.reference && item.status === 'active')));
      setMessage('Ready. Record a short rehearsal before collecting the dataset.');
    }).catch(e => { if (mounted) setMessage(messageOf(e)); }).finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);

  const cancelCountdown = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null; pendingStart.current = null; setCountdown(null);
  }, []);
  const finish = useCallback(async (reason: Exclude<DatasetClip['stop_reason'], null>) => {
    cancelCountdown();
    const active = capture.current;
    if (!active || finishing.current) return;
    finishing.current = true;
    if (engine.current) collectSuggestions(active, engine.current.endSet(clock.current.now()).events);
    const clip = active.stop(reason);
    capture.current = null; capturedReady.current = null; engine.current = null; setRecording(false); setBusy(true);
    setSelected(clip); setClips(previous => [...previous.filter(item => item.clip_id !== clip.clip_id), clip]);
    try { await drafts.save(clip); setMessage(`Saved ${clip.frames.length} joint frames${clip.status === 'incomplete' ? ' · interrupted clip; review only complete attempts' : ''}.`); }
    catch (e) { setMessage(`Save failed: ${messageOf(e)}. This clip remains on screen; retry saving before leaving.`); }
    finally { finishing.current = false; setBusy(false); }
  }, [cancelCountdown]);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); void finish('background'); };
  }, [finish]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      const active = state === 'active'; setForeground(active);
      if (!active) { setReady(null); void finish('background'); }
    });
    return () => subscription.remove();
  }, [finish]);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      const active = capture.current;
      if (!active) return;
      setElapsed(Math.min(60, Math.floor((Date.now() - started.current) / 1000)));
      active.tick();
      if (!active.active) { void finish(active.snapshot().stop_reason ?? 'limit'); return; }
      if (!checkpointing.current) {
        checkpointing.current = true;
        void drafts.save(active.snapshot()).catch(e => { setMessage(`Checkpoint failed: ${messageOf(e)}`); void finish('camera_error'); }).finally(() => { checkpointing.current = false; });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [recording, finish]);

  const onPose = useCallback((detection: PoseDetection) => {
    const active = capture.current;
    if (!active?.active) return;
    try {
      if (detection.result) clock.current.observe(detection.result.timestamp_ms);
      const now = clock.current.now();
      active.add(detection, now);
      if (!active.active) { void finish(active.snapshot().stop_reason ?? 'camera_error'); return; }
      const update = detection.result ? engine.current?.push(detection.result) : engine.current?.pushAbsent(now);
      collectSuggestions(active, update?.events ?? []);
    } catch (e) { setMessage(messageOf(e)); void finish('camera_error'); }
  }, [finish]);
  const onReady = useCallback((next: Ready | null) => {
    setReady(previous => previous?.model === next?.model && previous?.image.width === next?.image.width && previous?.image.height === next?.image.height ? previous : next);
    const active = capture.current;
    if (active?.active && (!next || next.image.width !== capturedReady.current?.image.width || next.image.height !== capturedReady.current?.image.height || next.model !== capturedReady.current?.model)) void finish('mode_change');
  }, [finish]);

  async function grant() {
    setBusy(true);
    const evidence: ConsentRecord = { reference: newId('consent'), participant_id: newId('participant'), version: 'joint-capture-v1', granted_at: new Date().toISOString(), purpose: 'private_model_development', status: 'active', publication_allowed: false };
    try { await saveConsent(evidence); setConsents(previous => [...previous, evidence]); setMessage('Consent saved privately. Keep other people out of frame.'); }
    catch (e) { setMessage(messageOf(e)); }
    finally { setBusy(false); }
  }
  function start() {
    if (!ready || !consent || locked) return;
    setSelected(null); setCountdown(3); setMessage('Get into position. Recording starts after the countdown.');
    let remaining = 3;
    countdownTimer.current = setInterval(() => {
      remaining--;
      if (remaining > 0) { setCountdown(remaining); return; }
      cancelCountdown(); setBusy(true);
      const token = Symbol('capture-start'); pendingStart.current = token;
      const fresh = createCapture({ schema_version: 1, clip_id: newId('clip'), session_id: newId('session'), participant_id: consent.participant_id, exercise_id: exercise, view, camera_position: position, side, context, image: ready.image, source: 'coreml', model: ready.model, origin: 'recorded', consent: { reference: consent.reference, version: consent.version, allowed_use: true, purpose: consent.purpose } }, consent);
      // Persist the empty session header before accepting any detection callbacks.
      void drafts.save(fresh.snapshot()).then(() => {
        if (AppState.currentState !== 'active' || pendingStart.current !== token) return;
        pendingStart.current = null; capturedReady.current = ready; capture.current = fresh; clock.current = createPoseClock();
        engine.current = createFormEngine(getSpec(exercise)!, { imageAspect: ready.image.width / ready.image.height });
        started.current = Date.now(); setElapsed(0); setRecording(true); setMessage('Recording joints. Return to rest after the final rep, then Stop.');
      }).catch(e => { pendingStart.current = null; setMessage(messageOf(e)); }).finally(() => setBusy(false));
    }, 1000);
  }
  async function persist(updated: DatasetClip) {
    setBusy(true);
    try {
      await drafts.save(updated); setSelected(updated); setClips(previous => [...previous.filter(item => item.clip_id !== updated.clip_id), updated]); setMessage('Review saved.');
    } catch (e) { setMessage(`Save failed: ${messageOf(e)}`); throw e; }
    finally { setBusy(false); }
  }
  async function share() {
    setBusy(true);
    try { await exportAndShare(clips, consents); setMessage('Share sheet closed. Validate the received bundle on your Mac to confirm transfer.'); }
    catch (e) { setMessage(messageOf(e)); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (!consent) return;
    setBusy(true);
    try { await withdrawParticipant(consent.participant_id); setConsents(await readConsents()); setClips(await drafts.list()); setSelected(null); setMessage('Local participant data and managed exports deleted. Delete copies on your Mac separately.'); }
    catch (e) { setMessage(messageOf(e)); }
    finally { setBusy(false); }
  }

  return <LinearGradient colors={['#F7FCFF', '#E4F5FE']} style={s.page}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Button label="Back" onPress={() => { void finish('background'); router.back(); }} disabled={busy} />
    <Text style={s.brand}>SPOTTER</Text><Text style={s.heading}>Joint labelling</Text>
    <Text style={s.text}>Private, on-device capture · self-reviewed demonstration dataset</Text>
    <Text style={s.status} accessibilityLiveRegion="polite">{message}</Text>
    {!selected && <>
      <Text style={s.text}>Only joints are saved. No video, photos or audio. Consent covers private model development and evaluation; publication is off. Record only yourself with no bystanders.</Text>
      {!consent ? <Button testID="labelling-consent" label="I consent · save private capture consent" onPress={() => { void grant(); }} disabled={locked} /> : <Text style={s.text}>Private consent saved · reviewer: you</Text>}
      <Text style={s.label}>Exercise</Text><View style={s.wrap}>{EXERCISE_IDS.map(id => <Button key={id} label={title(id)} selected={exercise === id} disabled={locked} onPress={() => { setExercise(id); setView(id === 'shoulder_press' ? 'front' : 'side'); }} />)}</View>
      <Text style={s.label}>View and camera</Text><View style={s.wrap}>{(['side', 'front'] as const).map(value => <Button key={value} label={`${value} view`} selected={view === value} disabled={locked} onPress={() => setView(value)} />)}<Button label={`${position} camera · switch`} disabled={locked} onPress={() => { setReady(null); setPosition(value => value === 'back' ? 'front' : 'back'); }} /></View>
      <Text style={s.label}>Working / lead side</Text><View style={s.wrap}>{(['bilateral', 'left', 'right'] as const).map(value => <Button key={value} label={value} selected={side === value} disabled={locked} onPress={() => setSide(value)} />)}</View>
      <Text style={s.label}>Movement context</Text><View style={s.wrap}>{(['standard', 'modified', 'prescribed'] as const).map(value => <Button key={value} label={value} selected={context === value} disabled={locked} onPress={() => setContext(value)} />)}</View>
      <Text style={s.text}>Prescribed limits are retained for review and excluded from general training. Labels describe visible movement, not a diagnosis.</Text>
      {foreground && focused && Platform.OS === 'ios' ? <CaptureCamera key={position} position={position} onPose={onPose} onReady={onReady} onFailure={() => { void finish('camera_error'); }} /> : <Text style={s.text}>Capture is available on your foreground iPhone app.</Text>}
      <Text style={s.label}>{countdown !== null ? `Starting in ${countdown}…` : recording ? `${elapsed}s / 60s · joints recording` : 'Three-second countdown · 60-second limit'}</Text>
      {recording ? <Button label="Stop and review" onPress={() => { void finish('manual'); }} /> : <Button testID="labelling-start" label="Start joint capture" disabled={locked || !consent || !ready || !foreground || !focused} onPress={start} />}
      {countdown !== null && <Button label="Cancel countdown" onPress={cancelCountdown} />}
    </>}
    {selected && <><Review key={selected.clip_id} clip={selected} busy={busy} onSave={persist} onError={setMessage} /><Button label="Retry saving this clip" disabled={busy} onPress={() => { void persist(selected).catch(() => {}); }} /><Button label="New capture" disabled={busy} onPress={() => { setSelected(null); setReady(null); }} /></>}
    <Text style={s.heading}>Accepted coverage · {report.total} / 200</Text>
    <Text style={s.text}>{EXERCISE_IDS.map(id => `${title(id)}: ${report.by_exercise[id]}/40`).join('\n')}</Text>
    <Text style={s.text}>{report.complete ? 'Numeric collection gate met. Consent evidence and phone pilot are still required.' : 'Uncertain, discarded, synthetic and prescribed-context reps do not count.'}</Text>
    {clips.map(clip => <Button key={clip.clip_id} label={`${title(clip.exercise_id)} · ${clip.annotations.filter(a => a.state === 'accepted').length} reviewed accepted · ${clip.frames.length} frames`} disabled={locked} onPress={() => setSelected(clip)} />)}
    <Button label="Export and share dataset bundle" disabled={locked || clips.length === 0} onPress={() => { void share(); }} />
    <Button label="Share private consent evidence to Mac" disabled={locked || !consent} onPress={() => { setBusy(true); void shareConsentEvidence().then(() => setMessage('Private evidence share sheet closed. Keep this file private.')).catch(e => setMessage(messageOf(e))).finally(() => setBusy(false)); }} />
    <Button label="Withdraw and delete my local data" disabled={locked || !consent} onPress={() => Alert.alert('Delete your local AI-09 data?', 'Linked local clips and exports will be deleted. Copies already shared must be deleted separately.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void withdraw(); } }])} />
  </ScrollView></LinearGradient>;
}

function CaptureCamera({ position, onPose, onReady, onFailure }: { position: 'front' | 'back'; onPose: (d: PoseDetection) => void; onReady: (value: Ready | null) => void; onFailure: () => void }) {
  const permission = useCameraPermission();
  if (!permission.hasPermission) return <View><Text style={s.text}>Camera permission is required.</Text><Button label="Allow camera" onPress={() => { void (permission.canRequestPermission ? permission.requestPermission() : Linking.openSettings()); }} /></View>;
  return <LiveCamera position={position} onPose={onPose} onReady={onReady} onFailure={onFailure} />;
}
function LiveCamera({ position, onPose, onReady, onFailure }: { position: 'front' | 'back'; onPose: (d: PoseDetection) => void; onReady: (value: Ready | null) => void; onFailure: () => void }) {
  const device = useCameraDevice(position);
  const [result, setResult] = useState<PoseDetection['result']>();
  const [image, setImage] = useState<Size | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const outputRef = useRef<{ currentResolution?: Size } | null>(null);
  const mounted = useRef(true);
  const output = usePoseOutput({ engine: 'coreml', size: 320, maxFps: 15, onPose: d => {
    if (!mounted.current) return;
    setResult(d.result); resolution(); onPose(d);
  } });
  useLayoutEffect(() => { outputRef.current = output.frameOutput; }, [output.frameOutput]);
  function resolution() {
    const value = outputRef.current?.currentResolution;
    if (value && output.model && !output.error) {
      const upright = { width: Math.min(value.width, value.height), height: Math.max(value.width, value.height) };
      setImage(previous => previous?.width === upright.width && previous.height === upright.height ? previous : upright);
      onReady({ image: upright, model: output.model });
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onReady(null); };
  }, [onReady]);
  useEffect(() => { if (output.error || !device) { onReady(null); onFailure(); } }, [output.error, device, onReady, onFailure]);
  return <View><View style={s.camera} onLayout={e => setSize(e.nativeEvent.layout)}>
    {device && <Camera style={[StyleSheet.absoluteFill, position === 'front' && s.mirror]} device={device} isActive outputs={[output.frameOutput]} mirrorMode="off" orientationSource="interface" resizeMode="contain" onConfigured={resolution} onError={() => { onReady(null); onFailure(); }} />}
    {image && size && <PoseSkeleton result={result} imageSize={image} viewSize={size} mirrored={position === 'front'} fit="contain" />}
  </View><Text style={s.text}>Core ML 320 · {output.fps} fps · {output.dropped} dropped{output.error ? ` · ${output.error}` : ''}</Text></View>;
}

function Review({ clip, busy, onSave, onError }: { clip: DatasetClip; busy: boolean; onSave: (clip: DatasetClip) => Promise<void>; onError: (text: string) => void }) {
  const [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const [start, setStart] = useState('0'), [end, setEnd] = useState(String(clip.frames.length));
  const [labels, setLabels] = useState<string[]>([]), [primary, setPrimary] = useState<string | null>(null);
  const [state, setState] = useState<RepAnnotation['state']>('uncertain');
  const [repId, setRepId] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<RepAnnotation['boundary_provenance']>('manual');
  const [saved, setSaved] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    if (!playing || !clip.frames.length) return;
    const origin = Date.now() - clip.frames[frame]?.timestamp_ms;
    const timer = setInterval(() => {
      const time = Date.now() - origin;
      const next = clip.frames.findIndex(item => item.timestamp_ms > time);
      if (next < 0) { setFrame(clip.frames.length - 1); setPlaying(false); } else setFrame(Math.max(0, next - 1));
    }, 33);
    return () => clearInterval(timer);
    // frame is the starting point; changes while playing must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clip]);
  function scrub(value: number) { setPlaying(false); setFrame(Math.max(0, Math.min(clip.frames.length - 1, value || 0))); }
  function pick(a?: RepAnnotation, suggestion?: DatasetClip['suggestions'][number]) {
    setRepId(a?.rep_id ?? null); setStart(String(a?.start_frame ?? suggestion?.start_frame ?? frame)); setEnd(String(a?.end_frame ?? suggestion?.end_frame ?? Math.min(frame + 1, clip.frames.length)));
    setLabels(a?.human_labels ?? []); setPrimary(a?.primary_label ?? null); setState(a?.state ?? 'uncertain'); setSaved(!!a); setProvenance(a?.boundary_provenance ?? (suggestion ? 'engine' : 'manual'));
  }
  function changed(boundary = false) { setSaved(false); if (boundary && provenance === 'engine') setProvenance('engine_adjusted'); }
  async function save() {
    try {
      const annotation: RepAnnotation = { rep_id: repId ?? newId('rep'), start_frame: Number(start), end_frame: Number(end), state, human_labels: labels, primary_label: primary, reviewer_id: clip.participant_id, reviewed_at: new Date().toISOString(), boundary_provenance: provenance, revision: 1 };
      const updated = saveAnnotation(clip, annotation); await onSave(updated); setRepId(annotation.rep_id); setSaved(true);
    } catch (e) { onError(messageOf(e)); }
  }
  const current = clip.frames[frame];
  const pose = current && !('absent' in current) ? { source: clip.source, model: clip.model, timestamp_ms: current.timestamp_ms, score: current.score, joints: current.joints } : undefined;
  const validLabels = Object.entries(LABEL_VIEWS[clip.exercise_id]).filter(([, labelView]) => labelView === 'any' || labelView === clip.view).map(([label]) => label);
  const suggestions = saved ? clip.suggestions.filter(a => a.start_frame < Number(end) && a.end_frame > Number(start)) : [];
  return <View style={s.group}><Text style={s.heading}>Review {title(clip.exercise_id)}</Text><Text style={s.text}>{clip.view} view · {clip.context} · {clip.side} · {clip.status}</Text>
    <View style={s.camera} onLayout={e => setSize(e.nativeEvent.layout)}>{size && <PoseSkeleton result={pose} imageSize={clip.image} viewSize={size} mirrored={false} fit="contain" />}</View>
    <Text style={s.label}>Frame {frame} / {Math.max(0, clip.frames.length - 1)} · {current?.timestamp_ms ?? 0} ms · {pose ? `person confidence ${pose.score.toFixed(2)} · ${pose.joints.filter(j => j.c >= .3).length}/17 visible joints` : 'No person'}</Text>
    <View style={s.wrap}><Button label={playing ? 'Pause' : 'Play'} disabled={!clip.frames.length} onPress={() => { if (!playing && frame >= clip.frames.length - 1) setFrame(0); setPlaying(!playing); }} /><Button label="−15 frames" onPress={() => scrub(frame - 15)} /><Button label="−1" onPress={() => scrub(frame - 1)} /><Button label="+1" onPress={() => scrub(frame + 1)} /><Button label="+15 frames" onPress={() => scrub(frame + 15)} /></View>
    <TextInput editable={!busy} style={s.input} accessibilityLabel="Scrub to frame" keyboardType="number-pad" value={String(frame)} onChangeText={value => scrub(Number(value))} />
    <Text style={s.text}>Review the motion first. Clean means no visible errors in this view. Hidden errors remain unassessed. Add partial attempts even if the counter missed them.</Text>
    <Button label="Add manual rep at current frame" disabled={busy || !clip.frames.length} onPress={() => pick()} />
    {clip.suggestions.map((a, i) => <Button key={i} label={`Suggested rep ${i + 1}: [${a.start_frame}, ${a.end_frame})`} disabled={busy} onPress={() => pick(undefined, a)} />)}
    {clip.annotations.map(a => <Button key={a.rep_id} label={`${a.state}: [${a.start_frame}, ${a.end_frame}) · ${a.human_labels.join(', ') || 'unlabelled'}`} disabled={busy} onPress={() => pick(a)} />)}
    <Text style={s.label}>Rep boundaries · start included, end excluded</Text>
    <TextInput editable={!busy} style={s.input} accessibilityLabel="Start frame inclusive" keyboardType="number-pad" value={start} onChangeText={value => { setStart(value); changed(true); }} />
    <TextInput editable={!busy} style={s.input} accessibilityLabel="End frame exclusive" keyboardType="number-pad" value={end} onChangeText={value => { setEnd(value); changed(true); }} />
    <View style={s.wrap}><Button label="Set start here" disabled={busy} onPress={() => { setStart(String(frame)); changed(true); }} /><Button label="Set end after this frame" disabled={busy} onPress={() => { setEnd(String(frame + 1)); changed(true); }} /></View>
    <Text style={s.label}>Human labels</Text><View style={s.wrap}>{validLabels.map(label => <Button key={label} label={title(label)} selected={labels.includes(label)} disabled={busy} onPress={() => {
      const next = label === 'clean' ? (labels.includes('clean') ? [] : ['clean']) : labels.includes(label) ? labels.filter(item => item !== label) : [...labels.filter(item => item !== 'clean'), label];
      setLabels(next); setPrimary(next.length === 1 ? next[0] : null); changed();
    }} />)}</View>
    {labels.length > 1 && <><Text style={s.label}>Choose one primary label</Text><View style={s.wrap}>{labels.map(label => <Button key={label} label={title(label)} selected={primary === label} disabled={busy} onPress={() => { setPrimary(label); changed(); }} />)}</View></>}
    <Text style={s.label}>Review decision</Text><View style={s.wrap}>{(['accepted', 'uncertain', 'discard'] as const).map(value => <Button key={value} label={value} selected={state === value} disabled={busy} onPress={() => { setState(value); changed(); }} />)}</View>
    <Button label={saved ? 'Review saved · save changes' : 'Save human review'} disabled={busy || !clip.frames.length} onPress={() => { void save(); }} />
    {repId && <Button label="Delete this interval" disabled={busy} onPress={() => { void onSave(deleteAnnotation(clip, repId)).then(() => pick()).catch(e => onError(messageOf(e))); }} />}
    {saved && <Text style={s.text}>Automatic rule suggestions after your saved review: {suggestions.flatMap(a => a.rule_flags).join(', ') || 'No flags available; this does not establish clean form.'}</Text>}
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 24, paddingTop: 60, paddingBottom: 80, gap: 14 }, group: { gap: 14 },
  brand: { fontFamily: t.display, fontSize: 38, color: c.primary }, heading: { fontFamily: t.strong, fontSize: 25, color: c.text },
  text: { fontFamily: t.family, fontSize: 16, lineHeight: 23, color: c.muted }, label: { fontFamily: t.label, fontSize: 17, color: c.text }, status: { fontFamily: t.label, fontSize: 16, color: c.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  buttonText: { fontFamily: t.label, fontSize: 16, color: c.primary, textTransform: 'capitalize' }, selected: { backgroundColor: c.primary }, selectedText: { color: '#FFFFFF' }, disabled: { opacity: .4 },
  camera: { height: 300, width: '100%', backgroundColor: '#153F58', borderRadius: 16, overflow: 'hidden' }, mirror: { transform: [{ scaleX: -1 }] },
  input: { backgroundColor: c.surface, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, fontFamily: t.family, fontSize: 17 },
});
