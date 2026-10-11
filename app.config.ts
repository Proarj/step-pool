import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each free Apple account needs its own bundle id: IOS_BUNDLE_ID=com.<name>.steppool
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'com.steppool.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'StepPool',
  slug: 'step-pool',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'steppool',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    icon: './assets/expo.icon',
  },
  android: {
    package: 'com.steppool.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
    ],
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { backgroundColor: '#208AEF', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription: 'StepPool reads your step count to check your daily goal.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    'react-native-health-connect',
    [
      'expo-build-properties',
      { android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 26 } },
    ],
    'expo-background-task',
    'expo-notifications',
    './plugins/without-push-entitlement',
    './plugins/gradle-memory',
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { buildTime: new Date().toISOString() },
});
