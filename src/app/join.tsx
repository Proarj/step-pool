import { router } from 'expo-router';
import { useState } from 'react';
import { joinGroup } from '@/lib/api';
import { message } from '@/lib/errors';
import { Button, ErrorText, Field, Muted, Screen } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function Join() {
  const [code, setCode] = useState('');
  const [stake, setStake] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const group = await joinGroup(code, toInt(stake));
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
      <Field label="Your daily stake (coins)" value={stake} onChangeText={setStake} keyboardType="number-pad" />
      <Muted>You start playing tomorrow. You can change your stake any time; changes start the next day.</Muted>
      <Button title="Join group" onPress={submit} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
