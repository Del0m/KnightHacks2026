import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { PoseSkeleton } from './PoseSkeleton';
import type { PoseDetection } from './types';
import { isBasicModeSupported } from './basic';
import { usePoseOutput, type PoseEngine } from './usePoseOutput';
import { usePoseMode, type PoseModeState } from './usePoseMode';

type Size = { width: number; height: number };

/** The portrait app shows frames upright, so the short side is the width. */
const uprightSize = (r: Size | undefined): Size | null =>
  r ? { width: Math.min(r.width, r.height), height: Math.max(r.width, r.height) } : null;

/**
 * Debug screen: full-screen camera, live skeleton, and fps / latency / score / model / drop readout,
 * plus the pose mode, benchmark and cloud consent. Stands in for settings until a real screen exists:
 * it re-runs the benchmark, toggles consent, and on iPhone switches the preference between automatic
 * (YOLOv8) and Apple Vision (basic mode).
 */
export function PoseDebugScreen() {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (canRequestPermission) {
      requestPermission().catch((failure) => {
        if (active) setPermissionError(String(failure));
      });
    }
    return () => { active = false; };
  }, [canRequestPermission, requestPermission]);

  if (hasPermission) return <PoseCamera />;
  if (canRequestPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{permissionError ?? 'Waiting for camera access…'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text style={styles.message}>Spotter needs the camera to see your form.</Text>
      <Pressable style={styles.button} onPress={() => Linking.openSettings()}>
        <Text style={styles.buttonText}>Open Settings</Text>
      </Pressable>
    </View>
  );
}

function PoseCamera() {
  const poseMode = usePoseMode();
  const [position, setPosition] = useState<'front' | 'back'>('front');
  // The camera's detector would compete with the benchmark for the Neural Engine, so it is unmounted.
  if (poseMode.benchmarking) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Benchmarking…</Text>
      </View>
    );
  }
  return <LiveCamera poseMode={poseMode} position={position} setPosition={setPosition} />;
}

function LiveCamera({ poseMode, position, setPosition }: {
  poseMode: PoseModeState;
  position: 'front' | 'back';
  setPosition: Dispatch<SetStateAction<'front' | 'back'>>;
}) {
  const { mode, benchmark, size, preference, setPreference, cloudConsent, setCloudConsent, needsCloudConsent } = poseMode;
  const engine: PoseEngine = mode === 'vision' ? 'vision' : 'coreml';
  const device = useCameraDevice(position);
  const [detection, setDetection] = useState<PoseDetection | null>(null);
  const [viewSize, setViewSize] = useState<Size | null>(null);
  const [imageSize, setImageSize] = useState<Size | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // On a cold start `onConfigured` can fire before the resolution is known, so the first pose fills it in.
  const frameOutputRef = useRef<{ currentResolution?: Size } | null>(null);
  const onPose = useCallback((d: PoseDetection) => {
    setDetection(d);
    setImageSize((s) => s ?? uprightSize(frameOutputRef.current?.currentResolution));
  }, []);
  const { frameOutput, fps, error, model, dropped } = usePoseOutput({ engine, size, maxFps: 15, onPose });
  frameOutputRef.current = frameOutput;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  const flip = useCallback(() => {
    setDetection(null);
    setImageSize(null);
    setCameraError(null);
    setPosition((p) => (p === 'front' ? 'back' : 'front'));
  }, [setPosition]);

  const toggleEngine = useCallback(() => {
    setDetection(null);
    setPreference(preference === 'vision' ? 'auto' : 'vision');
  }, [preference, setPreference]);

  const onConfigured = useCallback(() => {
    setImageSize(uprightSize(frameOutput.currentResolution));
    setCameraError(null);
  }, [frameOutput]);

  const mirrored = position === 'front';
  const result = detection?.result;
  const benchmarkError = benchmark?.error ? `benchmark: ${benchmark.error}` : null;
  const banner = [error, cameraError, benchmarkError].filter(Boolean).join('\n');

  return (
    <View style={styles.container} onLayout={onLayout}>
      {device ? (
        <Camera
          style={[StyleSheet.absoluteFill, mirrored && styles.mirror]}
          device={device}
          isActive
          outputs={[frameOutput]}
          // Buffers stay unmirrored so joints keep anatomical left/right. The front preview is
          // mirrored by the `mirror` style, and the skeleton by `mirrored`.
          mirrorMode="off"
          orientationSource="interface"
          resizeMode="cover"
          onConfigured={onConfigured}
          onError={(e) => setCameraError(String(e))}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.message}>No {position} camera found.</Text>
        </View>
      )}

      {imageSize && viewSize ? (
        <PoseSkeleton result={result} imageSize={imageSize} viewSize={viewSize} mirrored={mirrored} fit="cover" />
      ) : null}

      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.readoutText}>
          fps {fps} · latency {detection ? detection.latencyMs.toFixed(1) : '–'} ms · score{' '}
          {result ? result.score.toFixed(2) : '–'}
        </Text>
        <Text style={styles.readoutText}>
          {model ?? 'no model'} · dropped {dropped}
        </Text>
        <Text style={styles.readoutText}>
          mode {mode} · consent {cloudConsent ? 'yes' : needsCloudConsent ? 'needed' : 'no'}
        </Text>
        <Text style={styles.readoutText}>
          benchmark {benchmark?.size ?? '–'} · p95 {benchmark?.p95Ms != null ? benchmark.p95Ms.toFixed(1) : '–'} ms ·{' '}
          {benchmark?.fps != null ? benchmark.fps.toFixed(1) : '–'} fps
        </Text>
      </View>

      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <Pressable style={[styles.button, styles.flip]} onPress={flip}>
        <Text style={styles.buttonText}>{position === 'front' ? 'Use back camera' : 'Use front camera'}</Text>
      </Pressable>

      {isBasicModeSupported(Platform.OS) ? (
        <Pressable testID="pose-engine-toggle" style={[styles.button, styles.engine]} onPress={toggleEngine}>
          <Text style={styles.buttonText}>{engine === 'coreml' ? 'Use Apple Vision' : 'Use Core ML'}</Text>
        </Pressable>
      ) : null}

      <Pressable
        testID="pose-rerun-benchmark"
        style={[styles.button, styles.rerun]}
        onPress={() => { poseMode.rerunBenchmark(); }}
      >
        <Text style={styles.buttonText}>Re-run benchmark</Text>
      </Pressable>

      <Pressable
        testID="pose-consent-toggle"
        style={[styles.button, styles.consent]}
        onPress={() => setCloudConsent(!cloudConsent)}
      >
        <Text style={styles.buttonText}>{cloudConsent ? 'Revoke cloud consent' : 'Allow cloud'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#000' },
  message: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  mirror: { transform: [{ scaleX: -1 }] },
  readout: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  readoutText: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },
  banner: {
    position: 'absolute',
    top: 160,
    left: 16,
    right: 16,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(200,0,0,0.85)',
  },
  bannerText: { color: '#fff', fontSize: 13 },
  button: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24, backgroundColor: '#fff' },
  flip: { position: 'absolute', bottom: 48, alignSelf: 'center' },
  engine: { position: 'absolute', bottom: 108, alignSelf: 'center' },
  rerun: { position: 'absolute', bottom: 168, alignSelf: 'center' },
  consent: { position: 'absolute', bottom: 228, alignSelf: 'center' },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },
});
