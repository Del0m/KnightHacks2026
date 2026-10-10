import { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';
const BubblePressable = Animated.createAnimatedComponent(Pressable);

export function PolishedPressable({ style, onPressIn, onPressOut, ...props }: PressableProps) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion(), [scale] = useState(() => new Animated.Value(1));
  useEffect(() => () => scale.stopAnimation(), [scale]);
  function settle(pressed: boolean) {
    scale.stopAnimation();
    if (reduced !== false || props.disabled) { scale.setValue(1); return; }
    Animated.spring(scale, { toValue: pressed ? 1.025 : 1, stiffness: 380, damping: 22, mass: .6, useNativeDriver: Platform.OS !== 'web' }).start();
  }
  const resolved = StyleSheet.flatten(typeof style === 'function' ? style({ pressed }) : style);
  return <BubblePressable {...props} onPressIn={event => { setPressed(true); settle(true); onPressIn?.(event); }} onPressOut={event => { setPressed(false); settle(false); onPressOut?.(event); }} style={[resolved, { transform: [...(Array.isArray(resolved?.transform) ? resolved.transform : []), { scale }] }]} />;
}
