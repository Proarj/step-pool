import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { getGroupToday, leaveGroup, updateGroupSettings } from '@/lib/api';
import { message } from '@/lib/errors';
import { istToday } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Subtitle } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = istToday();
  const { data } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [goal, setGoal] = useState<string>();
  const [stake, setStake] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!data) return <Screen><Muted>Loading…</Muted></Screen>;
  const upcoming = data.tomorrow ?? data.today;
  const goalText = goal ?? String(upcoming.stepGoal);
  const stakeText = stake ?? String(upcoming.dailyStake);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await updateGroupSettings(id, toInt(goalText), toInt(stakeText));
      setNote('Saved. The new goal and stake start tomorrow.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    Alert.alert('Leave this group?', 'You still play today, and can still lose today’s stake. You leave from tomorrow.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          leaveGroup(id).then(() => router.replace('/'), (e) => setError(message(e)));
        },
      },
    ]);
  }

  return (
    <Screen>
      <Subtitle>Invite</Subtitle>
      <Card>
        <Body>Invite code: {data.group.inviteCode}</Body>
        <Button
          kind="secondary"
          title="Share invite"
          onPress={() => void Share.share({ message: `Join my StepPool group "${data.group.name}" with code ${data.group.inviteCode}` })}
        />
      </Card>

      <Subtitle>Goal and stake</Subtitle>
      <Card>
        <Muted>Today: {data.today.stepGoal.toLocaleString()} steps, {data.today.dailyStake} coins. Changes start tomorrow.</Muted>
        <Field label="Daily step goal" value={goalText} onChangeText={setGoal} keyboardType="number-pad" />
        <Field label="Daily stake (coins)" value={stakeText} onChangeText={setStake} keyboardType="number-pad" />
        <Button title="Save for tomorrow" onPress={save} busy={busy} />
        {note ? <Muted>{note}</Muted> : null}
      </Card>

      <Button kind="danger" title="Leave group" onPress={confirmLeave} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
