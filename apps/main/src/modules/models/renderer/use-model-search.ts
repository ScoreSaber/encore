import { useCallback, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { isCatalogModelType, type ModelSaberModelSummary, type ModelSearchIssue, type ModelType } from '@/modules/models/contract';
import { modelSearchQueryOptions } from '@/modules/models/renderer/model-queries';

type ModelSearchState =
   | { status: 'searching' }
   | { status: 'failed'; issue: ModelSearchIssue; detail?: string }
   | {
        status: 'ready';
        query: string;
        page: number;
        models: ModelSaberModelSummary[];
        hasMore: boolean;
     };

export function useModelSearch(request: TargetModelCollectionRequest, type: ModelType) {
   const [submitted, setSubmitted] = useState({ query: '', page: 0 });
   const [query, setQuery] = useState('');
   const searchable = isCatalogModelType(type);
   const search = useQuery({
      ...modelSearchQueryOptions(request, type, submitted.query, submitted.page),
      enabled: searchable
   });

   let state: ModelSearchState;
   if (!searchable) {
      state = { status: 'failed', issue: 'unsupported-type', detail: type };
   } else if (search.isError) {
      state = { status: 'failed', issue: 'fetch-failed' };
   } else if (!search.data) {
      state = { status: 'searching' };
   } else if (search.data.status !== 'ok') {
      state = { status: 'failed', issue: search.data.issue };
      if (search.data.detail) state.detail = search.data.detail;
   } else {
      state = {
         status: 'ready',
         query: search.data.query,
         page: search.data.page,
         models: search.data.models,
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
