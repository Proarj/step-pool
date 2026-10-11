import { useState } from 'react';
import { Platform } from 'react-native';
import { health } from '@/health/health';
import type { HealthStatus } from '@/health/types';
import { syncNow } from '@/lib/sync';
import { useAsync } from '@/lib/use-async';
import { Body, Button, Card, Muted, Screen, Title } from '@/ui/kit';

const IOS_STEPS_PATH = 'Health app → your profile picture → Apps → StepPool → turn on Steps';

const STATUS_TEXT: Record<HealthStatus, string> = {
  // iOS never tells apps whether read access was granted, only that it was asked.
  ready: Platform.OS === 'ios'
    ? `StepPool has asked for step access. If your steps stay at 0, turn it on: ${IOS_STEPS_PATH}.`
    : 'Step access is on. StepPool syncs when you open it, in the background, and when you tap Sync.',
  'needs-permission': 'Allow StepPool to read your steps.',
  'needs-update': 'Install or update Health Connect from the Play Store, then come back.',
  unavailable: Platform.OS === 'android'
    ? 'This phone needs the Health Connect app from the Play Store.'
    : 'Step data isn’t available on this device.',
};

function settingsButtonTitle(status: HealthStatus | undefined): string {
  if (Platform.OS === 'ios') return 'Open the Health app';
  return status === 'needs-update' || status === 'unavailable' ? 'Get Health Connect' : 'Open Health Connect';
}

function PlatformNotes() {
  if (Platform.OS === 'ios') {
    return (
      <Card>
        <Body>iPhone + Apple Watch</Body>
        <Muted>StepPool reads the same step total the Health app shows, which already merges your iPhone and Apple Watch.</Muted>
        <Muted>If your steps stay at 0: {IOS_STEPS_PATH}.</Muted>
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
        title={settingsButtonTitle(status)}
        onPress={() => void health.openSettings()}
      />
    </Screen>
  );
}
