import { useEffect, useSyncExternalStore } from 'react';

import { Result } from 'better-result';

import { accentColorSchema, defaultAccentColor, themeSchema, type ResolvedTheme } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { readStorageValue, writeStorageValue } from '@/renderer/storage';

const themeStorageKey = 'theme';
const darkQuery = '(prefers-color-scheme: dark)';

function parseTheme(value: string | null) {
   return themeSchema.catch('system').parse(value);
}

function storedTheme() {
   return parseTheme(Result.unwrapOr(readStorageValue(themeStorageKey), null));
}

function systemTheme(): ResolvedTheme {
   return window.matchMedia(darkQuery).matches ? 'dark' : 'light';
}

function subscribeSystemTheme(listener: () => void) {
   const query = window.matchMedia(darkQuery);
   query.addEventListener('change', listener);
   return () => query.removeEventListener('change', listener);
}

function applyTheme(theme: ResolvedTheme) {
   const root = document.documentElement;
   root.classList.remove('light', 'dark');
   root.classList.add(theme);
   root.style.colorScheme = theme;
}

function accentForeground(color: string) {
   const linearChannel = (start: number) => {
      const channel = Number.parseInt(color.slice(start, start + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
   };
   const luminance = linearChannel(1) * 0.2126 + linearChannel(3) * 0.7152 + linearChannel(5) * 0.0722;

   return luminance > 0.179 ? '#1c1917' : '#ffffff';
}

export function applyInitialTheme() {
   const theme = storedTheme();
   applyTheme(theme === 'system' ? systemTheme() : theme);
}

export function useTheme() {
   const settings = useSettings();
   const system = useSyncExternalStore(subscribeSystemTheme, systemTheme);
   const theme = settings.snapshot?.app.theme ?? storedTheme();
   const accentColor = settings.snapshot?.app.accentColor ?? defaultAccentColor;

   return {
      theme,
      resolvedTheme: theme === 'system' ? system : theme,
      accentColor,
      setTheme: (next: string) => {
         const parsed = parseTheme(next);
         if (parsed !== theme) void settings.updateApp({ theme: parsed });
      },
      setAccentColor: (next: string) => {
         const parsed = accentColorSchema.catch(defaultAccentColor).parse(next);
         if (parsed !== accentColor) void settings.updateApp({ accentColor: parsed });
      }
   };
}

export function ThemeEffects() {
   const { theme, resolvedTheme, accentColor } = useTheme();

   useEffect(() => {
      applyTheme(resolvedTheme);
      writeStorageValue(themeStorageKey, theme);
   }, [resolvedTheme, theme]);

   useEffect(() => {
      const root = document.documentElement;
      root.style.setProperty('--primary', accentColor);
      root.style.setProperty('--primary-foreground', accentForeground(accentColor));
      root.style.setProperty('--ring', accentColor);
   }, [accentColor]);

   return null;
}
