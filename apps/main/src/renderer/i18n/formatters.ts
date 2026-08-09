import { useMemo } from 'react';

import { useLocale } from 'use-intl';

import type { Locale } from '@/renderer/i18n/config';

const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB'];

function parseInstant(value: string) {
   const parsed = new Date(value);

   return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createFormatters(locale: Locale) {
   const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
   const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
   const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
   const countFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
   const sizeFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

   return {
      dateTime(value: string) {
         const at = parseInstant(value);

         return at ? dateTimeFormat.format(at) : value;
      },
      date(value: string) {
         const at = parseInstant(value);

         return at ? dateFormat.format(at) : value;
      },
      time(value: string) {
         const at = parseInstant(value);

         return at ? timeFormat.format(at) : value;
      },
      count(value: number) {
         return countFormat.format(value);
      },
      bytes(value: number) {
         let size = Math.max(value, 0);
         let unit = 'B';

         for (const candidate of byteUnits) {
            unit = candidate;
            if (size < 1024) break;
            if (candidate !== 'TB') size /= 1024;
         }

         const digits = unit === 'B' || size >= 100 ? countFormat : sizeFormat;

         return `${digits.format(size)} ${unit}`;
      }
   };
}

export type Formatters = ReturnType<typeof createFormatters>;

export function useFormatters() {
   const locale = useLocale();

   return useMemo(() => createFormatters(locale), [locale]);
}
