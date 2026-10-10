import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripPushEntitlement } = require('./strip-push-entitlement.js') as {
  stripPushEntitlement(xml: string): string;
};

const withPush = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>development</string>
  <key>com.apple.developer.healthkit</key>
  <true/>
</dict>
</plist>`;

describe('stripPushEntitlement', () => {
  it('removes aps-environment and keeps everything else', () => {
    const out = stripPushEntitlement(withPush);
    expect(out).not.toContain('aps-environment');
    expect(out).toContain('<key>com.apple.developer.healthkit</key>');
    expect(out).toContain('<true/>');
  });

  it('leaves a file without push untouched', () => {
    const clean = withPush.replace(/\s*<key>aps-environment<\/key>\s*<string>development<\/string>/, '');
    expect(stripPushEntitlement(clean)).toBe(clean);
  });
});
