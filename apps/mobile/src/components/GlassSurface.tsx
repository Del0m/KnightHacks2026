import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

/** Decorative layer only: callers retain their controls, layout and accessibility. */
export function GlassSurface({ tint = '#FFFFFF', radius = 24, colored = false, subtle = false }: { tint?: string; radius?: number; colored?: boolean; subtle?: boolean }) {
  const [opaque, setOpaque] = useState(Platform.OS === 'ios');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setOpaque(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    return () => { active = false; subscription.remove(); };
  }, []);
  const style = [StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: 'rgba(255,255,255,.88)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 2px 8px rgba(52,118,163,.06)' }];
  let native = false;
  try { native = Platform.OS === 'ios' && !opaque && isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); } catch { /* Older native builds retain the gradient. */ }
  if (native) return <GlassView pointerEvents="none" colorScheme="light" glassEffectStyle={subtle ? "clear" : "regular"} tintColor={subtle ? `${tint}66` : tint} style={style} />;
  if (opaque) return <View pointerEvents="none" style={[style, { backgroundColor: colored ? tint : '#F4FAFE' }]} />;
  return <LinearGradient pointerEvents="none" colors={subtle ? [`${tint}55`, `${tint}22`, `${tint}66`] : colored ? [`${tint}EE`, `${tint}BA`, `${tint}E6`] : ['rgba(255,255,255,0.94)', 'rgba(231,245,253,0.54)', 'rgba(185,220,239,0.64)']} locations={[0, .45, 1]} style={style} />;
}
