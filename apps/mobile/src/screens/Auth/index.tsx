import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppPage, Action, ui } from '@/components/AppPage';
import { PolishedPressable } from '@/components/PolishedPressable';
import { colors as c, typography as t } from '@/theme/tokens';
import { useAuth } from './session';
import { validateCredentials, type AuthMode } from './validation';

export default function AuthScreen({ mode = 'login' }: { mode?: AuthMode }) {
  const auth = useAuth(), signup = mode === 'signup';
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [verification, setVerification] = useState(false);
  const inFlight = useRef(false), emailInput = useRef<TextInput>(null), passwordInput = useRef<TextInput>(null);
  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (error) { const text = error instanceof Error ? error.message : 'Please try again.'; setError(text); if (/verify your email/i.test(text)) setVerification(true); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function submit() {
    const fields = { name, email, password }, invalid = validateCredentials(mode, fields);
    if (invalid) { setError(invalid.message); return; }
    void run(async () => {
      const signedIn = await auth.authenticate(mode, fields);
      setPassword('');
      if (signedIn) router.replace('/');
      else { setVerification(true); setNotice('Check your email to verify your account, then log in.'); }
    });
  }
  return <AppPage title={signup ? 'Sign up' : 'Log in'}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.form}>
      <Text accessibilityRole="header" style={styles.heading}>{signup ? 'Create your account' : 'Log in'}</Text>
      {!auth.configured && <View style={styles.notice}><Text style={ui.rowTitle}>Sign-in isn’t connected yet</Text><Text style={ui.muted}>Your team is setting up Neon Auth. Account creation and login will be available once it’s connected.</Text></View>}
      {signup && <View style={styles.field}><Text style={ui.label} nativeID="name-label">Name</Text><TextInput accessibilityLabel="Name" aria-labelledby="name-label" value={name} onChangeText={setName} maxLength={40} autoComplete="name" textContentType="name" editable={!busy} returnKeyType="next" onSubmitEditing={() => emailInput.current?.focus()} style={ui.input} /></View>}
      <View style={styles.field}><Text style={ui.label} nativeID="email-label">Email</Text><TextInput ref={emailInput} accessibilityLabel="Email" aria-labelledby="email-label" value={email} onChangeText={value => { setEmail(value); setVerification(false); }} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" editable={!busy} returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} style={ui.input} /></View>
      <View style={styles.field}><View style={styles.passwordLabel}><Text style={ui.label} nativeID="password-label">Password</Text><PolishedPressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} disabled={busy} onPress={() => setVisible(!visible)} hitSlop={8}><Text style={styles.link}>{visible ? 'Hide' : 'Show'}</Text></PolishedPressable></View><TextInput ref={passwordInput} accessibilityLabel="Password" aria-labelledby="password-label" value={password} onChangeText={setPassword} secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false} autoComplete={signup ? 'new-password' : 'current-password'} textContentType={signup ? 'newPassword' : 'password'} editable={!busy} returnKeyType="go" onSubmitEditing={auth.configured ? submit : undefined} style={ui.input} />{signup && <Text style={ui.muted}>At least 8 characters.</Text>}</View>
      {(error || auth.error) && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error || auth.error}</Text>}
      {notice && <Text accessibilityLiveRegion="polite" style={ui.text}>{notice}</Text>}
      <Action disabled={!auth.configured || busy} onPress={submit}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</Action>
      {busy && <ActivityIndicator color={c.primary} accessibilityLabel="Signing in" />}
      {verification && auth.configured && <Action secondary disabled={busy} onPress={() => { if (!validateCredentials('login', { name, email, password: 'present' })) void run(async () => { await auth.resendVerification(email); setNotice('If your account needs verification, check your email.'); }); }}>Resend verification email</Action>}
      {auth.error && auth.configured && <Action secondary disabled={busy} onPress={() => { void run(auth.refresh); }}>Retry session</Action>}
      <View style={styles.switch}><Text style={ui.muted}>{signup ? 'Already have an account?' : 'New to Spotter?'}</Text><PolishedPressable accessibilityRole="link" disabled={busy} onPress={() => { setPassword(''); router.replace(signup ? '/login' : '/signup'); }}><Text style={styles.link}>{signup ? 'Log in' : 'Sign up'}</Text></PolishedPressable></View>
    </KeyboardAvoidingView>
  </AppPage>;
}
const styles = StyleSheet.create({
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 22, paddingTop: 38 },
  heading: { fontFamily: t.strong, fontSize: 30, color: c.text, lineHeight: 36 },
  field: { gap: 5 }, passwordLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: t.label, fontSize: 16, color: c.primary, paddingVertical: 6 },
  error: { fontFamily: t.family, fontSize: 16, lineHeight: 23, color: '#9C3434' },
  notice: { gap: 8, borderLeftWidth: 2, borderLeftColor: '#8ECBEA', paddingLeft: 14 },
  switch: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
