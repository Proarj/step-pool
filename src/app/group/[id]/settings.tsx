import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { getGroupToday, leaveGroup, setMyStake, updateGroupGoal } from '@/lib/api';
import { message } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { istToday } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Subtitle } from '@/ui/kit';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session?.user.id;
  const today = istToday();
  const { data } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [goal, setGoal] = useState<string>();
  const [stake, setStake] = useState<string>();
  const [busy, setBusy] = useState<'goal' | 'stake'>();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!data) return <Screen><Muted>Loading…</Muted></Screen>;
  const mine = data.members.find((m) => m.userId === me);
  const goalText = goal ?? String((data.tomorrow ?? data.today).stepGoal);
  const stakeText = stake ?? String(mine?.stakeTomorrow ?? mine?.stake ?? 30);

  async function save(what: 'goal' | 'stake') {
    setBusy(what);
    setError(undefined);
    setNote(undefined);
    try {
      if (what === 'goal') await updateGroupGoal(id, toInt(goalText));
      else await setMyStake(id, toInt(stakeText));
      setNote(what === 'goal' ? 'Saved. The new goal starts tomorrow.' : 'Saved. Your new stake starts tomorrow.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(undefined);
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

      <Subtitle>Group goal</Subtitle>
      <Card>
        <Muted>Today: {data.today.stepGoal.toLocaleString()} steps for everyone. Changes start tomorrow.</Muted>
        <Field label="Daily step goal" value={goalText} onChangeText={setGoal} keyboardType="number-pad" />
        <Button title="Save goal for tomorrow" onPress={() => void save('goal')} busy={busy === 'goal'} />
      </Card>

      <Subtitle>Your stake</Subtitle>
      <Card>
        <Muted>
          {mine?.playsToday ? `Today you’re staking ${mine.stake} coins.` : 'You start playing tomorrow.'} Changes start tomorrow.
        </Muted>
        <Field label="Your daily stake (coins)" value={stakeText} onChangeText={setStake} keyboardType="number-pad" />
        <Button title="Save stake for tomorrow" onPress={() => void save('stake')} busy={busy === 'stake'} />
      </Card>
      {note ? <Muted>{note}</Muted> : null}

      <Button kind="danger" title="Leave group" onPress={confirmLeave} />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
