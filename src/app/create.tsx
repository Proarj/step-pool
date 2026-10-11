import { router } from 'expo-router';
import { useState } from 'react';
import { createGroup } from '@/lib/api';
import { message } from '@/lib/errors';
import { Button, ErrorText, Field, Muted, Screen } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function Create() {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('10000');
  const [stake, setStake] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const group = await createGroup(name, toInt(goal), toInt(stake));
      router.replace({ pathname: '/group/[id]', params: { id: group.id } });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field label="Group name" value={name} onChangeText={setName} placeholder="Walk Squad" maxLength={40} />
      <Field label="Daily step goal" value={goal} onChangeText={setGoal} keyboardType="number-pad" />
      <Field label="Daily stake (coins)" value={stake} onChangeText={setStake} keyboardType="number-pad" />
      <Muted>With 4 people, a stake that’s a multiple of 6 (like 30) always splits evenly.</Muted>
      <Muted>Everyone starts playing the day after they join. Share the invite code today so you all start tomorrow.</Muted>
      <Button title="Create group" onPress={submit} busy={busy} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
