import { GlassSurface } from '@/components/GlassSurface';
import { SwipeTabs, TabSwipeBoundary } from '@/components/SwipeTabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Animated, Easing, PanResponder, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as c, typography as t, tabAccents, pageColors } from '@/theme/tokens';
import { NavIcon } from '@/components/NavIcon';
import { PolishedPressable } from '@/components/PolishedPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { elasticTabPosition, tabAtPosition } from '@/components/tabSwipe';

type BarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
function GlassTabBar({ state, descriptors, navigation }: BarProps) {
  const reduced = useReducedMotion(), insets = useSafeAreaInsets(), window = useWindowDimensions();
  const [width, setWidth] = useState(0), [slide] = useState(() => new Animated.Value(0)), [stretch] = useState(() => new Animated.Value(1));
  const slot = Math.max(0, width - 26) / state.routes.length;
  useEffect(() => {
    const target = state.index * slot;
    if (reduced !== false) { slide.setValue(target); return; }
    const animation = Animated.spring(slide, { toValue: target, stiffness: 340, damping: 25, mass: .7, useNativeDriver: false });
    animation.start(); return () => animation.stop();
  }, [state.index, slot, slide, reduced]);
  function navigate(index: number) {
    const route = state.routes[index];
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
    return event.defaultPrevented ? state.index : index;
  }
  function settle(index: number) {
    if (reduced !== false) { slide.setValue(index * slot); stretch.setValue(1); return; }
    Animated.parallel([
      Animated.spring(slide, { toValue: index * slot, stiffness: 340, damping: 21, mass: .7, useNativeDriver: false }),
      Animated.spring(stretch, { toValue: 1, stiffness: 340, damping: 20, mass: .6, useNativeDriver: false }),
    ]).start();
  }
  const responder = (() => {
    const position = (x: number) => x - (window.width - width) / 2 - 14 - slot / 2;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) => slot > 0 && gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderGrant: () => { slide.stopAnimation(); stretch.stopAnimation(); },
      onPanResponderMove: (_, gesture) => {
        slide.setValue(elasticTabPosition(position(gesture.moveX), (state.routes.length - 1) * slot));
        stretch.setValue(reduced === false ? 1 + Math.min(.12, Math.abs(gesture.dx) / Math.max(width, 1) * .2) : 1);
      },
      onPanResponderRelease: (_, gesture) => {
        const index = tabAtPosition(position(gesture.moveX), slot, state.routes.length);
        settle(index === state.index ? index : navigate(index));
      },
      onPanResponderTerminate: () => settle(state.index),
      onPanResponderTerminationRequest: () => false,
    });
  })();
  return <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' }}>
    <TabSwipeBoundary fullWidth><View {...responder.panHandlers} testID="glass-navigation" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%', maxWidth: 620, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12), paddingHorizontal: 12, flexDirection: 'row', backgroundColor: 'transparent', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0 -5px 24px rgba(34,99,132,0.07)' }}>
      <GlassSurface radius={28} />
      {width > 0 && <Animated.View pointerEvents="none" testID="tab-highlight" style={{ position: 'absolute', left: 14, top: 12, width: Math.max(0, slot - 4), height: 65, borderRadius: 20, backgroundColor: slot > 0 ? slide.interpolate({ inputRange: tabAccents.map((_, index) => index * slot), outputRange: tabAccents.map(accent => accent.glass), extrapolate: 'clamp' }) : tabAccents[0].glass, borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 1px 0 white, 0 2px 8px rgba(68,119,148,.1)', transform: [{ translateX: slide }, { scaleX: stretch }] }} />}
      {state.routes.map((route, index) => {
        const active = state.index === index, title = descriptors[route.key].options.title ?? route.name, color = tabAccents[index]?.color ?? c.primary;
        return <PolishedPressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: active }} aria-selected={active} accessibilityLabel={title} onPress={() => settle(navigate(index))} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={{ flex: 1, gap: 5, paddingVertical: 5, alignItems: 'center', borderRadius: 20 }}>
          <NavIcon name={title} color={color} /><Text style={{ fontFamily: active ? t.strong : t.label, fontSize: 13, color }}>{title}</Text>
        </PolishedPressable>;
      })}
    </View></TabSwipeBoundary>
  </View>;
}
export default function TabLayout() {
  const reduced = useReducedMotion(), { width } = useWindowDimensions();
  return <SwipeTabs><Tabs screenOptions={({ route }) => ({ headerShown: false, animation: reduced === false ? 'shift' : 'none', transitionSpec: { animation: 'timing', config: { duration: 260, easing: Easing.out(Easing.cubic) } }, sceneStyleInterpolator: ({ current }) => ({ sceneStyle: { transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-width, 0, width] }) }] } }), sceneStyle: { backgroundColor: pageColors(route.name).background } })} tabBar={props => <GlassTabBar {...props} />}>
    <Tabs.Screen name="index" options={{ title: 'Train' }} /><Tabs.Screen name="plan" options={{ title: 'Plan' }} /><Tabs.Screen name="feed" options={{ title: 'Feed' }} /><Tabs.Screen name="buddies" options={{ title: 'Buddies' }} /><Tabs.Screen name="me" options={{ title: 'Me' }} />
  </Tabs></SwipeTabs>;
}
