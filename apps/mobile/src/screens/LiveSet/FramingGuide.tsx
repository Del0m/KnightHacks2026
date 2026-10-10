import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** A fixed full-body target, independent of detector geometry. Status text lives below the preview. */
export function FramingGuide({ ready }: { ready: boolean }) {
  const stroke = ready ? '#43DC98' : '#FFFFFF';
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width="100%" height="100%" viewBox="0 0 300 480" preserveAspectRatio="none">
      <Rect x="24" y="38" width="252" height="404" rx="28" stroke={stroke} strokeWidth={ready ? 4 : 2} strokeDasharray={ready ? undefined : '10 8'} fill="none" />
      <Circle cx="150" cy="99" r="24" fill="none" stroke={stroke} strokeWidth="2" opacity="0.7" />
      <Path d="M132 132 Q150 124 168 132 L184 214 Q188 228 197 232 L216 208 M132 132 L116 214 Q112 228 103 232 L84 208 M132 132 L123 270 L125 370 L110 407 M168 132 L177 270 L175 370 L190 407 M123 270 L177 270" stroke={stroke} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.6" />
    </Svg>
  </View>;
}
