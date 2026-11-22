import { Download } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CatalogSearchDialog, useCatalogSearch } from '@/components/collection/catalog-search';
import { Button } from '@/components/ui/button';
import { RemoteImage } from '@/components/ui/remote-image';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { isCatalogModelType, type CatalogModelSummary, type ModelType } from '@/modules/models/contract';
import { supportLinkUrls } from '@/modules/support/contract';
import { unwrapTarget } from '@/renderer/ipc-result';
import { installKey } from '@/renderer/query/api-query';

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
   const searchable = isCatalogModelType(type);
   const search = useCatalogSearch(
      installKey('models', request, 'search', type),
      async (query, page) => {
         const result = unwrapTarget(await window.encore.models.search({ ...request, type, query, page }));
         return result.status === 'ok'
            ? { status: 'ok', query: result.query, page: result.page, items: result.models, hasMore: result.hasMore }
            : result;
      },
      searchable ? null : { issue: 'unsupported-type', detail: type }
   );

   return (
      <CatalogSearchDialog
         search={search}
         labels={{
            title: t('title', { type: tabs(type) }),
            description: t('description'),
            browse: t('browse'),
            placeholder: t('placeholder'),
            submit: t('submit'),
            empty: t('empty'),
            previous: t('previous'),
            next: t('next')
         }}
         browse={{ url: supportLinkUrls.modelsaber, open: () => void window.encore.support.openLink({ id: 'modelsaber' }) }}
         disabled={!searchable}
         issue={(issue) => t(`issues.${issue}`)}
         retryable={(issue) => issue !== 'unsupported-type'}
         itemKey={(model) => model.id}
         onOpenChange={onOpenChange}
      >
         {(model) => <SearchResultRow model={model} onDownload={() => onDownload(model.id)} />}
      </CatalogSearchDialog>
   );
}

function SearchResultRow({ model, onDownload }: { model: CatalogModelSummary; onDownload: () => void }) {
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
