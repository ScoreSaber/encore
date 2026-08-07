import { Search } from 'lucide-react';

import { RefreshButton } from '@/components/refresh-button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

export function CollectionToolbar({
   filter,
   note,
   rescan,
   menu,
   action,
   children
}: {
   filter: { value: string; label: string; onChange: (value: string) => void };
   note?: string | null;
   rescan: { label: string; busy: boolean; disabled?: boolean; onClick: () => void };
   menu?: React.ReactNode;
   action?: React.ReactNode;
   children?: React.ReactNode;
}) {
   return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
         <InputGroup className="h-8 min-w-40 flex-1">
            <InputGroupInput
               value={filter.value}
               aria-label={filter.label}
               placeholder={filter.label}
               onChange={(event) => filter.onChange(event.target.value)}
            />
            <InputGroupAddon>
               <Search />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end" className="gap-0 pr-1">
               {menu}
               <RefreshButton
                  label={rescan.label}
                  busy={rescan.busy}
                  disabled={rescan.disabled}
                  variant="ghost"
                  className="border-0 shadow-none"
                  onClick={rescan.onClick}
               />
            </InputGroupAddon>
         </InputGroup>

         {action}

         {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}

         {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
      </div>
   );
}
