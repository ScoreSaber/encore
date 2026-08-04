import { themeSchema } from '@/modules/settings/contract';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export function parseTheme(value: string | null | undefined) {
   return themeSchema.catch('system').parse(value);
}
