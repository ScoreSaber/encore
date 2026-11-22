import { useEffect } from 'react';

import { Result } from 'better-result';
import { IntlProvider } from 'use-intl';

import { useSettings } from '@/modules/settings/renderer/use-settings';
import { getBrowserLocale, LOCALE_STORAGE_KEY, parseLocale } from '@/renderer/i18n/config';
import { messagesByLocale } from '@/renderer/i18n/messages';
import { readStorageValue, writeStorageValue } from '@/renderer/storage';

const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function useLocale() {
   const settings = useSettings();
   const locale = settings.snapshot?.app.locale ?? parseLocale(Result.unwrapOr(readStorageValue(LOCALE_STORAGE_KEY), getBrowserLocale()));

   return {
      locale,
      setLocale: (next: string) => {
         const parsed = parseLocale(next);
         if (parsed !== locale) void settings.updateApp({ locale: parsed });
      }
   };
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
   const { locale } = useLocale();

   useEffect(() => {
      document.documentElement.lang = locale;
      writeStorageValue(LOCALE_STORAGE_KEY, locale);
   }, [locale]);

   return (
      <IntlProvider locale={locale} messages={messagesByLocale[locale]} timeZone={systemTimeZone}>
         {children}
      </IntlProvider>
   );
}
