import { useEffect, useState } from 'react';
import { Animated, Easing, Text } from 'react-native';
import { PolishedPressable } from './PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { typography } from '@/theme/tokens';

export function ExerciseMenu({ open, onPractice }: { open: boolean; onPractice: () => void }) {
  const reduced = useReducedMotion(), [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced !== false) { progress.setValue(open ? 1 : 0); return; }
    const tween = Animated.timing(progress, { toValue: open ? 1 : 0, duration: open ? 240 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    tween.start(); return () => tween.stop();
  }, [open, progress, reduced]);
  return <Animated.View aria-hidden={!open} pointerEvents={open ? 'auto' : 'none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} style={{ height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 52] }), overflow: 'hidden', opacity: progress }}>
    <Animated.View style={{ paddingBottom: 8, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
      <PolishedPressable accessibilityRole="button" accessibilityLabel="Practice Form" disabled={!open} onPress={onPractice} style={{ minHeight: 44, paddingLeft: 40, justifyContent: 'center', alignItems: 'flex-start' }}>
        <Text style={{ fontFamily: typography.label, color: '#247348', fontSize: 17 }}>Practice Form</Text>
      </PolishedPressable>
    </Animated.View>
  </Animated.View>;
}
