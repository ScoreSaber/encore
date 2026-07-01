import en from '../../messages/en.json';

import type { Locale } from '@/i18n/config';

export type Messages = typeof en;

export const messagesByLocale = {
   en
} satisfies Record<Locale, Messages>;
