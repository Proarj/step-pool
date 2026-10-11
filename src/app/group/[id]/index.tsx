import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { getGroupToday, type MemberToday } from '@/lib/api';
import { message } from '@/lib/errors';
import { formatAgo, formatCoins, formatCountdown } from '@/lib/format';
import { previewDay } from '@/lib/preview';
import { useSession } from '@/lib/session';
import { syncNow } from '@/lib/sync';
import { istToday, msUntilIstMidnight } from '@/lib/time';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Muted, ProgressBar, Row, Screen, Stat, Subtitle } from '@/ui/kit';

function MemberCard({ member, goal, isMe, change, now }: {
  member: MemberToday; goal: number; isMe: boolean; change: number | undefined; now: Date;
}) {
  const status = !member.playsToday
    ? `Joined today, plays from tomorrow with a stake of ${member.stake}`
    : change === undefined || change === 0
      ? 'No coins move if the day ended now'
      : `${formatCoins(change)} if the day ended now`;
  return (
    <Card>
      <Row>
        <Body>{isMe ? `${member.name} (you)` : member.name}</Body>
        <Body>{member.steps.toLocaleString()} / {goal.toLocaleString()}</Body>
      </Row>
      <ProgressBar value={member.steps / goal} />
      <Muted>{status}</Muted>
      <Muted>
        {`Stake ${member.stake}`}
        {member.stakeTomorrow !== null ? ` (${member.stakeTomorrow} from tomorrow)` : ''}
        {` · total ${formatCoins(member.total)}`}
        {member.leavingAfterToday ? ' · leaving after today' : ''}
      </Muted>
      <Muted>{member.syncedAt ? `Synced ${formatAgo(member.syncedAt, now)}` : 'Not synced today'}</Muted>
      {isMe && member.steps === 0 ? (
        <Button kind="link" title="Steps at 0? Check step access" onPress={() => router.push('/setup')} />
      ) : null}
    </Card>
  );
}

export default function GroupToday() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session?.user.id;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const today = istToday(now);
  const { data, error, loading, reload } = useAsync(() => getGroupToday(id, today), [id, today]);
  const [sync, setSync] = useState<{ busy: boolean; note?: string }>({ busy: false });

  async function onSync() {
    setSync({ busy: true });
    try {
      const result = await syncNow();
      setSync({ busy: false, note: `Synced ${result.steps.toLocaleString()} steps` });
      await reload();
    } catch (e) {
      setSync({ busy: false, note: message(e) });
    }
  }

  if (!data) {
    return (
      <Screen refreshing={loading} onRefresh={reload}>
        {error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}
      </Screen>
    );
  }

  const names = new Map(data.members.map((m) => [m.userId, m.userId === me ? 'You' : m.name]));
  const players = data.members.filter((m) => m.playsToday);
  const preview = previewDay(
    data.today.stepGoal,
    players.map((m) => ({ userId: m.userId, steps: m.steps, stake: m.stake })),
  );
  const mine = data.members.find((m) => m.userId === me);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: data.group.name }} />
      <Card>
        <Row>
          <Stat label="Goal" value={data.today.stepGoal.toLocaleString()} />
          <Stat label="Your stake" value={mine ? String(mine.stake) : '–'} />
          <Stat label="Closes in" value={formatCountdown(msUntilIstMidnight(now))} />
        </Row>
        {data.tomorrow ? <Muted>From tomorrow the goal is {data.tomorrow.stepGoal.toLocaleString()} steps</Muted> : null}
      </Card>

      <Button title="Sync now" onPress={onSync} busy={sync.busy} />
      {sync.note ? <Muted>{sync.note}</Muted> : null}

      {preview.transfers.length > 0 ? (
        <Card>
          <Subtitle>If the day ended now</Subtitle>
          {preview.transfers.map((t) => (
            <Row key={`${t.from}>${t.to}`}>
              <Body>{names.get(t.from)} → {names.get(t.to)}</Body>
              <Body>{t.amount}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      {data.members.map((m) => (
        <MemberCard key={m.userId} member={m} goal={data.today.stepGoal} isMe={m.userId === me} change={preview.change[m.userId]} now={now} />
      ))}
      <Muted>Results are calculated at 12:00 AM IST. Steps synced after midnight don’t count.</Muted>

      <Row>
        <Button kind="secondary" title="History" onPress={() => router.push({ pathname: '/group/[id]/history', params: { id } })} />
        <Button kind="secondary" title="Settings" onPress={() => router.push({ pathname: '/group/[id]/settings', params: { id } })} />
      </Row>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
