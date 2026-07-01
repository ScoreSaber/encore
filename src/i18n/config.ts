export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'locale';

export const localeNames: Record<Locale, string> = {
   en: 'English'
};

export function parseLocale(value: string | null | undefined): Locale {
   if (!value) return defaultLocale;
   return resolveLocaleCandidate(value) ?? defaultLocale;
}

export function getBrowserLocale() {
   if (typeof navigator === 'undefined') return defaultLocale;

   const primary = resolveLocaleCandidate(navigator.language);
   if (primary) return primary;

   for (const candidate of navigator.languages) {
      const locale = resolveLocaleCandidate(candidate);
      if (locale) return locale;
   }

   return defaultLocale;
}

function resolveLocaleCandidate(candidate: string): Locale | null {
   const language = candidate.split('-')[0];

   for (const locale of locales) {
      if (candidate === locale || language === locale) return locale;
   }

   return null;
}
