import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Result } from 'better-result';
import { IntlProvider } from 'use-intl';

import { getBrowserLocale, LOCALE_STORAGE_KEY, parseLocale, type Locale } from '@/app/renderer/i18n/config';
import { messagesByLocale } from '@/app/renderer/i18n/messages';
import { readStorageValue } from '@/app/renderer/storage';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

type LocaleContextValue = {
   locale: Locale;
   setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function LocaleProvider({ children }: { children: React.ReactNode }) {
   const settings = useSettings();
   const [locale, setLocaleState] = useState<Locale>(() => parseLocale(Result.unwrapOr(readStorageValue(LOCALE_STORAGE_KEY), getBrowserLocale())));

   const setLocale = useCallback(
      (next: string) => {
         const validated = parseLocale(next);
         if (validated === locale) return;

         setLocaleState(validated);
         void settings.updateApp({ locale: validated }).then((result) => {
            if (!result.ok) setLocaleState(settings.snapshot?.app.locale ?? locale);
         });
      },
      [settings, locale]
   );

   useEffect(() => {
      document.documentElement.lang = locale;
   }, [locale]);

   useEffect(() => {
      const settingsLocale = settings.snapshot?.app.locale;
      if (!settingsLocale || settingsLocale === locale) return;

      setLocaleState(settingsLocale);
   }, [settings.snapshot?.app.locale, locale]);

   const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

   return (
      <LocaleContext value={value}>
         <IntlProvider locale={locale} messages={messagesByLocale[locale]} timeZone={systemTimeZone}>
            {children}
         </IntlProvider>
      </LocaleContext>
   );
}

export function useLocale() {
   const ctx = useContext(LocaleContext);
   if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
   return ctx;
}
