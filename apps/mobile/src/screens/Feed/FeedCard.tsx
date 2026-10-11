import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassSurface } from '@/components/GlassSurface';
import { PolishedPressable } from '@/components/PolishedPressable';
import { pageStyles } from '@/components/AppPage';
import { pageColors } from '@/theme/tokens';
import { readPublicWorkout } from '@/screens/Summary/workoutPost';
import { medalTier, postType, type FeedPost } from './feedApi';
const ui = pageStyles('Feed'), c = pageColors('Feed');
export function FeedIcon({ name, color = c.text }: { name: 'rep' | 'comment' | 'filter' | 'plus' | 'close'; color?: string }) {
 const paths = { rep: 'M7 7v10M4 9v6M17 7v10M20 9v6M7 12h10', comment: 'M4 4h16v12H9l-5 4V4z', filter: 'M4 6h16M7 12h10M10 18h4', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18' };
 return <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden><Path d={paths[name]} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
const metals = {
 gold: { tint: '#F8E8B0', edge: '#D4B45E', ink: '#6E5014', light: '#FFF8D8', dark: '#B78826' },
 silver: { tint: '#E2E9EF', edge: '#B6C4CE', ink: '#415664', light: '#FFFFFF', dark: '#869AA9' },
 bronze: { tint: '#F0D6C4', edge: '#CF9A78', ink: '#785038', light: '#FFECDD', dark: '#AE6C41' },
};
function MedalBadge({ tier }: { tier: keyof typeof metals }) {
 const m = metals[tier], title = tier[0].toUpperCase() + tier.slice(1);
 return <View accessibilityLabel={`${title} medal`} style={{ width: 68, alignItems: 'center', gap: 2 }}>
  <Svg width={68} height={86} viewBox="0 0 68 86" accessibilityElementsHidden>
   <Defs><SvgGradient id={`metal-${tier}`} x1="0%" y1="0%" x2="100%" y2="100%"><Stop offset={0} stopColor={m.light} /><Stop offset={.45} stopColor={m.tint} /><Stop offset={1} stopColor={m.dark} /></SvgGradient></Defs>
   <Path d="M18 45L12 78l14-7 8 11 6-33M34 49l8 33 7-11 14 7-13-34" fill={m.tint} stroke={m.edge} strokeWidth={1.5} />
   <Circle cx={34} cy={30} r={27} fill={`url(#metal-${tier})`} stroke={m.edge} strokeWidth={1.5} />
   <Circle cx={34} cy={30} r={21} fill="none" stroke="white" strokeOpacity={.7} strokeWidth={1.2} />
   <Path d="M34 17l4 8 9 1-7 7 2 9-8-4-8 4 2-9-7-7 9-1z" fill={m.ink} fillOpacity={.75} />
  </Svg><Text style={[ui.label, { color: m.ink }]}>{title}</Text>
 </View>;
}
export function FeedCard({ post, pending, onKudos, onComment = () => {} }: { post: FeedPost; pending: boolean; onKudos: () => void; onComment?: () => void }) {
 const type = postType(post), tier = medalTier(post), metal = tier ? metals[tier] : null;
 const name = post.author.display_name || post.author.handle || 'Member';
 const workout = post.kind === 'session' ? readPublicWorkout(post.data) : null;
 const record = type === 'pr', tint = metal?.tint ?? (record ? '#FFFFFF' : '#EDE4FB');
 const label = type === 'medal' ? `${tier ? tier[0].toUpperCase() + tier.slice(1) : ''} workout`.trim() : record ? 'Personal record' : null;
 const body = <View testID={`feed-card-${type}`} style={[styles.card, { borderColor: record ? 'rgba(255,255,255,.95)' : metal?.edge ?? '#DDCEE9' }]}>
  <GlassSurface radius={22} tint={tint} colored />
  {record && <><View pointerEvents="none" style={{ position: 'absolute', top: 2, left: 14, right: 14, height: 1, backgroundColor: 'rgba(255,255,255,.95)' }} /><LinearGradient pointerEvents="none" colors={['#FFFFFFCC', '#FFFFFF00', '#CBC3E980', '#FFFFFF00']} style={{ position: 'absolute', top: 14, bottom: 14, right: 1, width: 2 }} /></>}
  <View style={{ flexDirection: 'row', gap: 14 }}>
   <View style={{ flex: 1, gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
     <View style={styles.avatar}><Text style={ui.rowTitle}>{name.slice(0, 1).toUpperCase()}</Text></View>
     <View style={{ flex: 1 }}><Text style={[ui.rowTitle, { fontSize: 18 }]}>{name}</Text><Text style={ui.muted}>{new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text></View>
    </View>
    {label && <Text style={[ui.heading, { marginTop: 0, color: metal?.ink ?? c.text }]}>{label}</Text>}
    {workout ? <View style={{ gap: 10 }}>
     {workout.exercises.map(e => <View key={e.id} style={{ gap: 2 }}><Text style={ui.text}>{e.name}</Text><Text style={ui.muted}>{e.sets} sets · {e.reps} reps</Text></View>)}
     {workout.highlights.map((highlight, i) => <Text key={i} style={ui.text}>{highlight}</Text>)}
    </View> : <Text style={ui.text}>{post.body}</Text>}
   </View>
   {type === 'medal' && tier && <View style={{ paddingTop: 46 }}><MedalBadge tier={tier} /></View>}
  </View>
  <View style={[styles.actions, { borderTopColor: metal?.edge ?? c.border }]}>
   <PolishedPressable accessibilityRole="button" accessibilityLabel={`${post.viewer_gave_kudos ? 'Remove rep' : 'Rep post'}, ${post.kudos_count}`} accessibilityState={{ selected: post.viewer_gave_kudos, disabled: pending }} disabled={pending} onPress={onKudos} style={styles.action}><FeedIcon name="rep" color={post.viewer_gave_kudos ? c.primary : c.text} /><Text style={[ui.label, { color: post.viewer_gave_kudos ? c.primary : c.text }]}>{post.viewer_gave_kudos ? 'Repped' : 'Rep'} · {post.kudos_count}</Text></PolishedPressable>
   <PolishedPressable accessibilityRole="button" accessibilityLabel={`Comment on post, ${post.comment_count} comments`} onPress={onComment} style={styles.action}><FeedIcon name="comment" /><Text style={[ui.label, { color: c.text }]}>Comment · {post.comment_count}</Text></PolishedPressable>
  </View>
 </View>;
 return record ? <LinearGradient colors={['#8DD9EFB3', '#BCAEF0B3', '#E5B9D7B3', '#EBDFB3B3', '#B8DCCDB3', '#A3CEE5B3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 1.2, borderRadius: 23.2 }}>{body}</LinearGradient> : body;
}
const styles = StyleSheet.create({
 card: { borderRadius: 22, padding: 18, gap: 16, borderWidth: 1, boxShadow: '0 8px 24px rgba(86,65,111,.07)' },
 avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.7)', alignItems: 'center', justifyContent: 'center' },
 actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, paddingTop: 4 },
 action: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7 },
});
