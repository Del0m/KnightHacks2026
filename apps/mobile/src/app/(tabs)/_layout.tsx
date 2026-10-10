import { useEffect, useState, type ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Animated, Easing, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as c, typography as t, tabAccents } from '@/theme/tokens';
import { NavIcon } from '@/components/NavIcon';
import { PolishedPressable } from '@/components/PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
function GlassTabBar({ state, descriptors, navigation }: BarProps) {
  const reduced = useReducedMotion(), insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0), [slide] = useState(() => new Animated.Value(0));
  const slot = Math.max(0, width - 26) / state.routes.length;
  useEffect(() => {
    const target = state.index * slot;
    if (reduced !== false) { slide.setValue(target); return; }
    const animation = Animated.timing(slide, { toValue: target, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(); return () => animation.stop();
  }, [state.index, slot, slide, reduced]);
  return <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' }}>
    <View testID="glass-navigation" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%', maxWidth: 620, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: 12, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.78)', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0 -5px 24px rgba(34,99,132,0.07)' }}>
      {width > 0 && <Animated.View pointerEvents="none" testID="tab-highlight" style={{ position: 'absolute', left: 14, top: 12, width: Math.max(0, slot - 4), height: 65, borderRadius: 20, backgroundColor: slot > 0 ? slide.interpolate({ inputRange: tabAccents.map((_, index) => index * slot), outputRange: tabAccents.map(accent => accent.glass), extrapolate: 'clamp' }) : tabAccents[0].glass, borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 1px 0 white, 0 2px 8px rgba(68,119,148,.1)', transform: [{ translateX: slide }] }} />}
      {state.routes.map((route, index) => {
        const active = state.index === index, title = descriptors[route.key].options.title ?? route.name, color = tabAccents[index]?.color ?? c.primary;
        return <PolishedPressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} accessibilityLabel={title} onPress={() => { const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }); if (!active && !event.defaultPrevented) navigation.navigate(route.name); }} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={{ flex: 1, gap: 5, paddingVertical: 5, alignItems: 'center', borderRadius: 20 }}>
          <NavIcon name={title} color={color} /><Text style={{ fontFamily: active ? t.strong : t.label, fontSize: 13, color }}>{title}</Text><View style={{ width: 15, height: 2, borderRadius: 2, backgroundColor: active ? color : 'transparent' }} />
        </PolishedPressable>;
      })}
    </View>
  </View>;
}
export default function TabLayout() {
  const reduced = useReducedMotion();
  return <Tabs screenOptions={{ headerShown: false, animation: reduced === false ? 'fade' : 'none', sceneStyle: { backgroundColor: c.background } }} tabBar={props => <GlassTabBar {...props} />}>
    <Tabs.Screen name="index" options={{ title: 'Train' }} /><Tabs.Screen name="plan" options={{ title: 'Plan' }} /><Tabs.Screen name="feed" options={{ title: 'Feed' }} /><Tabs.Screen name="buddies" options={{ title: 'Buddies' }} /><Tabs.Screen name="me" options={{ title: 'Me' }} />
  </Tabs>;
}
