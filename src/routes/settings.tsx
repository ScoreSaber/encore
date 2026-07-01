import { createFileRoute } from '@tanstack/react-router';
import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { localeNames, locales } from '@/i18n/config';
import { useLocale } from '@/i18n/locale-provider';
import { useTheme } from '@/shared/ui-adjacent/theme-provider';

export const Route = createFileRoute('/settings')({
   component: SettingsRoute
});

function SettingsRoute() {
   const t = useTranslations('settings');
   const { locale, setLocale } = useLocale();
   const { theme, setTheme } = useTheme();

   return (
      <div className="grid gap-4 lg:grid-cols-2">
         <Card>
            <CardHeader>
               <CardTitle>{t('language.title')}</CardTitle>
               <CardDescription>{t('language.description')}</CardDescription>
            </CardHeader>
            <CardContent>
               <Select value={locale} onValueChange={setLocale}>
                  <SelectTrigger className="w-full">
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectGroup>
                        {locales.map((item) => (
                           <SelectItem key={item} value={item}>
                              {localeNames[item]}
                           </SelectItem>
                        ))}
                     </SelectGroup>
                  </SelectContent>
               </Select>
            </CardContent>
         </Card>

         <Card>
            <CardHeader>
               <CardTitle>{t('theme.title')}</CardTitle>
               <CardDescription>{t('theme.description')}</CardDescription>
            </CardHeader>
            <CardContent>
               <div className="grid gap-2 sm:grid-cols-3">
                  <Button variant={theme === 'light' ? 'default' : 'secondary'} onClick={() => setTheme('light')}>
                     <Sun data-icon="inline-start" />
                     {t('theme.light')}
                  </Button>
                  <Button variant={theme === 'dark' ? 'default' : 'secondary'} onClick={() => setTheme('dark')}>
                     <Moon data-icon="inline-start" />
                     {t('theme.dark')}
                  </Button>
                  <Button variant={theme === 'system' ? 'default' : 'secondary'} onClick={() => setTheme('system')}>
                     <SunMoon data-icon="inline-start" />
                     {t('theme.system')}
                  </Button>
               </div>
            </CardContent>
         </Card>
      </div>
   );
}
