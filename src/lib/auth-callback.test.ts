import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './auth-callback';

describe('parseAuthCallback', () => {
  it('reads the PKCE code', () => {
    expect(parseAuthCallback('steppool://auth-callback?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads an error from the query or the fragment', () => {
    expect(parseAuthCallback('steppool://auth-callback?error=access_denied&error_description=User+denied+access'))
      .toEqual({ error: 'User denied access' });
    expect(parseAuthCallback('steppool://auth-callback#error=server_error'))
      .toEqual({ error: 'server_error' });
  });

  it('treats a bare redirect as cancelled', () => {
    expect(parseAuthCallback('steppool://auth-callback')).toEqual({ error: 'Sign-in was cancelled' });
  });
});
