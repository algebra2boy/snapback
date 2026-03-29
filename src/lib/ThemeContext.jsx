import { createContext, useContext, useEffect, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
export const THEMES = {
  default: "default",
  pixel: "pixel",
};

const STORAGE_KEY = "snapback-theme";

// ── Context ───────────────────────────────────────────────────────────────────
const ThemeContext = createContext({
  theme: THEMES.default,
  setTheme: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && Object.values(THEMES).includes(saved)
        ? saved
        : THEMES.default;
    } catch {
      return THEMES.default;
    }
  });

  // Sync class on <html> whenever theme changes
  useEffect(() => {
    const root = document.documentElement;

    // Remove all known theme classes first
    Object.values(THEMES).forEach((t) => {
      if (t !== THEMES.default) {
        root.classList.remove(`theme-${t}`);
      }
    });

    // Apply the selected theme class (default needs no class)
    if (theme !== THEMES.default) {
      root.classList.add(`theme-${theme}`);
    }
  }, [theme]);

  const setTheme = (next) => {
    if (!Object.values(THEMES).includes(next)) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — still update in-memory state
    }
    setThemeState(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useTheme() {
  return useContext(ThemeContext);
}
