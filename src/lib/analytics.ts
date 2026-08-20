// PostHog session recordings are a build-time opt-in: set VITE_POSTHOG_KEY
// (the public `phc_` project key) and the app captures session replays plus
// pageviews; leave it unset (local dev, forks) and this is a no-op. All
// inputs are masked in recordings — people paste API keys into this app.
// Imported dynamically to keep posthog-js out of the app's startup chunk.
export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com",
      defaults: "2025-05-24",
      session_recording: { maskAllInputs: true },
    });
  });
}
