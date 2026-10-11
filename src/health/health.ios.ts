import {
  AuthorizationRequestStatus,
  ComparisonPredicateOperator,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';
import type { HealthApi, HealthStatus } from './types';

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
// Release builds ignore steps typed into the Health app by hand. Dev builds
// keep them so the iOS Simulator's Health app can be used for testing.
const EXCLUDE_HAND_ENTERED = !__DEV__;

async function status(): Promise<HealthStatus> {
  if (!isHealthDataAvailable()) return 'unavailable';
  // HealthKit never reveals whether *read* access was granted, only whether we asked.
  const asked = await getRequestStatusForAuthorization({ toRead: [STEPS] });
  return asked === AuthorizationRequestStatus.unnecessary ? 'ready' : 'needs-permission';
}

export const health: HealthApi = {
  source: 'apple_health',
  status,
  async requestAccess() {
    if (!isHealthDataAvailable()) return 'unavailable';
    await requestAuthorization({ toRead: [STEPS] });
    return status();
  },
  async readSteps(start, end) {
    const result = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
      unit: 'count',
      filter: {
        date: { startDate: start, endDate: end },
        ...(EXCLUDE_HAND_ENTERED
          ? { NOT: [{ metadata: { withMetadataKey: 'HKWasUserEntered', operatorType: ComparisonPredicateOperator.equalTo, value: true } }] }
          : {}),
      },
    });
    return result.sumQuantity?.quantity ?? 0;
  },
  async openSettings() {
    await Linking.openURL('x-apple-health://');
  },
};
