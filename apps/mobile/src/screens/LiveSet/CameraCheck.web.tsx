import { StyleSheet, Text, View } from 'react-native';
import { GlassChoice } from '@/components/GlassChoice';
import { colors as c, typography as t } from '@/theme/tokens';

export default function CameraCheck({ onContinue }: { exercise: string; onContinue: (mode?: 'camera' | 'manual') => void }) {
  return <View style={s.group}><Text style={s.heading}>Check your framing on iPhone.</Text><Text style={s.text}>Live framing requires the iPhone app. Continue with manual tracking here.</Text><GlassChoice label="Continue with manual tracking" onPress={() => onContinue('manual')} primary selected /></View>;
}
const s = StyleSheet.create({ group: { gap: 16 }, heading: { fontFamily: t.label, fontSize: 21, color: c.text }, text: { fontFamily: t.family, fontSize: 16, lineHeight: 24, color: c.muted } });
