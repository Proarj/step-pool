import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { registerBackgroundSync } from '@/lib/background';
import { configureNotifications, scheduleReminders } from '@/lib/reminders';
import { SessionProvider, useSession } from '@/lib/session';
import { syncNow } from '@/lib/sync';
import { useTheme } from '@/ui/theme';

configureNotifications();

function RootStack() {
  const { session, loading } = useSession();
  const t = useTheme();
  const signedIn = !!session;

  useEffect(() => {
    if (!signedIn) return;
    void registerBackgroundSync();
    void scheduleReminders();
    void syncNow().catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow().catch(() => undefined);
    });
    return () => sub.remove();
  }, [signedIn]);

  if (loading) return null;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.background },
      }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'StepPool' }} />
        <Stack.Screen name="setup" options={{ title: 'Step access' }} />
        <Stack.Screen name="create" options={{ title: 'New group', presentation: 'modal' }} />
        <Stack.Screen name="join" options={{ title: 'Join a group', presentation: 'modal' }} />
        <Stack.Screen name="group/[id]/index" options={{ title: 'Today' }} />
        <Stack.Screen name="group/[id]/history" options={{ title: 'History' }} />
        <Stack.Screen name="group/[id]/settings" options={{ title: 'Group settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <RootStack />
    </SessionProvider>
  );
}
