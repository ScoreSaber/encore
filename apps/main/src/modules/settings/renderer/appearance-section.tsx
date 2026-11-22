import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ColorPicker } from '@/components/ui/color-picker';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { themes } from '@/modules/settings/contract';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { localeNames, locales } from '@/renderer/i18n/config';
import { useLocale } from '@/renderer/i18n/locale-provider';
import { useTheme } from '@/renderer/theme/theme';

export function LanguageRow({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings');
   const { locale, setLocale } = useLocale();

   return (
      <SettingsRow
         title={t('language.title')}
         htmlFor="settings-locale"
         control={
            <Select value={locale} onValueChange={setLocale} disabled={disabled}>
               <SelectTrigger id="settings-locale" size="sm" className="w-full sm:w-44">
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
         }
      />
   );
}

export function AppearanceSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings');
   const { accentColor, setAccentColor, theme, setTheme } = useTheme();

   return (
      <SettingsSection>
         <SettingsRow
            title={t('theme.title')}
            control={
               <ToggleGroup
                  className="flex-wrap justify-start"
                  type="single"
                  size="sm"
                  value={theme}
                  spacing={2}
                  aria-label={t('theme.title')}
                  disabled={disabled}
                  onValueChange={(value) => {
                     if (value) setTheme(value);
                  }}
               >
                  {themes.map((item) => {
                     const Icon = item === 'light' ? Sun : item === 'dark' ? Moon : SunMoon;
                     return (
                        <ToggleGroupItem key={item} value={item}>
                           <Icon />
                           {t(`theme.${item}`)}
                        </ToggleGroupItem>
                     );
                  })}
               </ToggleGroup>
            }
         />

         <SettingsRow
            title={t('accentColor.title')}
            control={
               <ColorPicker
                  disabled={disabled}
                  label={t('accentColor.pickerLabel')}
                  inputLabel={t('accentColor.inputLabel')}
                  value={accentColor}
                  onChange={setAccentColor}
               />
            }
         />
      </SettingsSection>
   );
}
