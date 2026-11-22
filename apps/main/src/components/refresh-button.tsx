import { useEffect, useRef, useState } from 'react';

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

const minimumSpinMs = 500;

export function RefreshButton({
   label,
   busy = false,
   disabled,
   onClick,
   ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'children' | 'onClick' | 'size' | 'type'> & {
   label: string;
   busy?: boolean;
   onClick: () => void | Promise<void>;
}) {
   const [pending, setPending] = useState(false);
   const pendingRef = useRef(false);
   const mountedRef = useRef(true);
   const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   const spinning = busy || pending;

   useEffect(
      () => () => {
         mountedRef.current = false;
         if (timerRef.current) clearTimeout(timerRef.current);
      },
      []
   );

   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <Button
               type="button"
               variant="outline"
               size="icon-sm"
               aria-label={label}
               aria-busy={spinning}
               disabled={spinning || disabled}
               onClick={() => {
                  if (pendingRef.current) return;

                  const result = onClick();
                  if (!(result instanceof Promise)) return;

                  pendingRef.current = true;
                  setPending(true);
                  const minimumDelay = new Promise<void>((resolve) => {
                     timerRef.current = setTimeout(() => {
                        timerRef.current = null;
                        resolve();
                     }, minimumSpinMs);
                  });
                  void Promise.allSettled([result, minimumDelay]).then(() => {
                     pendingRef.current = false;
                     if (mountedRef.current) setPending(false);
                  });
               }}
               {...props}
            >
               <RefreshCw className={cn(spinning && 'animate-spin')} />
            </Button>
         </TooltipTrigger>
         <TooltipContent>{label}</TooltipContent>
      </Tooltip>
   );
}
