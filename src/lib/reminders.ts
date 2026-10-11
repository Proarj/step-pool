import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { expiryReminderDate } from './reminder-dates';

const CHANNEL = 'reminders';

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** (Re)schedules the 23:30 sync reminder and, on iOS, the build-expiry reminder. */
export async function scheduleReminders(now: Date = new Date()): Promise<boolean> {
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Sync before midnight', body: "Open StepPool and tap Sync so today's steps count." },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 23, minute: 30, channelId: CHANNEL },
  });

  const buildTime = Constants.expoConfig?.extra?.buildTime;
  const expiry = Platform.OS === 'ios' && typeof buildTime === 'string' ? expiryReminderDate(buildTime) : null;
  if (expiry && expiry > now) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Re-run StepPool from Xcode today', body: 'This free iPhone build stops opening tomorrow.' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: expiry },
    });
  }
  return true;
}
