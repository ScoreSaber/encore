import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Result } from 'better-result';
import { FolderOpen, Search, Upload } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionPanel } from '@/components/collection/collection-panel';
import { DateCell } from '@/components/collection/date-cell';
import { matchesQuery, selectionState, useCollectionSelection, type CollectionSelection } from '@/components/collection/selection';
import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { RemoteImage } from '@/components/ui/remote-image';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import {
   createEmptyModelCollectionSnapshot,
   isCatalogModelType,
   modelSharedFolderIds,
   modelTypeSchema,
   modelTypes,
   type LocalModelSummary,
   type ModelCollectionSnapshot,
   type ModelType
} from '@/modules/models/contract';
import { ModelActionDialog } from '@/modules/models/renderer/model-action-dialog';
import { modelListQueryOptions } from '@/modules/models/renderer/model-queries';
import { ModelSearchDialog } from '@/modules/models/renderer/model-search-dialog';
import { useModelActions, type ModelActions } from '@/modules/models/renderer/use-model-actions';
import { SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';
import { useFormatters } from '@/renderer/i18n/formatters';
import { unwrapTarget } from '@/renderer/ipc-result';
import { queryStatus, type QueryStatus, useSnapshotMutation } from '@/renderer/query/api-query';

export function InstallModelsTab({ request, active }: { request: TargetModelCollectionRequest; active: boolean }) {
   const query = useQuery(modelListQueryOptions(request));
   const rescan = useSnapshotMutation(modelListQueryOptions(request).queryKey, async () => unwrapTarget(await window.encore.models.rescan(request)));
   const [type, setType] = useState<ModelType>('saber');
   const selection = useCollectionSelection(`${request.targetId}\0${request.installId}\0${type}`);
   const actions = useModelActions(request, selection.clear);
   const status = rescan.isPending ? 'loading' : queryStatus(query);
   const snapshot = query.data ?? createEmptyModelCollectionSnapshot(request);

   return (
      <>
         {active ? (
            <InstallModelsPanel
               request={request}
               snapshot={snapshot}
               status={status}
               type={type}
               selection={selection}
               actions={actions}
               onTypeChange={setType}
               onRescan={() => rescan.mutate()}
            />
         ) : null}
         <ModelActionDialog request={request} actions={actions} />
      </>
   );
}

function InstallModelsPanel({
   request,
   snapshot,
   status,
   type,
   selection,
   actions,
   onTypeChange,
   onRescan
}: {
   request: TargetModelCollectionRequest;
   snapshot: ModelCollectionSnapshot;
   status: QueryStatus;
   type: ModelType;
   selection: CollectionSelection;
   actions: ModelActions;
   onTypeChange: (type: ModelType) => void;
   onRescan: () => void;
}) {
   const t = useTranslations('models');
   const problems = useTranslations('problems.models');
   const tabs = useTranslations('models.tabs');
   const common = useTranslations('common');
   const format = useFormatters();
   const shared = useSharedFolder(request, modelSharedFolderIds[type]);
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<{ type: ModelType; status: 'failed' | 'unsupported' } | null>(null);
   const [searchOpen, setSearchOpen] = useState(false);
   const [query, setQuery] = useState('');
   const { selected } = selection;
   const models = useMemo(() => snapshot.models.filter((model) => model.type === type), [snapshot.models, type]);
   const busy = status === 'loading' || snapshot.status === 'scanning' || actions.flow.busy;
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () => models.filter((model) => matchesQuery(filterText, [model.name, model.author, model.fileName])),
      [models, filterText]
   );
   const visibleIds = visible.map((model) => model.id);
   const searchable = isCatalogModelType(type);
   const selectedVisible = visibleIds.filter((modelId) => selected.has(modelId)).length;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;
   const activeFolderResult = folderResult?.type === type ? folderResult.status : null;

   const openFolder = async (modelId: string) => {
      const opened = await Result.tryPromise(() => actions.openFolder(modelId));
      setFolderResult(
         Result.isError(opened) ? { type, status: 'failed' } : opened.value.status === 'opened' ? null : { type, status: opened.value.status }
      );
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
               disabled={busy}
               checked={selectionState(selectedVisible, visible.length)}
               onCheckedChange={() => selection.toggleAll(visibleIds)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox
               aria-label={row.original.name}
               disabled={busy}
               checked={selected.has(row.original.id)}
               onCheckedChange={() => selection.toggle(row.original.id)}
            />
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

   return (
      <CollectionPanel
         status={status}
         snapshotStatus={snapshot.status}
         total={models.length}
         visible={visible.length}
         query={query}
         onQueryChange={setQuery}
         onRescan={onRescan}
         labels={{
            unsupported: problems('unsupported-target'),
            missing: t('missing'),
            empty: t('empty', { type }),
            noMatches: t('noMatches'),
            loadError: t('loadError'),
            note: scanning ? t('scanning', { scanned: scanning.scanned, total: scanning.total }) : null
         }}
         header={
            <Tabs
               value={type}
               onValueChange={(value) => {
                  const nextType = modelTypeSchema.safeParse(value);
                  if (nextType.success) {
                     setQuery('');
                     onTypeChange(nextType.data);
                  }
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
         }
         menu={local ? { label: common('import'), icon: <Upload />, disabled: busy, onSelect: () => void actions.importModels() } : null}
         action={
            <Button
               type="button"
               variant="outline"
               size="sm"
               disabled={!searchable}
               aria-description={searchable ? undefined : t('search.issues.unsupported-type')}
               onClick={() => setSearchOpen(true)}
            >
               <Search data-icon="inline-start" />
               {t('findMore')}
            </Button>
         }
         selection={{
            count: selected.size,
            exportLabel: t('export', { count: selected.size }),
            deleteLabel: t('deleteSelected', { count: selected.size }),
            onExport: local ? () => void actions.exportModels([...selected]) : null,
            onDelete: () => void actions.previewDelete([...selected])
         }}
         notices={
            <>
               <SharedFolderNotice shared={shared} />
               {activeFolderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${activeFolderResult}`)}</p> : null}
            </>
         }
         problems={snapshot.problems.map((problem) => ({ key: `${problem.code}:${problem.type ?? ''}`, message: problem.message }))}
         dialogs={
            <>
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
            </>
         }
      >
         <DataTable columns={columns} data={visible} getRowId={(model) => model.id} label={t('title')} tableId="models" />
      </CollectionPanel>
   );
}
