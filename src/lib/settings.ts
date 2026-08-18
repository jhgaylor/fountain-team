/** Where the app points and how it authenticates. Stored locally, in this browser only. */
export interface Settings {
  baseUrl: string;
  apiKey: string;
}

const KEY = "fountain-team.settings";

export function loadSettings(): Settings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (typeof parsed.baseUrl !== "string" || typeof parsed.apiKey !== "string") return null;
    return { baseUrl: normalizeBaseUrl(parsed.baseUrl), apiKey: parsed.apiKey };
  } catch {
    return null;
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify({ baseUrl: normalizeBaseUrl(s.baseUrl), apiKey: s.apiKey }));
}

export function clearSettings(): void {
  localStorage.removeItem(KEY);
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}
