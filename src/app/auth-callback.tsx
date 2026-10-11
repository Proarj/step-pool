import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { message } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { Button, ErrorText, Muted, Screen } from '@/ui/kit';

// Only reached when the sign-in redirect cold-starts the app (see +native-intent):
// the browser's sign-in code is exchanged here instead of in signInWithGoogle().
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { session } = useSession();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (session || !code) return;
    supabase.auth.exchangeCodeForSession(code).then(
      ({ error: exchangeError }) => { if (exchangeError) setError(exchangeError.message); },
      (e) => setError(message(e)),
    );
  }, [code, session]);

  if (session) return <Redirect href="/" />;
  return (
    <Screen>
      {error || !code ? (
        <>
          <ErrorText>{error ?? 'Sign-in didn’t finish.'}</ErrorText>
          <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <Muted>Signing in…</Muted>
      )}
    </Screen>
  );
}
