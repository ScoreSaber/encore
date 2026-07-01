import { z } from 'zod';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const themeSchema = z.enum(['light', 'dark', 'system']);
export const themes = themeSchema.options;

export type Theme = z.infer<typeof themeSchema>;
export type ResolvedTheme = 'light' | 'dark';

export function parseTheme(value: string | null | undefined): Theme {
   return themeSchema.catch('system').parse(value);
}
