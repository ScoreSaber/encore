import { Search } from 'lucide-react';

import { RefreshButton } from '@/components/refresh-button';
import { ButtonGroup } from '@/components/ui/button-group';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

export function CollectionToolbar({
   label,
   filter,
   note,
   rescan,
   menu,
   children
}: {
   label: string;
   filter: { value: string; label: string; onChange: (value: string) => void } | null;
   note?: string | null;
   rescan: { label: string; busy: boolean; onClick: () => void };
   menu?: React.ReactNode;
   children?: React.ReactNode;
}) {
   return (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
         {filter ? (
            <InputGroup className="h-8 w-56">
               <InputGroupInput
                  value={filter.value}
                  aria-label={filter.label}
                  placeholder={filter.label}
                  onChange={(event) => filter.onChange(event.target.value)}
               />
               <InputGroupAddon>
                  <Search />
               </InputGroupAddon>
            </InputGroup>
         ) : null}

         {note ? <span className="text-muted-foreground text-xs">{note}</span> : null}

         <div className="ml-auto flex shrink-0 items-center gap-2">
            {children}

            <ButtonGroup aria-label={label}>
               {menu}
               <RefreshButton label={rescan.label} busy={rescan.busy} onClick={rescan.onClick} />
            </ButtonGroup>
         </div>
      </div>
   );
}
