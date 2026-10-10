import { Image, Platform, Text, View } from 'react-native';
import { streakTier } from '@/data/workout';
import { colors as c, typography as t } from '@/theme/tokens';
export function Streak({ days }: { days: number }) {
  return <View testID="workout-streak" accessibilityLabel={`${days} day workout streak`} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, height: 43 }}>
    {Platform.OS === 'web' ? <Image source={{ uri: `/streak/${streakTier(days)}.svg` }} style={{ width: 28, height: 40 }} accessibilityElementsHidden /> : <Text style={{ fontSize: 23, color: days ? '#F49326' : '#A4ADB5' }}>{days ? '🔥' : '●'}</Text>}
    <Text style={{ fontFamily: t.label, fontSize: 21, lineHeight: 28, color: c.text }}>{days} day streak</Text>
  </View>;
}
