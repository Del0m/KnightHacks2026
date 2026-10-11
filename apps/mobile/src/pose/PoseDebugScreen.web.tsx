import { Text } from 'react-native';
import { AppPage, ui } from '@/components/AppPage';
/** Keep the developer camera route from importing native camera modules into web rendering. */
export function PoseDebugScreen() {
  return <AppPage title="Camera"><Text style={ui.muted}>Open the iPhone app to inspect live pose tracking.</Text></AppPage>;
}
