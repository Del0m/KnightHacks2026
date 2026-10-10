import { StatusBar } from 'expo-status-bar';
import { PoseDebugScreen } from './src/pose/PoseDebugScreen';

export default function App() {
  return (
    <>
      <PoseDebugScreen />
      <StatusBar style="light" />
    </>
  );
}
