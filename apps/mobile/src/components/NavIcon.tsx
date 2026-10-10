import { SymbolView } from 'expo-symbols';
export function NavIcon({ name, color }: { name: string; color: string }) {
  const names: Record<string, { ios: string; android: string; web: string }> = { Train: { ios: 'dumbbell', android: 'fitness_center', web: 'fitness_center' }, Plan: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }, Feed: { ios: 'rectangle.stack', android: 'dynamic_feed', web: 'dynamic_feed' }, Buddies: { ios: 'person.2', android: 'group', web: 'group' }, Me: { ios: 'person', android: 'person', web: 'person' } };
  return <SymbolView name={names[name] as Parameters<typeof SymbolView>[0]['name']} tintColor={color} size={27} />;
}
