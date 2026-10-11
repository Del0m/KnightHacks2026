import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

/** Website layout hooks; native retains its original hierarchy and spacing. */
export function WebSection({ name, children }: { name: string; children: ReactNode }) {
  return Platform.OS === 'web' ? <View testID={`web-${name}`}>{children}</View> : <>{children}</>;
}
