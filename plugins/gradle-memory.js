// Release builds run Android lint over every native module in parallel, and
// the template's 512 MB metaspace runs out (lint crashes with "Metaspace").
// Give the Gradle daemon more room on every prebuild.
const { withGradleProperties } = require('expo/config-plugins');

const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

function setProperty(props, key, value) {
  const rest = props.filter((p) => !(p.type === 'property' && p.key === key));
  return [...rest, { type: 'property', key, value }];
}

function withGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    config.modResults = setProperty(config.modResults, 'org.gradle.jvmargs', JVM_ARGS);
    return config;
  });
}

module.exports = withGradleMemory;
module.exports.setProperty = setProperty;
