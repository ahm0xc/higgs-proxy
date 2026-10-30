export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";

function readStoredPreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : null;
  } catch {
    return null;
  }
}

function storePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); ignore.
  }
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(preference) === "dark",
  );
}

// Module-level store: the preference picker lives inside a dropdown that
// unmounts, and the OS listener must outlive every component.
let preference: ThemePreference | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getThemePreference(): ThemePreference {
  preference ??= readStoredPreference() ?? "system";
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(getThemePreference());
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  storePreference(next);
  applyTheme(next);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

applyTheme(getThemePreference());

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (getThemePreference() === "system") {
      applyTheme("system");
      notify();
    }
  });

export { subscribe as subscribeToTheme };
