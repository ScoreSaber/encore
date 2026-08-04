import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Result } from 'better-result';

import { readStorageValue } from '@/app/renderer/storage';
import { parseTheme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from '@/app/renderer/theme/theme';
import { accentColorSchema, defaultAccentColor, themes, type ResolvedTheme, type Theme } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

type ThemeContextValue = {
   theme: Theme;
   setTheme: (theme: string) => void;
   accentColor: string;
   setAccentColor: (color: string) => void;
   resolvedTheme: ResolvedTheme;
   systemTheme: ResolvedTheme;
   themes: readonly Theme[];
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function parseAccentColor(value: string) {
   return accentColorSchema.catch(defaultAccentColor).parse(value);
}

function accentForeground(color: string) {
   const linearChannel = (start: number) => {
      const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
   };
   const luminance = linearChannel(1) * 0.2126 + linearChannel(3) * 0.7152 + linearChannel(5) * 0.0722;

   return luminance > 0.179 ? '#1c1917' : '#ffffff';
}

function getSystemTheme(): ResolvedTheme {
   return window.matchMedia(THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
   const settings = useSettings();
   const [theme, setThemeState] = useState<Theme>(() => parseTheme(Result.unwrapOr(readStorageValue(THEME_STORAGE_KEY), null)));
   const [accentColor, setAccentColorState] = useState(defaultAccentColor);
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

   const setAccentColor = useCallback(
      (next: string) => {
         const validated = parseAccentColor(next);
         if (validated === accentColor) return;

         setAccentColorState(validated);
         void settings.updateApp({ accentColor: validated }).then((result) => {
            if (!result.ok) setAccentColorState(settings.snapshot?.app.accentColor ?? accentColor);
         });
      },
      [accentColor, settings]
   );

   useEffect(() => {
      const settingsTheme = settings.snapshot?.app.theme;
      if (settings.saveStatus === 'saving' || !settingsTheme || settingsTheme === theme) return;

      if (settingsTheme === 'system') {
         setSystemTheme(getSystemTheme());
      }

      setThemeState(settingsTheme);
   }, [settings.saveStatus, settings.snapshot?.app.theme, theme]);

   useEffect(() => {
      const settingsAccentColor = settings.snapshot?.app.accentColor;
      if (settings.saveStatus !== 'saving' && settingsAccentColor && settingsAccentColor !== accentColor) setAccentColorState(settingsAccentColor);
   }, [accentColor, settings.saveStatus, settings.snapshot?.app.accentColor]);

   useEffect(() => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(resolvedTheme);
      root.style.colorScheme = resolvedTheme;
   }, [resolvedTheme]);

   useEffect(() => {
      const root = document.documentElement;
      root.style.setProperty('--primary', accentColor);
      root.style.setProperty('--primary-foreground', accentForeground(accentColor));
      root.style.setProperty('--ring', accentColor);
   }, [accentColor]);

   useEffect(() => {
      if (theme !== 'system') return;

      const mq = window.matchMedia(THEME_MEDIA_QUERY);
      const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
      setSystemTheme(mq.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
   }, [theme]);

   const value = useMemo(
      () => ({ theme, setTheme, accentColor, setAccentColor, resolvedTheme, systemTheme, themes }),
      [theme, setTheme, accentColor, setAccentColor, resolvedTheme, systemTheme]
   );

   return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
   const ctx = useContext(ThemeContext);
   if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
   return ctx;
}
