import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function RefreshButton({
   label,
   busy = false,
   disabled,
   ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'children' | 'size' | 'type'> & { label: string; busy?: boolean }) {
   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm" aria-label={label} disabled={busy || disabled} {...props}>
               <RefreshCw className={busy ? 'animate-spin' : undefined} />
            </Button>
         </TooltipTrigger>
         <TooltipContent>{label}</TooltipContent>
      </Tooltip>
   );
}
