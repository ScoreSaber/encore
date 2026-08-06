import { Download, ExternalLink, Search } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RemoteImage } from '@/components/ui/remote-image';

import type { MessageKey } from '@/app/renderer/i18n/keys';
import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { isCatalogModelType, type ModelSaberModelSummary, type ModelSearchIssue, type ModelType } from '@/modules/models/contract';
import { useModelSearch } from '@/modules/models/renderer/use-model-search';
import { supportLinkUrls } from '@/modules/support/contract';

const issueKeys: Record<ModelSearchIssue, MessageKey<'models.search.issues'>> = {
   'fetch-failed': 'fetchFailed',
   'invalid-response': 'invalidResponse',
   unsupported: 'unsupported',
   'unsupported-type': 'unsupportedType'
};

export function ModelSearchDialog({
   request,
   type,
   onOpenChange,
   onDownload
}: {
   request: TargetModelCollectionRequest;
   type: ModelType;
   onOpenChange: (open: boolean) => void;
   onDownload: (id: string) => void;
}) {
   const t = useTranslations('models.search');
   const tabs = useTranslations('models.tabs');
   const common = useTranslations('common');
   const search = useModelSearch(request, type);
   const { state } = search;
   const searchable = isCatalogModelType(type);

   return (
      <Dialog open onOpenChange={onOpenChange}>
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <div className="flex items-baseline gap-3">
                  <DialogTitle>{t('title', { type: tabs(type) })}</DialogTitle>
                  <CopyPathContextMenu pathType="url" value={supportLinkUrls.modelsaber}>
                     <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto p-0 text-xs font-normal"
                        onClick={() => void window.encore.support.openLink({ id: 'modelsaber' })}
                     >
                        {t('browse')}
                        <ExternalLink className="size-3" />
                     </Button>
                  </CopyPathContextMenu>
               </div>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <form
               onSubmit={(event) => {
                  event.preventDefault();
                  void search.submit();
               }}
            >
               <div className="flex gap-2">
                  <Input
                     value={search.query}
                     placeholder={t('placeholder')}
                     aria-label={t('placeholder')}
                     onChange={(event) => search.setQuery(event.target.value)}
                  />
                  <Button type="submit" disabled={state.status === 'searching' || !searchable}>
                     <Search data-icon="inline-start" />
                     {t('submit')}
                  </Button>
               </div>
            </form>

            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
               {state.status === 'searching' ? <LoadingPanel rows={2} /> : null}

               {state.status === 'failed' ? (
                  <ErrorPanel
                     message={t(`issues.${issueKeys[state.issue]}`)}
                     detail={state.detail}
                     onRetry={state.issue === 'unsupported-type' ? undefined : search.submit}
                  />
               ) : null}

               {state.status === 'ready' && state.models.length === 0 ? <EmptyPanel description={t('empty')} /> : null}

               {state.status === 'ready'
                  ? state.models.map((model) => <SearchResultRow key={model.id} model={model} onDownload={() => onDownload(model.id)} />)
                  : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <ButtonGroup className="mr-auto" aria-label={`${t('previous')} / ${t('next')}`}>
                     <Button type="button" variant="outline" size="sm" disabled={state.page === 0} onClick={() => search.goToPage(state.page - 1)}>
                        {t('previous')}
                     </Button>
                     <Button type="button" variant="outline" size="sm" disabled={!state.hasMore} onClick={() => search.goToPage(state.page + 1)}>
                        {t('next')}
                     </Button>
                  </ButtonGroup>
               ) : null}

               <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function SearchResultRow({ model, onDownload }: { model: ModelSaberModelSummary; onDownload: () => void }) {
   const t = useTranslations('models.search');

   return (
      <div className="flex items-center gap-3 rounded-md border p-2">
         {model.thumbnailUrl ? <RemoteImage src={model.thumbnailUrl} alt="" className="size-12 shrink-0 rounded-sm object-cover" /> : null}

         <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
               <span className="font-medium">{model.name}</span>
               {model.installed ? <span className="text-muted-foreground text-xs">{t('installed')}</span> : null}
            </div>
            <div className="text-muted-foreground truncate text-xs">{t('by', { author: model.author })}</div>
         </div>

         <Button type="button" size="sm" disabled={model.installed} onClick={onDownload}>
            <Download data-icon="inline-start" />
            {t('download')}
         </Button>
      </div>
   );
}
