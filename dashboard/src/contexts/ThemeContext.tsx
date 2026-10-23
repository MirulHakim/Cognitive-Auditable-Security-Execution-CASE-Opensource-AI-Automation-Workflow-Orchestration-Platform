import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * User-facing theme preference. `system` follows the OS color scheme.
 */
export type ThemePreference = "light" | "dark" | "system";

/**
 * The theme actually applied to the document (never "system").
 */
export type ResolvedTheme = "light" | "dark";

// UI-REGION: Theme provider — light/dark/system preference applied via
// <html data-theme="...">, persisted to localStorage per device.
// TODO[BACKEND]: Persist the preference server-side (PUT
// /api/users/me/preferences with { theme }) so it follows the account across
// devices; keep localStorage as the offline fallback.
const STORAGE_KEY = "case_ui_theme";

interface ThemeContextValue {
  /** What the user picked: light, dark, or system. */
  theme: ThemePreference;
  /** What is currently applied to <html data-theme="...">. */
  resolvedTheme: ResolvedTheme;
  /** Live OS preference, tracked so "system" reacts to OS changes. */
  systemTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Storage unavailable (private mode / blocked cookies): fall through.
  }
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Track OS-level color scheme changes so "system" stays live.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : theme;

  // Apply the resolved theme to <html>. index.html runs an inline boot
  // script with the same logic, so there is no flash on first paint.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = (next: ThemePreference) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort; the in-memory state still applies.
    }
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, systemTheme, setTheme }),
    [theme, resolvedTheme, systemTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context provider + hook convention
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
