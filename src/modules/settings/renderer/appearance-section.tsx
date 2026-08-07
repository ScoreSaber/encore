import { Moon, Sun, SunMoon } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ColorPicker } from '@/components/ui/color-picker';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { localeNames, locales } from '@/app/renderer/i18n/config';
import { useLocale } from '@/app/renderer/i18n/locale-provider';
import { useTheme } from '@/app/renderer/theme/theme-provider';
import { themes } from '@/modules/settings/contract';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';

export function AppearanceSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings');
   const { locale, setLocale } = useLocale();
   const { accentColor, setAccentColor, theme, setTheme } = useTheme();

   return (
      <SettingsSection title={t('appearance.title')}>
         <SettingsRow label={t('language.title')} htmlFor="settings-locale">
            <Select value={locale} onValueChange={setLocale} disabled={disabled}>
               <SelectTrigger id="settings-locale" className="w-full min-w-44 @md/field-group:w-48">
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
         </SettingsRow>

         <SettingsRow label={t('theme.title')} id="settings-theme">
            <ToggleGroup
               className="flex-wrap justify-start @md/field-group:justify-end"
               type="single"
               value={theme}
               spacing={2}
               aria-labelledby="settings-theme"
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
         </SettingsRow>

         <SettingsRow label={t('accentColor.title')}>
            <ColorPicker
               disabled={disabled}
               label={t('accentColor.pickerLabel')}
               inputLabel={t('accentColor.inputLabel')}
               value={accentColor}
               onChange={setAccentColor}
            />
         </SettingsRow>
      </SettingsSection>
   );
}
