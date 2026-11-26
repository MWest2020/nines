// Capacitor reads this when the Android project is added (phase 3, see ARCHITECTURE.md).
// The app id is configurable; work.westerweel.nines is the default (Mark, 26 Nov 2026).
// Signing is never configured here: release signing comes from environment variables.

const config = {
  appId: process.env['NINES_APP_ID'] ?? 'work.westerweel.nines',
  appName: 'Nines',
  webDir: 'dist',
  android: {
    // No remote content, no mixed content, no WebView debugging in release builds.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
