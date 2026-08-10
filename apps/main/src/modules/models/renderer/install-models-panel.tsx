import { useMemo, useState } from 'react';

import type { ColumnDef } from '@tanstack/react-table';
import { Download, FolderOpen, MoreHorizontal, Search, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { DateCell } from '@/components/collection/date-cell';
import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RemoteImage } from '@/components/ui/remote-image';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { isCatalogModelType, modelSharedFolderIds, modelTypeSchema, modelTypes, type LocalModelSummary } from '@/modules/models/contract';
import { ModelActionDialog } from '@/modules/models/renderer/model-action-dialog';
import { ModelSearchDialog } from '@/modules/models/renderer/model-search-dialog';
import type { InstallModels } from '@/modules/models/renderer/use-install-models';
import { useModelActions } from '@/modules/models/renderer/use-model-actions';
import { SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';
import { matchesQuery, selectionState } from '@/renderer/collection/view';
import { useFormatters } from '@/renderer/i18n/formatters';

export function InstallModelsPanel({ request, models }: { request: TargetModelCollectionRequest; models: InstallModels }) {
   const t = useTranslations('models');
   const tabs = useTranslations('models.tabs');
   const common = useTranslations('common');
   const format = useFormatters();
   const actions = useModelActions(request, models.clearSelection);
   const { snapshot, status, selected, type } = models;
   const shared = useSharedFolder(request, modelSharedFolderIds[type]);
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const [searchOpen, setSearchOpen] = useState(false);
   const [query, setQuery] = useState('');
   const busy = status === 'loading' || snapshot.status === 'scanning';
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () => models.models.filter((model) => matchesQuery(filterText, [model.name, model.author, model.fileName])),
      [models.models, filterText]
   );
   const visibleIds = visible.map((model) => model.id);
   const searchable = isCatalogModelType(type);
   const selectedVisible = visibleIds.filter((modelId) => selected.has(modelId)).length;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;
   const note = scanning ? t('scanning', { scanned: scanning.scanned, total: scanning.total }) : null;

   const openFolder = async (modelId: string) => {
      const opened = await actions.openFolder(modelId).catch(() => null);
      setFolderResult(!opened || opened.status === 'failed' ? 'failed' : opened.status === 'unsupported' ? 'unsupported' : null);
   };

   const columns: ColumnDef<LocalModelSummary>[] = [
      {
         id: 'select',
         size: 40,
         enableResizing: false,
         meta: { control: true },
         header: () => (
            <Checkbox
               aria-label={t('selectAll')}
               checked={selectionState(selectedVisible, visible.length)}
               onCheckedChange={() => models.toggleAll(visibleIds)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox aria-label={row.original.name} checked={selected.has(row.original.id)} onCheckedChange={() => models.toggle(row.original.id)} />
         )
      },
      {
         id: 'name',
         header: t('columns.name'),
         accessorFn: (model) => model.name,
         meta: { flex: true },
         cell: ({ row }) => (
            <div className="flex items-center gap-2">
               {row.original.thumbnailUrl ? (
                  <RemoteImage src={row.original.thumbnailUrl} alt="" className="size-8 shrink-0 rounded-sm object-cover" />
               ) : null}
               <span className="truncate font-medium">{row.original.name}</span>
               {row.original.source === 'local' ? null : <span className="text-muted-foreground text-xs">{t(`sources.${row.original.source}`)}</span>}
               {row.original.isDuplicate ? <Badge variant="secondary">{t('duplicate')}</Badge> : null}
               {row.original.problem ? (
                  <Badge variant="destructive" aria-description={row.original.problem.message}>
                     {t('unreadable')}
                  </Badge>
               ) : null}
            </div>
         )
      },
      {
         id: 'author',
         size: 200,
         header: t('columns.author'),
         accessorFn: (model) => model.author ?? '',
         meta: { cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => row.original.author ?? ''
      },
      {
         id: 'size',
         size: 96,
         header: t('columns.size'),
         accessorFn: (model) => model.sizeBytes,
         meta: {
            className: 'text-right',
            cellClassName: 'text-muted-foreground tabular-nums'
         },
         cell: ({ row }) => format.bytes(row.original.sizeBytes)
      },
      {
         id: 'date',
         size: 120,
         header: t('columns.date'),
         accessorFn: (model) => Date.parse(model.updatedAt),
         meta: { className: 'text-right', cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => <DateCell value={row.original.updatedAt} />
      },
      {
         id: 'actions',
         size: 48,
         enableResizing: false,
         meta: { className: 'text-right', control: true },
         cell: ({ row }) =>
            local ? (
               <CopyPathContextMenu pathType="path" value={row.original.path}>
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon-sm"
                     aria-label={common('openFolder.action')}
                     onClick={() => void openFolder(row.original.id)}
                  >
                     <FolderOpen />
                  </Button>
               </CopyPathContextMenu>
            ) : null
      }
   ];

   if (status === 'loading' && models.models.length === 0) return <LoadingPanel />;
   if (snapshot.status === 'unsupported') return <EmptyPanel description={t('unsupportedTarget')} />;

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         <Tabs
            value={type}
            onValueChange={(value) => {
               const nextType = modelTypeSchema.safeParse(value);
               if (nextType.success) models.selectType(nextType.data);
            }}
            className="shrink-0"
         >
            <TabsList variant="line">
               {modelTypes.map((modelType) => (
                  <TabsTrigger key={modelType} value={modelType}>
                     {tabs(modelType)}
                  </TabsTrigger>
               ))}
            </TabsList>
         </Tabs>

         <CollectionToolbar
            filter={{ value: query, label: common('search'), onChange: setQuery }}
            note={note}
            rescan={{ label: common('rescan'), busy, onClick: models.rescan }}
            menu={
               local ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={common('more')}>
                           <MoreHorizontal />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={busy} onSelect={() => void actions.importModels()}>
                           <Upload />
                           {common('import')}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : undefined
            }
            action={
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!searchable}
                  aria-description={searchable ? undefined : t('issues.unsupportedType')}
                  onClick={() => setSearchOpen(true)}
               >
                  <Search data-icon="inline-start" />
                  {t('findMore')}
               </Button>
            }
         >
            {selected.size > 0 ? (
               <ButtonGroup aria-label={t('title')}>
                  {local ? (
                     <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void actions.exportModels([...selected])}>
                        <Download data-icon="inline-start" />
                        {t('export', { count: selected.size })}
                     </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void actions.previewDelete([...selected])}>
                     <Trash2 data-icon="inline-start" />
                     {t('deleteSelected', { count: selected.size })}
                  </Button>
               </ButtonGroup>
            ) : null}
         </CollectionToolbar>

         <SharedFolderNotice shared={shared} />

         {snapshot.problems.map((problem) => (
            <WarningLine key={`${problem.code}:${problem.type ?? ''}`}>{problem.message}</WarningLine>
         ))}

         {folderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${folderResult}`)}</p> : null}

         {status === 'error' ? <ErrorPanel message={t('loadError')} onRetry={models.rescan} /> : null}

         {snapshot.status === 'missing' ? <EmptyPanel description={t('missing')} /> : null}

         {!busy && snapshot.status === 'ready' && models.models.length === 0 ? <EmptyPanel description={t('empty', { type: tabs(type) })} /> : null}

         {visible.length > 0 ? (
            <DataTable columns={columns} data={visible} getRowId={(model) => model.id} label={t('title')} tableId="models" />
         ) : null}

         {models.models.length > 0 && visible.length === 0 ? <EmptyPanel description={t('noMatches')} /> : null}

         <ModelActionDialog request={request} actions={actions} />
         {searchOpen ? (
            <ModelSearchDialog
               request={request}
               type={type}
               onOpenChange={setSearchOpen}
               onDownload={(id) => {
                  setSearchOpen(false);
                  void actions.downloadModel({ kind: 'modelsaber', id });
               }}
            />
         ) : null}
      </div>
   );
}
