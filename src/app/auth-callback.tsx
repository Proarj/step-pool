import { Redirect } from 'expo-router';

// The browser hands sign-in back via steppool://auth-callback; the auth code is
// read in signInWithGoogle(). If the OS opens this route directly, go home.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
