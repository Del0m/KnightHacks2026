import { Pressable, type PressableProps } from 'react-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function PolishedPressable({ style, ...props }: PressableProps) {
  const reduced = useReducedMotion();
  return <Pressable {...props} style={state => [typeof style === 'function' ? style(state) : style, { transform: [{ scale: state.pressed && !props.disabled && reduced === false ? 1.025 : 1 }] }]} />;
}
