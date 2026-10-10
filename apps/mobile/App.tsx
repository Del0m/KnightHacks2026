import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { PoseDebugScreen } from './src/pose/PoseDebugScreen';
import { startPoseBenchmark } from './src/pose/usePoseMode';

export default function App() {
  // Benchmarks once per model at launch; a no-op when the cached result is current.
  useEffect(() => {
    startPoseBenchmark();
  }, []);

  return (
    <>
      <PoseDebugScreen />
      <StatusBar style="light" />
    </>
  );
}
