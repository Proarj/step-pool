import { useState } from 'react';
import { View } from 'react-native';
import { signInWithGoogle } from '@/lib/auth';
import { message } from '@/lib/errors';
import { Body, Button, ErrorText, Muted, Screen, Title } from '@/ui/kit';

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onPress() {
    setBusy(true);
    setError(undefined);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 96, marginBottom: 24, gap: 12 }}>
        <Title>StepPool</Title>
        <Body>Stake coins with your friends. Hit the daily step goal, or lose your stake to the people who did.</Body>
        <Muted>Virtual coins only. No real money.</Muted>
      </View>
      <Button title="Continue with Google" onPress={onPress} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
