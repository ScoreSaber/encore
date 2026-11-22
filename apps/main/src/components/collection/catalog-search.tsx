import { useState, type ReactNode } from 'react';

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { TargetCallError } from '@/renderer/ipc-result';
import { abortable } from '@/renderer/query/api-query';

type CatalogPage<Item, Issue> =
   | { status: 'ok'; query: string; page: number; items: Item[]; hasMore: boolean }
   | { status: 'failed'; issue: Issue; detail?: string };

type CatalogSearchState<Item, Issue> =
   | { status: 'searching' }
   | Extract<CatalogPage<Item, Issue>, { status: 'ok' }>
   | { status: 'failed'; issue: Issue | 'fetch-failed' | 'unsupported'; detail?: string };

export function useCatalogSearch<Item, Issue>(
   key: QueryKey,
   search: (query: string, page: number) => Promise<CatalogPage<Item, Issue>>,
   blocked: { issue: NoInfer<Issue>; detail?: string } | null = null
) {
   const [submitted, setSubmitted] = useState({ query: '', page: 0 });
   const [query, setQuery] = useState('');
   const result = useQuery({
      queryKey: [...key, submitted.query, submitted.page],
      queryFn: ({ signal }) => abortable(signal, () => search(submitted.query, submitted.page)),
      gcTime: 0,
      enabled: blocked === null
   });
   const page = result.data;
   const state: CatalogSearchState<Item, Issue> = blocked
      ? { status: 'failed', ...blocked }
      : result.isFetching
        ? { status: 'searching' }
        : result.error
          ? TargetCallError.is(result.error) && result.error.status === 'unsupported'
             ? { status: 'failed', issue: 'unsupported' }
             : { status: 'failed', issue: 'fetch-failed', detail: result.error.message }
          : (page ?? { status: 'searching' });

   return {
      state,
      query,
      setQuery,
      submit: () => {
         if (blocked || result.isFetching) return;

         const next = { query: query.trim(), page: 0 };
         if (next.query === submitted.query && next.page === submitted.page) return void result.refetch();

         setSubmitted(next);
      },
      retry: () => {
         if (blocked || result.isFetching) return;

         void result.refetch();
      },
      goToPage: (next: number) => {
         if (blocked || result.isFetching) return;
         if (page && page.status === 'ok' && next >= 0) setSubmitted({ query: page.query, page: next });
      }
   };
}

export function CatalogSearchDialog<Item, Issue>({
   search,
   labels,
   browse,
   disabled = false,
   issue,
   retryable = () => true,
   itemKey,
   children,
   onOpenChange
}: {
   search: ReturnType<typeof useCatalogSearch<Item, Issue>>;
   labels: { title: string; description: string; browse: string; placeholder: string; submit: string; empty: string; previous: string; next: string };
   browse: { url: string; open: () => void };
   disabled?: boolean;
   issue: (issue: Issue | 'fetch-failed' | 'unsupported') => string;
   retryable?: (issue: Issue | 'fetch-failed' | 'unsupported') => boolean;
   itemKey: (item: Item) => string;
   children: (item: Item) => ReactNode;
   onOpenChange: (open: boolean) => void;
}) {
   const common = useTranslations('common');
   const { state } = search;

   return (
      <Dialog open onOpenChange={onOpenChange}>
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <div className="flex items-baseline gap-3">
                  <DialogTitle>{labels.title}</DialogTitle>
                  <CopyPathContextMenu pathType="url" value={browse.url}>
                     <Button type="button" variant="link-muted" className="h-auto p-0 text-xs font-normal" onClick={browse.open}>
                        {labels.browse}
                        <ExternalLink className="size-3" />
                     </Button>
                  </CopyPathContextMenu>
               </div>
               <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>

            <form
               onSubmit={(event) => {
                  event.preventDefault();
                  if (disabled) return;
                  search.submit();
               }}
            >
               <div className="flex gap-2">
                  <Input
                     value={search.query}
                     disabled={disabled}
                     placeholder={labels.placeholder}
                     aria-label={labels.placeholder}
                     onChange={(event) => search.setQuery(event.target.value)}
                  />
                  <Button type="submit" disabled={state.status === 'searching' || disabled}>
                     <Search data-icon="inline-start" />
                     {labels.submit}
                  </Button>
               </div>
            </form>

            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
               {state.status === 'searching' ? <LoadingPanel /> : null}

               {state.status === 'failed' ? (
                  <ErrorPanel message={issue(state.issue)} detail={state.detail} onRetry={retryable(state.issue) ? search.retry : undefined} />
               ) : null}

               {state.status === 'ok' && state.items.length === 0 ? <EmptyPanel description={labels.empty} /> : null}

               {state.status === 'ok' ? state.items.map((item) => <div key={itemKey(item)}>{children(item)}</div>) : null}
            </div>

            <DialogFooter>
               {state.status === 'ok' ? (
                  <div className="mr-auto flex gap-2">
                     <Button type="button" variant="outline" size="sm" disabled={state.page === 0} onClick={() => search.goToPage(state.page - 1)}>
                        {labels.previous}
                     </Button>
                     <Button type="button" variant="outline" size="sm" disabled={!state.hasMore} onClick={() => search.goToPage(state.page + 1)}>
                        {labels.next}
                     </Button>
                  </div>
               ) : null}

               <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
