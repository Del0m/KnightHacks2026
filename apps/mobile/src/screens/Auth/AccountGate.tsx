import { WebSection } from '@/components/WebSection';
import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { AppPage, Action, pageStyles } from '@/components/AppPage';
import { pageColors } from '@/theme/tokens';
import { useAuth } from './session';

export function AccountGate({ title, children }: { title: string; children: ReactNode }) {
  const colors = pageColors(title), ui = pageStyles(title);
  const { user, loading, error } = useAuth();
  if (user) return children;
  return <AppPage title={title}><WebSection name="account-gate"><View style={ui.empty}>
    {loading ? <ActivityIndicator accessibilityLabel="Restoring your session" color={colors.primary} /> : <>
      <SymbolView name={{ ios: 'lock', android: 'lock', web: 'lock' }} tintColor={colors.primary} size={32} />
      <Text accessibilityRole="header" style={ui.emptyTitle}>Log in to use {title === 'Me' ? 'your account' : title}</Text>
      <Text style={ui.muted}>Training and your workout plan are available without an account.</Text>
      {error && <Text accessibilityRole="alert" style={ui.muted}>{error}</Text>}
      <Action onPress={() => router.push('/login')}>Log in</Action>
      <Action secondary onPress={() => router.push('/signup')}>Create account</Action>
    </>}
  </View></WebSection></AppPage>;
}
