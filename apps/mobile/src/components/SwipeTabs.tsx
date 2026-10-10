import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { adjacentTab, mainTabPaths } from './tabSwipe';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const SwipeLock = createContext<((locked: boolean) => void) | null>(null);

/** Wrap native interactive surfaces such as WebView models to reserve their gestures. */
export function TabSwipeBoundary({ children, fullWidth = false }: { children: ReactNode; fullWidth?: boolean }) {
  const lock = useContext(SwipeLock);
  return <View style={fullWidth ? { width: '100%', maxWidth: 620 } : undefined} onTouchStart={() => lock?.(true)} onTouchEnd={event => { if (!event.nativeEvent.touches.length) lock?.(false); }} onTouchCancel={() => lock?.(false)}>{children}</View>;
}

export function SwipeTabs({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion(), [pull] = useState(() => new Animated.Value(0));
  const rebound = useCallback(() => { if (reduced !== false) { pull.setValue(0); return; } Animated.spring(pull, { toValue: 0, stiffness: 360, damping: 22, mass: .7, useNativeDriver: Platform.OS !== 'web' }).start(); }, [pull, reduced]);
  const path = usePathname(), multiTouch = useRef(false), interaction = useRef(false);
  const lockSwipe = useCallback((locked: boolean) => { interaction.current = locked; }, []);
  // PanResponder stores these callbacks; it never reads the touch ref during render.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Bubble only, so child controls and the two-finger model gesture get first refusal.
    onMoveShouldSetPanResponder: (_, gesture) => !interaction.current && !multiTouch.current && mainTabPaths.includes(path as typeof mainTabPaths[number]) && gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2.5,
    onPanResponderGrant: () => pull.stopAnimation(),
    onPanResponderMove: (_, gesture) => { if (reduced === false) pull.setValue(Math.max(-24, Math.min(24, gesture.dx * .14))); },
    onPanResponderTerminate: rebound,
    onPanResponderRelease: (_, gesture) => {
      rebound();
      if (interaction.current || multiTouch.current) return;
      const next = adjacentTab(path, gesture.dx, gesture.dy, 1);
      if (next) router.navigate(next);
    },
    onPanResponderTerminationRequest: () => true,
  }), [path, pull, reduced, rebound]);
  return <SwipeLock.Provider value={lockSwipe}><Animated.View style={{ flex: 1, transform: [{ translateX: pull }] }} {...responder.panHandlers} onTouchStart={event => { if (event.nativeEvent.touches.length > 1) multiTouch.current = true; else multiTouch.current = false; }}>{children}</Animated.View></SwipeLock.Provider>;
}
