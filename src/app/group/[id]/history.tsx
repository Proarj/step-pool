import { useLocalSearchParams } from 'expo-router';
import { getHistory } from '@/lib/api';
import { formatCoins, formatDay } from '@/lib/format';
import { buildLeaderboard, groupByDay } from '@/lib/leaderboard';
import { useAsync } from '@/lib/use-async';
import { Body, Card, ErrorText, Muted, Row, Screen, Subtitle } from '@/ui/kit';

export default function History() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data = [], error, loading, reload } = useAsync(() => getHistory(id), [id]);
  const names = new Map(data.map((r) => [r.userId, r.name]));
  const board = buildLeaderboard(data);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {data.length === 0 && !loading ? (
        <Muted>No results yet. The first day is scored at 12:00 AM after everyone has played a full day.</Muted>
      ) : null}

      {board.length > 0 ? <Subtitle>Leaderboard</Subtitle> : null}
      {board.length > 0 ? (
        <Card>
          {board.map((r, i) => (
            <Row key={r.userId}>
              <Body>{i + 1}. {names.get(r.userId) ?? 'Player'}</Body>
              <Muted>{r.daysHit}/{r.daysPlayed} days · streak {r.streak}</Muted>
              <Body>{formatCoins(r.net)}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      {data.length > 0 ? <Subtitle>Day by day</Subtitle> : null}
      {groupByDay(data).map(({ day, rows }) => (
        <Card key={day}>
          <Body>{formatDay(day)} · goal {rows[0].stepGoal.toLocaleString()}</Body>
          {rows.map((r) => (
            <Row key={r.userId}>
              <Muted>{r.hit ? '✅' : '❌'} {r.name}</Muted>
              <Muted>{r.steps.toLocaleString()} steps</Muted>
              <Body>{formatCoins(r.coinsChange)}</Body>
            </Row>
          ))}
        </Card>
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Screen>
  );
}
