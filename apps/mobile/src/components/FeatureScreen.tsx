import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import Head from 'expo-router/head';
import { colors as palette, typography as type, useTheme } from '@/theme/tokens';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type Props = {
  section: string; title: string; description: string;
  action: string; detailTitle: string; detailDescription: string;
  steps?: readonly { title: string; description: string }[];
  note: string;
};

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const nativeDriver = Platform.OS !== 'web';

export function FeatureScreen(props: Props) {
  const { colors, typography } = useTheme();
  const dimensions = useWindowDimensions();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // Static web rendering has no viewport; match it during hydration first.
  const { width, height } = Platform.OS === 'web' && !hydrated
    ? { width: 390, height: 844 } : dimensions;
  const compact = width < 760;
  const reducedMotion = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const detailY = useRef(0);
  const [entrance] = useState(() => new Animated.Value(1));
  const [imageSettle] = useState(() => new Animated.Value(1));
  const [buttonScale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reducedMotion !== false) {
      entrance.setValue(1);
      imageSettle.setValue(1);
      return;
    }
    entrance.setValue(0);
    imageSettle.setValue(0);
    const motion = Animated.parallel([
      Animated.timing(entrance, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.timing(imageSettle, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
    ]);
    motion.start();
    return () => motion.stop();
  }, [entrance, imageSettle, reducedMotion]);

  function pressFeedback(value: number) {
    if (reducedMotion !== false) return;
    Animated.spring(buttonScale, { toValue: value, speed: 30, bounciness: 0, useNativeDriver: nativeDriver }).start();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {Platform.OS === 'web' && <Head><title>{props.section} · Steady forum</title></Head>}
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { minHeight: Math.max(compact ? 710 : 640, height - 70) }]}>
          <Animated.Image
            source={require('../../assets/images/training.jpg')}
            accessibilityLabel="A man pressing dumbbells overhead in a sunlit gym"
            resizeMode="cover"
            style={[
              styles.photo, compact && { top: '43%', height: '57%' },
              { transform: [{ scale: imageSettle.interpolate({ inputRange: [0, 1], outputRange: [1.045, 1] }) }] },
            ]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={compact
              ? ['#F7FCFF', '#F7FCFF', 'rgba(247,252,255,0.72)', 'rgba(228,245,254,0.04)']
              : ['#F7FCFF', 'rgba(247,252,255,0.97)', 'rgba(228,245,254,0.2)', 'rgba(228,245,254,0.02)']}
            locations={compact ? [0, 0.41, 0.53, 0.76] : [0, 0.30, 0.57, 1]}
            start={{ x: 0, y: 0 }} end={compact ? { x: 0, y: 1 } : { x: 1, y: 0.2 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[
            styles.heroCopy, { padding: compact ? 28 : 64, paddingTop: compact ? 32 : 64 },
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
          ]}>
            <Text accessibilityRole="header" style={[
              styles.brand, { fontSize: compact ? Math.min(56, width * 0.13) : 94, lineHeight: compact ? 66 : 108 },
            ]}>Steady forum</Text>
            <Text accessibilityRole="header" style={[
              styles.title, { fontSize: compact ? 30 : 43, lineHeight: compact ? 36 : 50, maxWidth: compact ? 330 : 470 },
            ]}>{props.title}</Text>
            <Text style={[styles.description, { maxWidth: compact ? 320 : 375 }]}>{props.description}</Text>
            <Animated.View style={{ alignSelf: 'flex-start', transform: [{ scale: buttonScale }] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Scrolls to the next section"
                onPress={() => scroll.current?.scrollTo({ y: detailY.current, animated: reducedMotion === false })}
                onPressIn={() => pressFeedback(0.97)} onPressOut={() => pressFeedback(1)}
                style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.text : colors.primary }]}
              >
                <Text style={{ color: colors.surface, fontFamily: typography.strong, fontSize: 16 }}>{props.action}</Text>
                <SymbolView name={{ ios: 'arrow.down', android: 'arrow_downward', web: 'arrow_downward' }} tintColor={colors.surface} size={18} />
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>
        <View onLayout={event => { detailY.current = event.nativeEvent.layout.y; }} style={[styles.details, { padding: compact ? 28 : 64 }]}>
          <View style={styles.detailInner}>
            <Text style={styles.sectionLabel}>{props.section.toUpperCase()}</Text>
            <Text accessibilityRole="header" style={styles.detailTitle}>{props.detailTitle}</Text>
            <Text style={styles.detailDescription}>{props.detailDescription}</Text>
            {props.steps?.map((step, index) => (
              <View key={step.title} style={styles.step}>
                <Text style={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text accessibilityRole="header" style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDescription}>{step.description}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.note}>{props.note}</Text>
            <Text style={styles.credit}>Photography: Ivan S / Pexels</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { flexGrow: 1 },
  hero: { overflow: 'hidden', backgroundColor: palette.primarySoft },
  photo: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  heroCopy: { alignItems: 'flex-start', gap: 22 },
  brand: { fontFamily: type.display, color: palette.primary, letterSpacing: -2, marginLeft: -2 },
  title: { fontFamily: type.strong, color: palette.text, letterSpacing: -1.2 },
  description: { fontFamily: type.family, fontSize: 17, lineHeight: 26, color: palette.muted },
  action: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 16 },
  details: { backgroundColor: palette.surface, paddingVertical: 64 },
  detailInner: { maxWidth: 760, width: '100%', alignSelf: 'center', gap: 18 },
  sectionLabel: { color: palette.primary, fontFamily: type.strong, fontSize: 12, letterSpacing: 2 },
  detailTitle: { fontFamily: type.display, fontSize: 34, lineHeight: 42, color: palette.text },
  detailDescription: { fontFamily: type.family, fontSize: 17, lineHeight: 27, color: palette.muted, marginBottom: 12 },
  step: { flexDirection: 'row', gap: 22, paddingVertical: 22, borderTopWidth: 1, borderTopColor: palette.border },
  stepNumber: { fontFamily: type.display, fontSize: 26, color: palette.primary },
  stepTitle: { fontFamily: type.strong, fontSize: 20, color: palette.text },
  stepDescription: { fontFamily: type.family, fontSize: 16, lineHeight: 26, color: palette.muted },
  note: { fontFamily: type.family, fontSize: 14, lineHeight: 23, color: palette.muted, marginTop: 20 },
  credit: { fontFamily: type.family, fontSize: 11, lineHeight: 18, color: palette.muted, marginTop: 16 },
});
