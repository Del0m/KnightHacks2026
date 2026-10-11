import { useContext, useEffect, useId, type ReactNode } from 'react';
import { View } from 'react-native';
import { PageScrollLock } from './PageScroll';
export function SliderScrollBoundary({ children }: { children: ReactNode }) {
  const lock = useContext(PageScrollLock), control = useId();
  useEffect(() => () => { lock?.(control, false); }, [lock, control]);
  return <View testID="slider-scroll-boundary" onTouchStart={() => lock?.(control, true)} onTouchEnd={event => { if (!event.nativeEvent.touches.length) lock?.(control, false); }} onTouchCancel={() => lock?.(control, false)}>{children}</View>;
}
