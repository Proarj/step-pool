/**
 * Which incoming link the router should follow. On Android the sign-in
 * redirect (steppool://auth-callback?code=…) reaches both openAuthSessionAsync
 * and the router; letting the router also navigate strands the user on a
 * blank screen. While the app is running, signInWithGoogle consumes it, so the
 * router ignores it. On a cold start the auth-callback screen finishes sign-in.
 */
export function routerPathFor(path: string, initial: boolean): string | null {
  if (!initial && path.includes('auth-callback')) return null;
  return path;
}
