import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Head from 'expo-router/head';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { colors as c, typography as t } from '@/theme/tokens';
import { GlassChoice } from './GlassChoice';

export function SetupPage({ children, step, total, eyebrow, title, intro, action, onAction, disabled, onBack, secondary, onSecondary, compact = false }: {
  children: ReactNode; step: number; total: number; eyebrow: string; title: string; intro: string;
  action: string; onAction: () => void; disabled?: boolean; onBack: () => void;
  secondary?: string; onSecondary?: () => void; compact?: boolean;
}) {
  const reduced = useReducedMotion();
  const [entrance] = useState(() => new Animated.Value(1));
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(`Step ${step + 1} of ${total}. ${title}. ${intro}`);
  }, [step, total, title, intro]);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (reduced !== false) { entrance.setValue(1); return; }
    entrance.setValue(0);
    const animation = Animated.timing(entrance, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start(); return () => animation.stop();
  }, [step, reduced, entrance]);
  return <LinearGradient colors={['#FFFFFF', '#F4FAFE', '#DFEFF9']} style={s.fill}>
    {Platform.OS === 'web' && <Head><title>{title} · Steady forum</title></Head>}
    <SafeAreaView style={s.fill} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}><Text style={s.brand}>Steady forum</Text><GlassChoice label="Back" onPress={onBack} compact /></View>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
          <View style={[s.progress, compact && { marginBottom: 12 }]} accessibilityLabel={`Step ${step + 1} of ${total}`}>
            {Array.from({ length: total }, (_, i) => <View key={i} style={[s.progressPart, i <= step && { backgroundColor: c.primary }]} />)}
          </View>
          <Text style={s.eyebrow}>{eyebrow}  /  {String(step + 1).padStart(2, '0')}</Text>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[s.title, compact && { fontSize: 32, lineHeight: 36 }]}>{title}</Text><Text style={[s.intro, compact && { fontSize: 15, lineHeight: 21 }]}>{intro}</Text>
          <Animated.View style={{ gap: 28, marginTop: compact ? 16 : 26, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>{children}</Animated.View>
        </ScrollView>
        <View style={s.footer}>
          <GlassChoice label={action} onPress={onAction} selected disabled={disabled} primary />
          {secondary && onSecondary && <GlassChoice label={secondary} onPress={onSecondary} disabled={disabled && action.includes('Saving')} compact />}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </LinearGradient>;
}
const s = StyleSheet.create({
  fill: { flex: 1 }, header: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  brand: { fontFamily: t.strong, fontSize: 32, flexShrink: 1, letterSpacing: -1.1, color: c.text },
  scroll: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 32 },
  progress: { flexDirection: 'row', gap: 7, marginBottom: 28 }, progressPart: { height: 3, flex: 1, borderRadius: 2, backgroundColor: c.border },
  eyebrow: { fontFamily: t.label, fontSize: 12, letterSpacing: 1.8, color: c.primary, textTransform: 'uppercase', marginBottom: 10 },
  title: { fontFamily: t.display, fontSize: 44, lineHeight: 48, color: c.text, letterSpacing: -0.5 },
  intro: { fontFamily: t.family, fontSize: 17, lineHeight: 25, color: c.muted, marginTop: 10, maxWidth: 440 },
  footer: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 10, gap: 6, borderTopWidth: 1, borderColor: '#CFE2ED' },
});
