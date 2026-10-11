import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { parseAuthCallback } from './auth-callback';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_TO = Linking.createURL('auth-callback'); // steppool://auth-callback

/** Google sign-in in the system browser (PKCE). Resolves without a session if the user cancels. */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_TO);
  if (result.type !== 'success') return;
  const parsed = parseAuthCallback(result.url);
  if ('error' in parsed) throw new Error(parsed.error);
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(parsed.code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
