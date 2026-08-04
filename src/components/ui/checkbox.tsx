'use client';

import * as React from 'react';

import { CheckIcon, MinusIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';

import { cn } from '@/components/utils';

function Checkbox({ className, checked, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
   return (
      <CheckboxPrimitive.Root
         data-slot="checkbox"
         checked={checked}
         className={cn(
            'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary dark:data-[state=indeterminate]:bg-primary aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 cursor-default rounded-sm border shadow-xs transition-shadow outline-none disabled:cursor-not-allowed disabled:opacity-50',
            className
         )}
         {...props}
      >
         <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current transition-none">
            {checked === 'indeterminate' ? <MinusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
         </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
   );
}

export { Checkbox };
