import { Box } from 'lucide-react';

import { cn } from '@/components/utils';

import { defaultInstallColor } from '@/modules/installs/contract';
import type { StoreKind } from '@/modules/stores/contract';
import { StoreIcon } from '@/modules/stores/renderer/store-icon';

type InstallColorSwatchProps = {
   color: string | null;
   className?: string;
} & ({ label: string; onClick: () => void } | { label?: never; onClick?: never });

export function InstallColorSwatch({ color, className, label, onClick }: InstallColorSwatchProps) {
   const appearance = cn(
      'size-2.5 shrink-0 rounded-full ring-1 ring-black/25',
      onClick &&
         'cursor-pointer transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      className
   );
   const style = { backgroundColor: color ?? defaultInstallColor };

   return onClick ? (
      <button type="button" className={appearance} style={style} aria-label={label} onClick={onClick} />
   ) : (
      <span className={appearance} style={style} aria-hidden />
   );
}

export function InstallPlatformIcon({ store, className }: { store: StoreKind | null; className?: string }) {
   return store ? (
      <StoreIcon store={store} className={cn('size-4 shrink-0', className)} aria-hidden />
   ) : (
      <Box className={cn('size-4 shrink-0', className)} aria-hidden />
   );
}
