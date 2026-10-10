/** Reads what Supabase appended to steppool://auth-callback after Google sign-in. */
export function parseAuthCallback(url: string): { code: string } | { error: string } {
  const [beforeHash, fragment = ''] = url.split('#');
  const query = beforeHash.split('?')[1] ?? '';
  const params = new URLSearchParams([query, fragment].filter(Boolean).join('&'));
  const code = params.get('code');
  if (code) return { code };
  return { error: params.get('error_description') ?? params.get('error') ?? 'Sign-in was cancelled' };
}
