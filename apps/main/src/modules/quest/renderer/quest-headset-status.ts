import { useTranslations } from 'use-intl';

import type { Target } from '@/modules/targets/contract';

export function useHeadsetStatus() {
   const t = useTranslations('quest.headsetStatus');

   return (headset: Target) => {
      const via = headset.via ?? '';
      if (headset.status === 'unpaired') return t('unpaired');
      if (headset.status !== 'ready') return t('offline', { connection: headset.connection ?? 'other', via });

      const ip = /^([\d.]+):\d+$/.exec(headset.address ?? '')?.[1];
      return t('connected', { connection: headset.connection ?? 'usb', via, address: ip ?? 'none' });
   };
}
