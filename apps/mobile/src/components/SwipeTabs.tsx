import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { adjacentTab } from './tabSwipe';

const SwipeLock = createContext<((locked: boolean) => void) | null>(null);

/** Wrap native interactive surfaces such as WebView models to reserve their gestures. */
export function TabSwipeBoundary({ children }: { children: ReactNode }) {
  const lock = useContext(SwipeLock);
  return <View onTouchStart={() => lock?.(true)} onTouchEnd={event => { if (!event.nativeEvent.touches.length) lock?.(false); }} onTouchCancel={() => lock?.(false)}>{children}</View>;
}

export function SwipeTabs({ children }: { children: ReactNode }) {
  const path = usePathname(), multiTouch = useRef(false), interaction = useRef(false);
  const lockSwipe = useCallback((locked: boolean) => { interaction.current = locked; }, []);
  // PanResponder stores these callbacks; it never reads the touch ref during render.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    // Bubble only, so child controls and the two-finger model gesture get first refusal.
    onMoveShouldSetPanResponder: (_, gesture) => !interaction.current && !multiTouch.current && adjacentTab(path, gesture.dx, gesture.dy, gesture.numberActiveTouches) !== null,
    onPanResponderRelease: (_, gesture) => {
      if (interaction.current || multiTouch.current) return;
      const next = adjacentTab(path, gesture.dx, gesture.dy, 1);
      if (next) router.navigate(next);
    },
    onPanResponderTerminationRequest: () => true,
  }), [path]);
  return <SwipeLock.Provider value={lockSwipe}><View style={{ flex: 1 }} {...responder.panHandlers} onTouchStart={event => { if (event.nativeEvent.touches.length > 1) multiTouch.current = true; else multiTouch.current = false; }}>{children}</View></SwipeLock.Provider>;
}
