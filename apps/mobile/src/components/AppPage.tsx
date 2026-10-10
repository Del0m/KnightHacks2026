import { PolishedPressable } from '@/components/PolishedPressable';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Head from 'expo-router/head';
import { colors as c, typography as t, pageColors, PageColors, usePageColors } from '@/theme/tokens';
import { useReducedMotion } from '@/hooks/useReducedMotion';
export function AppPage({ children, title = 'Train', intro, compact = false, headerAction }: { children: ReactNode; title?: string; intro?: string; compact?: boolean; headerAction?: ReactNode }) {
  const colors = pageColors(title), ui = pageStyles(title);
  const reduced = useReducedMotion(), [entrance] = useState(() => new Animated.Value(1));
  useEffect(() => { if (reduced !== false) return; entrance.setValue(0); const a = Animated.timing(entrance, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }); a.start(); return () => a.stop(); }, [entrance, reduced]);
  return <PageColors.Provider value={colors}><LinearGradient colors={['#FFFFFF', colors.background, colors.primarySoft]} style={{ flex: 1 }}>
    <Head><title>{title} · Spotter</title></Head>
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}><ScrollView contentContainerStyle={ui.scroll}>
      <Animated.View style={[ui.content, compact && { gap: 8 }, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }]}>
        <View style={ui.brandRow}><Text accessibilityRole="header" style={ui.brand}>spotter<Text style={{ color: colors.primary }}>.</Text></Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, flexShrink: 1 }}>{title !== 'Train' && <Text style={ui.sectionName}>{title}</Text>}{headerAction}</View></View>
        {intro && <Text style={ui.pageTitle} accessibilityRole="header">{intro}</Text>}{children}
      </Animated.View>
    </ScrollView></SafeAreaView>
  </LinearGradient></PageColors.Provider>;
}
export function Action({ children, onPress, secondary = false, disabled = false }: { children: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  const colors = usePageColors();
  return <PolishedPressable testID="glass-action" accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [ui.action, { backgroundColor: colors.primary, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 5px 18px rgba(60,45,60,0.10)' }, secondary && { backgroundColor: colors.primarySoft }, { opacity: disabled ? .45 : pressed ? .8 : 1, transform: [{ scale: pressed ? .985 : 1 }] }]}><Text style={[ui.actionText, secondary && { color: colors.primary }]}>{children}</Text></PolishedPressable>;
}
export const ui = StyleSheet.create({
  scroll: { flexGrow: 1, paddingBottom: 110 }, content: { width: '100%', maxWidth: 660, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 22, gap: 16 },
  brandRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }, brand: { fontFamily: t.strong, fontSize: 44, letterSpacing: -1.7, color: c.text, lineHeight: 48, flexShrink: 1 }, sectionName: { fontFamily: t.label, fontSize: 16, color: c.muted },
  pageTitle: { fontFamily: t.strong, fontSize: 32, lineHeight: 38, letterSpacing: -.7, color: c.text, marginTop: 16 }, heading: { fontFamily: t.label, fontSize: 22, color: c.text, marginTop: 12 }, text: { fontFamily: t.family, fontSize: 17, lineHeight: 25, color: c.text }, muted: { fontFamily: t.family, fontSize: 15, lineHeight: 22, color: c.muted },
  label: { fontFamily: t.label, fontSize: 15, color: c.muted }, row: { paddingVertical: 18, borderTopWidth: 1, borderTopColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, rowTitle: { fontFamily: t.label, fontSize: 20, color: c.text },
  action: { backgroundColor: '#397DADEB', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 5px 18px rgba(52,118,163,0.12)', minHeight: 54, padding: 16, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, actionText: { fontFamily: t.strong, fontSize: 18, color: 'white' }, secondary: { backgroundColor: c.primarySoft },
  input: { borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 14, fontFamily: t.family, fontSize: 19, color: c.text },
  empty: { paddingVertical: 36, gap: 14 }, emptyTitle: { fontFamily: t.strong, fontSize: 28, lineHeight: 34, color: c.text, maxWidth: 330 },
});

export function pageStyles(title: string) {
  const colors = pageColors(title);
  return {
    ...ui,
    brand: { ...ui.brand, color: colors.text }, sectionName: { ...ui.sectionName, color: colors.muted },
    pageTitle: { ...ui.pageTitle, color: colors.text }, heading: { ...ui.heading, color: colors.text },
    text: { ...ui.text, color: colors.text }, muted: { ...ui.muted, color: colors.muted },
    label: { ...ui.label, color: colors.muted }, row: { ...ui.row, borderTopColor: colors.border },
    rowTitle: { ...ui.rowTitle, color: colors.text }, emptyTitle: { ...ui.emptyTitle, color: colors.text },
    input: { ...ui.input, color: colors.text, borderBottomColor: colors.border },
  };
}
