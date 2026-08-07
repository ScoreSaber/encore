import { useQuery } from '@tanstack/react-query';
import { Music2 } from 'lucide-react';

import { cn } from '@/components/utils';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { LocalMapSummary } from '@/modules/maps/contract';
import { mapCoverQueryOptions } from '@/modules/maps/renderer/map-queries';

export function MapCoverImage({ request, map, className }: { request: TargetMapCollectionRequest; map: LocalMapSummary; className?: string }) {
   const cover = useQuery({
      ...mapCoverQueryOptions(request, map),
      enabled: map.coverFileName !== null
   });

   return (
      <div className={cn('bg-muted text-muted-foreground relative grid shrink-0 place-items-center overflow-hidden', className)}>
         <Music2 className="size-1/3 opacity-40" aria-hidden="true" />
         {cover.data ? <img src={cover.data} alt="" className="absolute inset-0 size-full object-cover" /> : null}
      </div>
   );
}
