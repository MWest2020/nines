// Capacitor reads this for `npx cap sync android` (ARCHITECTURE.md, Android).
// The app id is configurable; work.westerweel.nines is the default (Mark, 26 Nov 2026).
// Signing is never configured here: release signing comes from environment variables.

const config = {
  appId: process.env['NINES_APP_ID'] ?? 'work.westerweel.nines',
  appName: 'Nines',
  webDir: 'dist',
  // the game's background behind the WebView while it loads, instead of a white flash
  backgroundColor: '#101820',
  android: {
    // No remote content, no mixed content, no WebView debugging in release builds.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // light status and navigation bar icons over the game's dark background
    SystemBars: { style: 'DARK' },
  },
};

export default config;
