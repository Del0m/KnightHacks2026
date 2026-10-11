import { useContext, useEffect, useId, useMemo, useState } from 'react';
import { Animated, PanResponder, Text, View, useWindowDimensions } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { PolishedPressable } from './PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { TabSwipeBoundary } from './SwipeTabs';
import { elasticTabPosition, tabAtPosition } from './tabSwipe';
import { colors, typography } from '@/theme/tokens';
import { PageScrollLock } from './PageScroll';
export type ExerciseTab = 'workout' | 'practice';
export function ExerciseTabs({ value, onChange }: { value: ExerciseTab; onChange: (value: ExerciseTab) => void }) {
  const window = useWindowDimensions(), [held, setHeld] = useState(false);
  const lock = useContext(PageScrollLock), control = useId();
  useEffect(() => () => { lock?.(control, false); }, [lock, control]);
  const reduced = useReducedMotion(), [width, setWidth] = useState(0), [slide] = useState(() => new Animated.Value(0)), [bubble] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const toValue = value === 'practice' ? (width - 8) / 2 : 0;
    if (reduced !== false) { slide.setValue(toValue); return; }
    const spring = Animated.spring(slide, { toValue, stiffness: 330, damping: 27, mass: .8, useNativeDriver: false });
    spring.start(); return () => spring.stop();
  }, [value, width, slide, reduced]);
  useEffect(() => {
    if (reduced !== false) { bubble.setValue(1); return; }
    const spring = Animated.spring(bubble, { toValue: held ? 1.04 : 1, stiffness: 380, damping: 22, mass: .6, useNativeDriver: false });
    spring.start(); return () => spring.stop();
  }, [held, reduced, bubble]);
  const slot = Math.max(0, width - 8) / 2;
  const responder = useMemo(() => {
    const position = (x: number) => x - (window.width - width) / 2 - 4 - slot / 2;
    const settle = () => {
      lock?.(control, false);
      setHeld(false);
      const toValue = value === 'practice' ? slot : 0;
      if (reduced !== false) slide.setValue(toValue);
      else Animated.spring(slide, { toValue, stiffness: 330, damping: 23, mass: .8, useNativeDriver: false }).start();
    };
    return PanResponder.create({
      // Claim the touch before child buttons or the page can turn it into scrolling.
      onStartShouldSetPanResponderCapture: () => slot > 0,
      onStartShouldSetPanResponder: () => slot > 0,
      onMoveShouldSetPanResponder: (_, gesture) => slot > 0 && gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => { lock?.(control, true); slide.stopAnimation(); setHeld(true); },
      onPanResponderMove: (_, gesture) => { if (Math.abs(gesture.dx) > 4) slide.setValue(elasticTabPosition(position(gesture.moveX), slot)); },
      onPanResponderRelease: (_, gesture) => { settle(); if (Math.abs(gesture.dy) < 60) onChange(tabAtPosition(position(gesture.moveX || gesture.x0), slot, 2) === 1 ? 'practice' : 'workout'); },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false,
    });
  }, [window.width, width, slot, value, onChange, reduced, slide, lock, control]);
  const tint = slot > 0 ? slide.interpolate({ inputRange: [0, slot], outputRange: ['rgba(176,219,245,.5)', 'rgba(158,226,181,.55)'], extrapolate: 'clamp' }) : 'rgba(176,219,245,.5)';
  return <TabSwipeBoundary><View {...responder.panHandlers} accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', borderRadius: 22, padding: 4, minHeight: 52 }}>
    <GlassSurface radius={22} />
    {width > 8 && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: (width - 8) / 2, borderRadius: 18, transform: [{ translateX: slide }, { scaleX: bubble }, { scaleY: bubble }] }}><GlassSurface radius={18} /><Animated.View testID="exercise-selector-tint" pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: 18, backgroundColor: tint }} /></Animated.View>}
    {(['workout', 'practice'] as const).map(tab => <PolishedPressable key={tab} accessibilityRole="tab" aria-selected={value === tab} accessibilityState={{ selected: value === tab }} onPress={() => onChange(tab)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 18 }}><Text style={{ color: value === tab ? colors.text : colors.muted, fontFamily: value === tab ? typography.strong : typography.label, fontSize: 16 }}>{tab === 'workout' ? 'Today’s Workout' : 'Practice'}</Text></PolishedPressable>)}
  </View></TabSwipeBoundary>;
}
