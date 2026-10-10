import Slider from '@react-native-community/slider';
import { Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { TabSwipeBoundary } from './SwipeTabs';
import { colors, typography } from '@/theme/tokens';

export function RotationSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <TabSwipeBoundary><View style={{ borderRadius: 22, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, borderWidth: 1, borderColor: colors.border }}>
    <GlassSurface radius={22} />
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontFamily: typography.label, fontSize: 13 }}>Rotate figure</Text><Text style={{ color: colors.muted, fontFamily: typography.family, fontSize: 13 }}>{Math.round(value)}°</Text></View>
    <Slider testID="model-rotation" accessibilityLabel="Rotate figure" minimumValue={-180} maximumValue={180} step={1} value={value} onValueChange={onChange} minimumTrackTintColor={colors.primary} maximumTrackTintColor="#C7DEE9" thumbTintColor={colors.primary} tapToSeek style={{ width: '100%', height: 44 }} />
  </View></TabSwipeBoundary>;
}
