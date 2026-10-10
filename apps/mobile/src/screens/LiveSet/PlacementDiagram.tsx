import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { colors as c, typography as t } from '@/theme/tokens';

export function PlacementDiagram({ sideOn }: { sideOn: boolean }) {
  return <View style={s.figure} accessible accessibilityLabel={`Place your phone about eight feet from your exercise spot${sideOn ? ', beside you for a side view' : ', facing you'}.`}>
    <Svg width="100%" height="175" viewBox="0 0 340 175" aria-hidden>
      <Circle cx="71" cy="78" r="48" fill="#E1F0F8" /><Circle cx="71" cy="61" r="11" stroke={c.primary} strokeWidth="2.5" fill="white" />
      <Path d={sideOn ? 'M70 74 L70 101 L57 119 M70 101 L85 119 M70 81 L86 91' : 'M71 74 L71 101 M53 91 L71 80 L89 91 M56 119 L71 101 L86 119'} stroke={c.primary} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M263 63 L123 31 L123 123 L263 91 Z" fill="#D4EAF7" opacity="0.6" />
      <Rect x="263" y="50" width="31" height="58" rx="8" stroke={c.text} strokeWidth="2.5" fill="white" />
      <Circle cx="279" cy="58" r="2.5" fill={c.primary} /><Line x1="279" x2="279" y1="109" y2="129" stroke={c.text} strokeWidth="2" />
      <Path d="M268 138 L279 128 L290 138" stroke={c.text} strokeWidth="2" fill="none" />
      <Line x1="126" y1="149" x2="252" y2="149" stroke={c.primary} strokeWidth="1.5" strokeDasharray="4 5" />
      <Path d="M133 144 L126 149 L133 154 M245 144 L252 149 L245 154" stroke={c.primary} fill="none" />
    </Svg>
    <View style={s.labels}><Text style={s.label}>Your spot</Text><Text style={s.distance}>≈ 8 ft</Text><Text style={s.label}>Your phone</Text></View>
  </View>;
}
const s = StyleSheet.create({ figure: { paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border }, labels: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, label: { fontFamily: t.label, fontSize: 14, color: c.muted }, distance: { fontFamily: t.strong, fontSize: 18, color: c.primary } });
