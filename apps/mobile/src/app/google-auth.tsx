import { Redirect } from 'expo-router';

// openAuthSessionAsync consumes this deep link; the provider confirms the session.
export default function GoogleAuthReturn() { return <Redirect href="/login" />; }
