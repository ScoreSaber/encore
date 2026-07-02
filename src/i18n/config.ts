import { z } from 'zod';

export const localeSchema = z.enum(['en']);
export const locales = localeSchema.options;
export type Locale = z.infer<typeof localeSchema>;
export const defaultLocale: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'locale';

export const localeNames: Record<Locale, string> = {
   en: 'English'
};

export function parseLocale(value: string | null | undefined): Locale {
   return localeCandidateSchema.catch(defaultLocale).parse(value);
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
   const result = localeCandidateSchema.safeParse(candidate);
   return result.success ? result.data : null;
}

const localeCandidateSchema = z
   .string()
   .transform((value) => value.split('-')[0])
   .pipe(localeSchema);
