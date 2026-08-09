import en from './en.json';

import type { Locale } from '@/app/renderer/i18n/config';

export type Messages = typeof en;

export const messagesByLocale: Record<Locale, Messages> = {
   en
};
