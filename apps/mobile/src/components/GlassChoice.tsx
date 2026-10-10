import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { colors as c, typography as t } from '@/theme/tokens';
import { PolishedPressable } from './PolishedPressable';

export function GlassChoice({ label, selected = false, onPress, disabled = false, primary = false, compact = false, hint, testID, radio = false, icon }: {
  label: string; selected?: boolean; onPress: () => void; disabled?: boolean; primary?: boolean; compact?: boolean; hint?: string; testID?: string; radio?: boolean; icon?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [opaque, setOpaque] = useState(Platform.OS === 'ios');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setOpaque(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => { active = false; subscription.remove(); };
  }, []);
  let nativeGlass = false;
  try { nativeGlass = Platform.OS === 'ios' && !opaque && isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); } catch { /* An older development build uses the fallback until rebuilt. */ }
  const background = primary ? '#087DBA' : opaque ? selected ? '#DBEFFB' : '#FFFFFF' : selected ? 'rgba(148,207,239,0.48)' : 'rgba(194,226,244,0.32)';
  return <PolishedPressable testID={testID} accessibilityRole={radio ? 'radio' : compact || primary ? 'button' : 'checkbox'} accessibilityLabel={label} accessibilityHint={hint} aria-checked={radio || !compact && !primary ? selected : undefined} accessibilityState={{ disabled, ...(radio ? { checked: selected } : !compact && !primary ? { checked: selected } : {}) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.press, compact && s.compact, primary && s.primary, !!icon && s.icon, { borderColor: selected ? '#8CBED9' : '#C7DEE9', backgroundColor: nativeGlass ? 'transparent' : background, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed && reduced === false ? 0.975 : 1 }] }]}>
    {nativeGlass && <GlassView pointerEvents="none" colorScheme="light" glassEffectStyle="regular" tintColor={primary ? '#087DBA' : selected ? '#C1E6FB' : '#FFFFFF'} isInteractive={reduced === false} style={[StyleSheet.absoluteFill, { borderRadius: primary ? 24 : 999 }]} />}
    {!nativeGlass && !opaque && !primary && <LinearGradient pointerEvents="none" colors={selected ? ['rgba(255,255,255,0.78)', 'rgba(180,220,242,0.12)', 'rgba(94,172,215,0.24)'] : ['rgba(255,255,255,0.88)', 'rgba(255,255,255,0.18)', 'rgba(123,190,226,0.22)']} locations={[0, 0.42, 1]} style={[StyleSheet.absoluteFill, { borderRadius: 999 }]} />}
    <View style={s.content}>{icon ? <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{icon}</View> : <>{selected && !primary && !compact && <Text importantForAccessibility="no" accessibilityElementsHidden style={s.check}>✓</Text>}<Text style={[s.label, primary && { color: 'white', fontFamily: t.strong, fontSize: 18 }, selected && !primary && { color: '#075F90' }]}>{label}</Text></>}</View>
  </PolishedPressable>;
}
const s = StyleSheet.create({
  press: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 999, borderWidth: 1, justifyContent: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(126,185,216,0.25), 0 6px 16px rgba(31,90,120,0.12)', ...Platform.select({ web: { backdropFilter: 'blur(18px) saturate(150%)' } }) },
  compact: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 }, primary: { minHeight: 56, borderRadius: 24 },
  icon: { width: 48, height: 48, minHeight: 48, paddingHorizontal: 0, paddingVertical: 0, flexShrink: 0 },
  content: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: t.label, fontSize: 16, color: c.text, flexShrink: 1, textAlign: 'center' }, check: { fontFamily: t.strong, fontSize: 16, color: '#075F90' },
});
