import { useLocalSearchParams } from 'expo-router';
import { getHistory } from '@/lib/api';
import { formatCoins, formatDay } from '@/lib/format';
import { buildLeaderboard, groupByDay, pairTotals } from '@/lib/leaderboard';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/use-async';
import { Body, Card, ErrorText, Muted, Row, Screen, Subtitle } from '@/ui/kit';

export default function History() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session?.user.id;
  const { data, error, loading, reload } = useAsync(() => getHistory(id), [id]);
  const results = data?.results ?? [];
  const transfers = data?.transfers ?? [];
  const names = new Map(results.map((r) => [r.userId, r.userId === me ? 'You' : r.name]));
  const name = (userId: string) => names.get(userId) ?? 'Player';
  const board = buildLeaderboard(results);
  const owes = pairTotals(transfers);
  const paymentsByDay = new Map(groupByDay(transfers).map((d) => [d.day, d.rows]));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {results.length === 0 && !loading ? (
        <Muted>No results yet. The first day is scored at 12:00 AM after everyone has played a full day.</Muted>
      ) : null}

      {board.length > 0 ? <Subtitle>Leaderboard</Subtitle> : null}
      {board.length > 0 ? (
        <Card>
          {board.map((r, i) => (
            <Row key={r.userId}>
              <Body>{i + 1}. {name(r.userId)}</Body>
              <Muted>{r.daysHit}/{r.daysPlayed} days · streak {r.streak}</Muted>
              <Body>{formatCoins(r.net)}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      {owes.length > 0 ? <Subtitle>Overall: who owes whom</Subtitle> : null}
      {owes.length > 0 ? (
        <Card>
          {owes.map((o) => (
            <Row key={`${o.debtor}>${o.creditor}`}>
              <Body>{name(o.debtor)} {o.debtor === me ? 'owe' : 'owes'} {name(o.creditor)}</Body>
              <Body>{o.amount}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      {results.length > 0 ? <Subtitle>Day by day</Subtitle> : null}
      {groupByDay(results).map(({ day, rows }) => (
        <Card key={day}>
          <Body>{formatDay(day)} · goal {rows[0].stepGoal.toLocaleString()}</Body>
          {rows.map((r) => (
            <Row key={r.userId}>
              <Muted>{r.hit ? '✅' : '❌'} {name(r.userId)} · stake {r.stake}</Muted>
              <Muted>{r.steps.toLocaleString()} steps</Muted>
              <Body>{formatCoins(r.coinsChange)}</Body>
            </Row>
          ))}
          {(paymentsByDay.get(day) ?? []).map((t) => (
            <Muted key={`${t.from}>${t.to}`}>{name(t.from)} → {name(t.to)}: {t.amount}</Muted>
          ))}
        </Card>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
