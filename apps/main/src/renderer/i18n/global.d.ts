import type { Locale } from '@/renderer/i18n/config';
import type { Messages } from '@/renderer/i18n/messages';

declare module 'use-intl' {
   interface AppConfig {
      Locale: Locale;
      Messages: Messages;
   }
}
