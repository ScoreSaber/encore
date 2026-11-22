import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { Target, TargetId } from '@/modules/targets/contract';
import { useTargetName, type TargetsLoadStatus } from '@/modules/targets/renderer/use-targets';

export function TargetPicker({
   id,
   className,
   label,
   targets,
   status,
   value,
   onChange
}: {
   id: string;
   className?: string;
   label: string;
   targets: Target[];
   status: TargetsLoadStatus;
   value: TargetId;
   onChange: (targetId: TargetId) => void;
}) {
   const targetName = useTargetName();
   if (targets.length < 2) return null;

   return (
      <Select value={value} disabled={status === 'loading'} onValueChange={onChange}>
         <SelectTrigger id={id} className={className} aria-label={label}>
            <SelectValue />
         </SelectTrigger>
         <SelectContent>
            <SelectGroup>
               {targets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                     {targetName(target)}
                  </SelectItem>
               ))}
            </SelectGroup>
         </SelectContent>
      </Select>
   );
}
