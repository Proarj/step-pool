import { describe, expect, it } from 'vitest';
import { routerPathFor } from './system-path';

describe('routerPathFor', () => {
  it('ignores the sign-in redirect while the app is running (signInWithGoogle consumes it)', () => {
    expect(routerPathFor('steppool://auth-callback?code=abc', false)).toBeNull();
    expect(routerPathFor('/auth-callback?code=abc', false)).toBeNull();
  });

  it('follows the sign-in redirect when it cold-starts the app, so the code can still be exchanged', () => {
    expect(routerPathFor('steppool://auth-callback?code=abc', true)).toBe('steppool://auth-callback?code=abc');
  });

  it('leaves every other link alone', () => {
    expect(routerPathFor('steppool://group/123', false)).toBe('steppool://group/123');
  });
});
