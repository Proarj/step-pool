import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, Text } from 'react-native';
import { getGroupToday, leaveGroup, setMyStake, updateGroupGoal } from '@/lib/api';
import { message } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { istToday } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Button, Card, Code, EditSheet, ErrorText, ListGroup, ListRow, Muted, Pill, Row, Screen, SectionLabel } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

const toInt = (s: string) => Number.parseInt(s.replace(/\D/g, ''), 10);

type Editing = { what: 'goal' | 'stake'; draft: string } | null;

export default function GroupSettings() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session?.user.id;
  const today = istToday();
  const { data, reload } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!data) return <Screen><Muted>Loading…</Muted></Screen>;
  const mine = data.members.find((m) => m.userId === me);
  const goalToday = data.today.stepGoal;
  const goalTomorrow = data.tomorrow?.stepGoal ?? null;
  const myStake = mine?.stake ?? 30;
  const myStakeTomorrow = mine?.stakeTomorrow ?? null;

  function open(what: 'goal' | 'stake') {
    setSheetError(undefined);
    setEditing({ what, draft: String(what === 'goal' ? goalTomorrow ?? goalToday : myStakeTomorrow ?? myStake) });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setSheetError(undefined);
    try {
      if (editing.what === 'goal') await updateGroupGoal(id, toInt(editing.draft));
      else await setMyStake(id, toInt(editing.draft));
      setNote(editing.what === 'goal' ? 'Saved. The new goal starts tomorrow.' : 'Saved. Your new stake starts tomorrow.');
      setEditing(null);
      void reload();
    } catch (e) {
      setSheetError(message(e));
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

  const goalSubtitle = goalTomorrow !== null && goalTomorrow !== goalToday
    ? `Same for everyone · ${goalTomorrow.toLocaleString()} from tomorrow`
    : 'Same for everyone';
  const stakeSubtitle = myStakeTomorrow !== null
    ? `Only yours · ${myStakeTomorrow} from tomorrow`
    : mine?.playsToday === false ? 'Only yours · you start tomorrow' : 'Only yours';

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 13, color: t.muted }}>Invite code</Text>
        <Row>
          <Code>{data.group.inviteCode}</Code>
          <Pill
            title="Share"
            onPress={() => void Share.share({ message: `Join my StepPool group "${data.group.name}" with code ${data.group.inviteCode}` })}
          />
        </Row>
      </Card>

      <SectionLabel>The game</SectionLabel>
      <ListGroup>
        <ListRow first title="Step goal" subtitle={goalSubtitle} value={goalToday.toLocaleString()} onPress={() => open('goal')} />
        <ListRow title="Your stake" subtitle={stakeSubtitle} value={`${myStake} coins`} accentValue onPress={() => open('stake')} />
      </ListGroup>
      <Muted>Changes start tomorrow, so nobody can change today’s rules after seeing the steps.</Muted>
      {note ? <Muted>{note}</Muted> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Button kind="danger" title="Leave group" onPress={confirmLeave} />

      <EditSheet
        visible={editing !== null}
        title={editing?.what === 'goal' ? 'Step goal' : 'Your stake'}
        hint={editing?.what === 'goal'
          ? 'The daily goal for everyone in the group, from 1,000 to 100,000 steps. Starts tomorrow.'
          : 'How many coins you put in each day, from 1 to 1,000. Starts tomorrow.'}
        label={editing?.what === 'goal' ? 'Steps per day' : 'Coins per day'}
        value={editing?.draft ?? ''}
        onChangeText={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
        onSave={() => void save()}
        onClose={() => setEditing(null)}
        busy={busy}
        error={sheetError}
      />
    </Screen>
  );
}
