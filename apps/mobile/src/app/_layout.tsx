import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { TrainingProvider } from '@/state/Training';
import { useTheme } from '@/theme/tokens';
import { AuthProvider, useAuth } from '@/screens/Auth/session';

export { ErrorBoundary } from 'expo-router';
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    BarlowCondensed: require('../../assets/fonts/BarlowCondensed-Bold.ttf'),
    Barlow: require('../../assets/fonts/Barlow-Regular.ttf'),
    BarlowSemiBold: require('../../assets/fonts/Barlow-SemiBold.ttf'),
    BarlowBold: require('../../assets/fonts/Barlow-Bold.ttf'),
  });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);
  if (error) throw error;
  if (!loaded) return null;

  return <AuthProvider><AuthenticatedApp /></AuthProvider>;
}
function AuthenticatedApp() {
  const theme = useTheme(), auth = useAuth();
  return (
    <TrainingProvider key={auth.user?.id ?? 'signed-out'} accountId={auth.user?.id}><ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors,
      primary: theme.colors.primary, background: theme.colors.background,
      card: theme.colors.surface, text: theme.colors.text, border: theme.colors.border,
    } }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="(tabs)" /><Stack.Screen name="workout" />
        <Stack.Protected guard={!auth.user}>
          <Stack.Screen name="login" /><Stack.Screen name="signup" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider></TrainingProvider>
  );
}
