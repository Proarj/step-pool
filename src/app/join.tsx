import { router } from 'expo-router';
import { useState } from 'react';
import { joinGroup } from '@/lib/api';
import { message } from '@/lib/errors';
import { Button, ErrorText, Field, Muted, Screen } from '@/ui/kit';

export default function Join() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const group = await joinGroup(code);
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Invite code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="K7Q2MP" />
      <Muted>You start playing tomorrow.</Muted>
      <Button title="Join group" onPress={submit} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
