import { Result } from 'better-result';

import { readStorageValue } from '@/shared/result/storage';
import { parseTheme, type ResolvedTheme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from '@/shared/ui-adjacent/theme';

function getSystemTheme(): ResolvedTheme {
   return window.matchMedia(THEME_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function applyInitialTheme() {
   const theme = parseTheme(Result.unwrapOr(readStorageValue(THEME_STORAGE_KEY), null));
   const resolved = theme === 'system' ? getSystemTheme() : theme;
   const root = document.documentElement;

   root.classList.remove('light', 'dark');
   root.classList.add(resolved);
   root.style.colorScheme = resolved;
}
