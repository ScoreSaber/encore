import { z } from 'zod';

export const localeSchema = z.enum(['en', 'zh-CN']);
export const locales = localeSchema.options;
export type Locale = z.infer<typeof localeSchema>;
export const defaultLocale: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'locale';

export const localeNames = {
   en: 'English',
   'zh-CN': '简体中文'
};

export function parseLocale(value: string | null | undefined): Locale {
   if (!value) return defaultLocale;
   return resolveLocaleCandidate(value) ?? defaultLocale;
}

export function getBrowserLocale() {
   const primary = resolveLocaleCandidate(navigator.language);
   if (primary) return primary;

   for (const candidate of navigator.languages) {
      const locale = resolveLocaleCandidate(candidate);
      if (locale) return locale;
   }

   return defaultLocale;
}

function resolveLocaleCandidate(candidate: string): Locale | null {
   const exact = locales.find((locale) => locale.toLowerCase() === candidate.toLowerCase());
   if (exact) return exact;

   const language = primaryLanguage(candidate);
   return locales.find((locale) => primaryLanguage(locale) === language) ?? null;
}

function primaryLanguage(tag: string) {
   return (tag.split('-')[0] ?? tag).toLowerCase();
}
