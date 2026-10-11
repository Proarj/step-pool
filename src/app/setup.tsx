import { useState } from 'react';
import { Platform } from 'react-native';
import { health } from '@/health/health';
import type { HealthStatus } from '@/health/types';
import { syncNow } from '@/lib/sync';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, Muted, Screen, Title } from '@/ui/kit';

const STATUS_TEXT: Record<HealthStatus, string> = {
  ready: 'Step access is on. StepPool syncs when you open it, in the background, and when you tap Sync.',
  'needs-permission': 'Allow StepPool to read your steps.',
  'needs-update': 'Update Health Connect from the Play Store, then come back.',
  unavailable: 'Step data isn’t available on this device.',
};

function PlatformNotes() {
  if (Platform.OS === 'ios') {
    return (
      <Card>
        <Body>iPhone + Apple Watch</Body>
        <Muted>StepPool reads the same step total the Health app shows, which already merges your iPhone and Apple Watch.</Muted>
        <Muted>If your steps stay at 0: Settings → Health → Data Access & Devices → StepPool → turn on Steps.</Muted>
      </Card>
    );
  }
  return (
    <Card>
      <Body>Android + Garmin or Amazfit</Body>
      <Muted>1. In Garmin Connect (or Zepp), turn on syncing to Health Connect.</Muted>
      <Muted>2. In Health Connect → Data and access → Steps → Data sources and priority, put Garmin Connect or Zepp first.</Muted>
      <Muted>3. Allow StepPool to read steps, including in the background.</Muted>
      <Muted>Before midnight, open Garmin Connect or Zepp first so your watch’s latest steps reach the phone.</Muted>
    </Card>
  );
}

export default function Setup() {
  const { data: status, reload } = useAsync(() => health.status(), []);
  const [busy, setBusy] = useState(false);

  async function allow() {
    setBusy(true);
    try {
      await health.requestAccess();
      await syncNow().catch(() => undefined);
    } finally {
      setBusy(false);
      void reload();
    }
  }

  return (
    <Screen>
      <Title>Step access</Title>
      <Body>{STATUS_TEXT[status ?? 'needs-permission']}</Body>
      <PlatformNotes />
      {status === 'needs-permission' ? <Button title="Allow step access" onPress={allow} busy={busy} /> : null}
      <Button
        kind="secondary"
        title={Platform.OS === 'ios' ? 'Open the Health app' : 'Open Health Connect'}
        onPress={() => void health.openSettings()}
      />
    </Screen>
  );
}
