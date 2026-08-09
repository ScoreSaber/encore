import { Result } from 'better-result';

import { readStorageValue } from '@/renderer/storage';
import { parseTheme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from '@/renderer/theme/theme';

export function applyInitialTheme() {
   const theme = parseTheme(Result.unwrapOr(readStorageValue(THEME_STORAGE_KEY), null));
   const resolved = theme === 'system' ? (window.matchMedia(THEME_MEDIA_QUERY).matches ? 'dark' : 'light') : theme;
   const root = document.documentElement;

   root.classList.remove('light', 'dark');
   root.classList.add(resolved);
   root.style.colorScheme = resolved;
}
