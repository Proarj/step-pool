import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
type Prop = { type: 'property'; key: string; value: string } | { type: 'comment'; value: string };
const { setProperty } = require('./gradle-memory.js') as {
  setProperty(props: Prop[], key: string, value: string): Prop[];
};

describe('setProperty', () => {
  it('replaces an existing gradle property and keeps the rest', () => {
    const props: Prop[] = [
      { type: 'comment', value: 'JVM settings' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx2048m -XX:MaxMetaspaceSize=512m' },
      { type: 'property', key: 'org.gradle.parallel', value: 'true' },
    ];
    expect(setProperty(props, 'org.gradle.jvmargs', '-Xmx4096m')).toEqual([
      { type: 'comment', value: 'JVM settings' },
      { type: 'property', key: 'org.gradle.parallel', value: 'true' },
      { type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m' },
    ]);
  });

  it('adds the property when it is missing', () => {
    expect(setProperty([], 'org.gradle.jvmargs', '-Xmx4096m'))
      .toEqual([{ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx4096m' }]);
  });
});
