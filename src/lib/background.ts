import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { syncNow } from './sync';

const SYNC_TASK = 'steppool-sync';

// Must be defined at module load (the OS can start the app just to run it).
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return BackgroundTask.BackgroundTaskResult.Success;
    await syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // Locked iPhone, no permission yet, or offline: try again next time.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 30 });
}
