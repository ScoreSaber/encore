import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Result } from 'better-result';

import { useSettings } from '@/modules/settings/settings-provider';
import { readStorageValue } from '@/shared/result/storage';
import { parseTheme, type ResolvedTheme, type Theme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY, themes } from '@/shared/ui-adjacent/theme';

type ThemeContextValue = {
   theme: Theme;
   setTheme: (theme: string) => void;
   resolvedTheme: ResolvedTheme;
   systemTheme: ResolvedTheme;
   themes: readonly Theme[];
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
   if (typeof window === 'undefined') return 'dark';
   return window.matchMedia(THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
}

function getInitialTheme(): Theme {
   if (typeof window === 'undefined') return 'system';
   return parseTheme(Result.unwrapOr(readStorageValue(THEME_STORAGE_KEY), null));
}

function applyTheme(resolved: ResolvedTheme) {
   const root = document.documentElement;
   root.classList.remove('light', 'dark');
   root.classList.add(resolved);
   root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
   const settings = useSettings();
   const [theme, setThemeState] = useState<Theme>(getInitialTheme);
   const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
   const resolvedTheme = theme === 'system' ? systemTheme : theme;

   const setTheme = useCallback(
      (next: string) => {
         const validated = parseTheme(next);
         if (validated === theme) return;

         if (validated === 'system') {
            setSystemTheme(getSystemTheme());
         }

         setThemeState(validated);
         void settings.updateApp({ theme: validated }).then((result) => {
            if (!result.ok) setThemeState(settings.snapshot?.app.theme ?? theme);
         });
      },
      [settings, theme]
   );

   useEffect(() => {
      const settingsTheme = settings.snapshot?.app.theme;
      if (!settingsTheme || settingsTheme === theme) return;

      if (settingsTheme === 'system') {
         setSystemTheme(getSystemTheme());
      }

      setThemeState(settingsTheme);
   }, [settings.snapshot?.app.theme, theme]);

   useEffect(() => {
      applyTheme(resolvedTheme);
   }, [resolvedTheme]);

   useEffect(() => {
      if (theme !== 'system') return;

      const mq = window.matchMedia(THEME_MEDIA_QUERY);
      const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
      setSystemTheme(mq.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
   }, [theme]);

   const value = useMemo<ThemeContextValue>(
      () => ({ theme, setTheme, resolvedTheme, systemTheme, themes }),
      [theme, setTheme, resolvedTheme, systemTheme]
   );

   return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
   const ctx = useContext(ThemeContext);
   if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
   return ctx;
}
