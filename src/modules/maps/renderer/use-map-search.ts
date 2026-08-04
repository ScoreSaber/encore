import { useCallback, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { BeatSaverMapSummary, MapSearchIssue } from '@/modules/maps/contract';
import { mapSearchQueryOptions } from '@/modules/maps/renderer/map-queries';

type MapSearchState =
   | { status: 'idle' }
   | { status: 'searching' }
   | { status: 'failed'; issue: MapSearchIssue; detail?: string }
   | {
        status: 'ready';
        query: string;
        page: number;
        maps: BeatSaverMapSummary[];
        hasMore: boolean;
     };

export function useMapSearch(request: TargetMapCollectionRequest, active: boolean) {
   const [submitted, setSubmitted] = useState({ query: '', page: 0 });
   const [query, setQuery] = useState('');
   const search = useQuery({
      ...mapSearchQueryOptions(request, submitted.query, submitted.page),
      enabled: active
   });

   useEffect(() => {
      if (!active) setSubmitted({ query: '', page: 0 });
   }, [active]);

   let state: MapSearchState;
   if (!active) {
      state = { status: 'idle' };
   } else if (search.isError) {
      state = { status: 'failed', issue: 'fetch-failed' };
   } else if (!search.data) {
      state = { status: 'searching' };
   } else if (search.data.status !== 'ok') {
      state = {
         status: 'failed',
         issue: search.data.issue,
         ...(search.data.detail ? { detail: search.data.detail } : {})
      };
   } else {
      state = {
         status: 'ready',
         query: search.data.query,
         page: search.data.page,
         maps: search.data.maps,
         hasMore: search.data.hasMore
      };
   }

   const goToPage = useCallback(
      (page: number) => {
         if (state.status !== 'ready' || page < 0) return;

         setSubmitted({ query: state.query, page });
      },
      [state]
   );

   const submit = () => {
      const next = { query: query.trim(), page: 0 };
      if (next.query === submitted.query && next.page === submitted.page) {
         void search.refetch();
         return;
      }

      setSubmitted(next);
   };

   return {
      state,
      query,
      setQuery,
      submit,
      goToPage
   };
}
