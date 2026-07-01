import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Result } from 'better-result';
import { IntlProvider } from 'use-intl';

import { defaultLocale, getBrowserLocale, LOCALE_STORAGE_KEY, parseLocale, type Locale } from '@/i18n/config';
import { messagesByLocale } from '@/i18n/messages';
import { useSettings } from '@/modules/settings/settings-provider';
import { readStorageValue } from '@/shared/result/storage';

type LocaleContextValue = {
   locale: Locale;
   setLocale: (locale: string) => void;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

function getInitialLocale() {
   if (typeof window === 'undefined') return defaultLocale;
   return parseLocale(Result.unwrapOr(readStorageValue(LOCALE_STORAGE_KEY), getBrowserLocale()));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
   const settings = useSettings();
   const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

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

   const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);

   return (
      <LocaleContext value={value}>
         <IntlProvider locale={locale} messages={messagesByLocale[locale]} timeZone="UTC">
            {children}
         </IntlProvider>
      </LocaleContext>
   );
}

export function useLocale(): LocaleContextValue {
   const ctx = useContext(LocaleContext);
   if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
   return ctx;
}
