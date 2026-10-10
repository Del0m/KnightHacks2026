import { useEffect, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { PolishedPressable } from './PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { colors, typography } from '@/theme/tokens';
export type ExerciseTab = 'workout' | 'practice';
export function ExerciseTabs({ value, onChange }: { value: ExerciseTab; onChange: (value: ExerciseTab) => void }) {
  const reduced = useReducedMotion(), [width, setWidth] = useState(0), [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const toValue = value === 'practice' ? (width - 8) / 2 : 0;
    if (reduced !== false) { slide.setValue(toValue); return; }
    const spring = Animated.spring(slide, { toValue, stiffness: 330, damping: 27, mass: .8, useNativeDriver: Platform.OS !== 'web' });
    spring.start(); return () => spring.stop();
  }, [value, width, slide, reduced]);
  return <View accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', borderRadius: 22, padding: 4, minHeight: 52 }}>
    <GlassSurface radius={22} />
    {width > 8 && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: (width - 8) / 2, borderRadius: 18, transform: [{ translateX: slide }] }}><GlassSurface tint="#C8E8FA" colored radius={18} /></Animated.View>}
    {(['workout', 'practice'] as const).map(tab => <PolishedPressable key={tab} accessibilityRole="tab" aria-selected={value === tab} accessibilityState={{ selected: value === tab }} onPress={() => onChange(tab)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 18 }}><Text style={{ color: value === tab ? colors.text : colors.muted, fontFamily: value === tab ? typography.strong : typography.label, fontSize: 16 }}>{tab === 'workout' ? 'Today’s Workout' : 'Practice'}</Text></PolishedPressable>)}
  </View>;
}
