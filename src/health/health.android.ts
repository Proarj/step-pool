import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import { Linking } from 'react-native';
import type { HealthApi, HealthStatus } from './types';

// Android 13 and older need the Health Connect app from the Play Store.
const STORE_APP = 'market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding';
const STORE_WEB = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

let initialized = false;
async function ensureInitialized(): Promise<boolean> {
  if (!initialized) initialized = await initialize();
  return initialized;
}

async function status(): Promise<HealthStatus> {
  const sdk = await getSdkStatus();
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs-update';
  if (sdk !== SdkAvailabilityStatus.SDK_AVAILABLE || !(await ensureInitialized())) return 'unavailable';
  const granted = await getGrantedPermissions();
  return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read') ? 'ready' : 'needs-permission';
}

export const health: HealthApi = {
  source: 'health_connect',
  status,
  async requestAccess() {
    const before = await status();
    if (before === 'unavailable' || before === 'needs-update') return before;
    await requestPermission([
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'BackgroundAccessPermission' },
    ]);
    return status();
  },
  async readSteps(start, end) {
    await ensureInitialized();
    // The aggregate applies the user's Health Connect source priority, so a
    // Garmin/Zepp watch and the phone are not counted twice. It cannot leave
    // out hand-entered steps, so Android falls back to trust (spec §5).
    const result = await aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    });
    return result.COUNT_TOTAL ?? 0;
  },
  async openSettings() {
    const current = await status();
    if (current === 'needs-update' || current === 'unavailable') {
      await Linking.openURL(STORE_APP).catch(() => Linking.openURL(STORE_WEB));
      return;
    }
    try {
      openHealthConnectSettings();
    } catch {
      await Linking.openURL(STORE_WEB);
    }
  },
};
