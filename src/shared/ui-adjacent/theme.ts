export const THEME_STORAGE_KEY = 'theme';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const themes = ['light', 'dark', 'system'] as const;

export type Theme = (typeof themes)[number];
export type ResolvedTheme = 'light' | 'dark';

export function parseTheme(value: string | null | undefined): Theme {
   switch (value) {
      case 'light':
      case 'dark':
      case 'system':
         return value;
      default:
         return 'system';
   }
}
