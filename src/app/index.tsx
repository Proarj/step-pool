import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { health } from '@/health/health';
import type { HealthStatus } from '@/health/types';
import { getMyBalance, getMyGroups } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, ErrorText, Muted, Screen, Subtitle } from '@/ui/kit';
import { useTheme } from '@/ui/theme';

const HEALTH_BANNER: Record<Exclude<HealthStatus, 'ready'>, string> = {
  'needs-permission': 'StepPool can’t read your steps yet.',
  'needs-update': 'Health Connect needs an update before StepPool can read your steps.',
  unavailable: 'Step data isn’t available on this device.',
};

export default function Home() {
  const t = useTheme();
  const userId = useSession().session?.user.id ?? '';
  const { data, error, loading, reload } = useAsync(async () => {
    const [groups, balance, healthStatus] = await Promise.all([getMyGroups(), getMyBalance(userId), health.status()]);
    return { groups, balance, healthStatus };
  }, [userId]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Card>
        <Muted>Your coins</Muted>
        <Text style={{ fontSize: 36, fontWeight: '700', color: t.text }}>{data?.balance ?? '…'}</Text>
      </Card>

      {data && data.healthStatus !== 'ready' ? (
        <Card>
          <Body>{HEALTH_BANNER[data.healthStatus]}</Body>
          <Button kind="secondary" title="Set up step access" onPress={() => router.push('/setup')} />
        </Card>
      ) : null}

      <Subtitle>Your groups</Subtitle>
      {data?.groups.map((g) => (
        <Pressable key={g.id} onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}>
          <Card>
            <Body>{g.name}</Body>
            <Muted>Invite code {g.inviteCode}</Muted>
          </Card>
        </Pressable>
      ))}
      {data && data.groups.length === 0 ? <Muted>No groups yet. Create one, or join with a friend's code.</Muted> : null}

      <Button title="Create a group" onPress={() => router.push('/create')} />
      <Button kind="secondary" title="Join with a code" onPress={() => router.push('/join')} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button kind="link" title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
