// Registers the service worker that keeps the built files, so the game keeps working with the
// network off once it has loaded (ARCHITECTURE.md, Loading content offline). The worker itself
// is src/offline/sw.js, versioned by tools/vite-plugin-sw.ts; it never talks to another origin.

export function registerOffline(): void {
  // Only the built site: the dev server's modules change all the time. Service workers need a
  // secure context (https, or localhost while testing).
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  // The Android app carries its files inside the APK: nothing to keep.
  if ('Capacitor' in window) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    // refused (private mode, blocked storage): the game runs, only not offline
  });
}
