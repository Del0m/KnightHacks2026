import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useTheme } from '@/theme/tokens';

export default function NotFoundScreen() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'Page not found' }} />
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg, backgroundColor: theme.colors.background }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.subtitle }}>This page is not available.</Text>
        <Link href="/" style={{ color: theme.colors.primary, fontSize: theme.typography.body, padding: theme.spacing.md }}>Back to Train</Link>
      </View>
    </>
  );
}
