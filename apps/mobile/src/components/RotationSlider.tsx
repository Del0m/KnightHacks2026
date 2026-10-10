import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { TabSwipeBoundary } from './SwipeTabs';
import { colors, typography } from '@/theme/tokens';

export function RotationSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [held, setHeld] = useState(false), [width, setWidth] = useState(0);
  const thumbX = 14 + Math.max(0, width - 28) * (value + 180) / 360;
  return <TabSwipeBoundary><View style={{ borderRadius: 22, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, borderWidth: 1, borderColor: colors.border }}>
    <GlassSurface radius={22} />
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.text, fontFamily: typography.label, fontSize: 13 }}>Rotate figure</Text><Text style={{ color: colors.muted, fontFamily: typography.family, fontSize: 13 }}>{Math.round(value)}°</Text></View>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ position: 'relative' }}>
    <Slider testID="model-rotation" accessibilityLabel="Rotate figure" minimumValue={-180} maximumValue={180} step={1} value={value} onValueChange={onChange} minimumTrackTintColor="#D5E2E8" maximumTrackTintColor="#D5E2E8" onSlidingStart={() => setHeld(true)} onSlidingComplete={() => setHeld(false)} tapToSeek style={{ width: '100%', height: 44 }} />
    {!held && width > 0 && <Text pointerEvents="none" accessible={false} aria-hidden style={{ position: 'absolute', left: thumbX - 14, top: 8, width: 28, height: 28, textAlign: 'center', lineHeight: 28, fontSize: 23, color: colors.text }}>↔</Text>}
    </View>
  </View></TabSwipeBoundary>;
}
