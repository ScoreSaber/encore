import { useState } from 'react';

import { Box, ChevronDown, FolderOpen, Link2, Link2Off, Plus, Repeat, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { cn } from '@/components/utils';

import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import { isCustomSharedFolderId, type SharedFolderId, type SharedInstallOverview } from '@/modules/shared-content/contract';
import { SharedContentActionDialog } from '@/modules/shared-content/renderer/shared-content-action-dialog';
import { SharedFolderActionButtons, SharedFolderStateBadge } from '@/modules/shared-content/renderer/shared-folder-actions';
import { useSharedFolderLabel } from '@/modules/shared-content/renderer/shared-folder-label';
import { useCustomSharedFolders } from '@/modules/shared-content/renderer/use-custom-shared-folders';
import { useInstallSharedContent } from '@/modules/shared-content/renderer/use-install-shared-content';
import type { SharedConnect } from '@/modules/shared-content/renderer/use-shared-connect';
import { useSharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';
import type { TargetId } from '@/modules/targets/contract';

type ConnectionSummary = {
   linkedHere: number;
   linkedElsewhere: number;
   issues: number;
   expected: number;
   status: 'connected' | 'partial' | 'elsewhere' | 'none';
};

export function SharedInstallList({
   targetId,
   installs,
   selectedRootPath,
   connect,
   canManage,
   isLocal,
   linkable
}: {
   targetId: TargetId;
   installs: SharedInstallOverview[];
   selectedRootPath: string;
   connect: SharedConnect;
   canManage: boolean;
   isLocal: boolean;
   linkable: boolean;
}) {
   const t = useTranslations('sharedContent.page');

   return (
      <section className="flex flex-col gap-3">
         <div>
            <h2 className="font-semibold">{t('installsTitle')}</h2>
         </div>

         {installs.length === 0 ? <EmptyPanel description={t('noInstalls')} /> : null}

         <div className="flex flex-col gap-2">
            {installs.map((install) => (
               <InstallRow
                  key={install.installId}
                  targetId={targetId}
                  install={install}
                  summary={summarize(install, selectedRootPath)}
                  connect={connect}
                  selectedRootPath={selectedRootPath}
                  canManage={canManage}
                  isLocal={isLocal}
                  linkable={linkable}
               />
            ))}
         </div>
      </section>
   );
}

function InstallRow({
   targetId,
   install,
   summary,
   connect,
   selectedRootPath,
   canManage,
   isLocal,
   linkable
}: {
   targetId: TargetId;
   install: SharedInstallOverview;
   summary: ConnectionSummary;
   connect: SharedConnect;
   selectedRootPath: string;
   canManage: boolean;
   isLocal: boolean;
   linkable: boolean;
}) {
   const t = useTranslations('sharedContent.page');
   const [expanded, setExpanded] = useState(false);
   const busy = connect.state.status !== 'idle';
   const canDisconnect = summary.linkedHere > 0 || summary.issues > 0;
   const openConnect = (action: 'connect' | 'disconnect') =>
      connect.open({ installId: install.installId, installName: install.installName, action, rootPath: selectedRootPath });

   return (
      <div className="group/install rounded-md border">
         <div className="relative flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
            <button
               type="button"
               className="hover:bg-muted/50 focus-visible:bg-muted/50 absolute inset-0 rounded-md transition-colors"
               aria-label={t('folderDetails')}
               aria-expanded={expanded}
               onClick={() => setExpanded((current) => !current)}
            />

            <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
               <Box className="text-muted-foreground size-4 shrink-0" />
               <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                     <span className="font-medium">{install.installName}</span>
                     <ConnectionBadge summary={summary} />
                     {summary.issues > 0 ? (
                        <Badge className="px-1.5 py-0 text-[10px] leading-4" variant="destructive">
                           {t('issues', { count: summary.issues })}
                        </Badge>
                     ) : null}
                  </div>
                  <div className="text-muted-foreground text-xs break-all">{install.installPath}</div>
                  <div className="text-muted-foreground text-xs">
                     {t('folderCounts', { linked: summary.linkedHere, elsewhere: summary.linkedElsewhere, total: summary.expected })}
                  </div>
               </div>
            </div>

            <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-2">
               {canManage ? (
                  <ButtonGroup
                     className="pointer-events-auto opacity-0 transition-opacity group-focus-within/install:opacity-100 group-hover/install:opacity-100"
                     aria-label={install.installName}
                  >
                     {summary.status !== 'connected' ? (
                        <Button type="button" variant="outline" size="sm" disabled={busy || !linkable} onClick={() => openConnect('connect')}>
                           {summary.status === 'elsewhere' ? <Repeat data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
                           {summary.status === 'elsewhere' ? t('switch') : t('connect')}
                        </Button>
                     ) : null}
                     {canDisconnect ? (
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => openConnect('disconnect')}>
                           <Link2Off data-icon="inline-start" />
                           {t('disconnect')}
                        </Button>
                     ) : null}
                  </ButtonGroup>
               ) : null}
               <div className="flex size-9 items-center justify-center">
                  <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
               </div>
            </div>
         </div>

         {expanded ? <InstallFolderDetail request={{ targetId, installId: install.installId }} canManage={canManage} isLocal={isLocal} /> : null}
      </div>
   );
}

function InstallFolderDetail({ request, canManage, isLocal }: { request: TargetSharedContentRequest; canManage: boolean; isLocal: boolean }) {
   const shared = useTranslations('sharedContent');
   const custom = useTranslations('sharedContent.customFolders');
   const common = useTranslations('common');
   const folderLabel = useSharedFolderLabel();
   const sharedContent = useInstallSharedContent(request);
   const actions = useSharedContentActions(request);
   const customFolders = useCustomSharedFolders(request, actions);
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const { snapshot } = sharedContent;
   const busy = sharedContent.status === 'loading' || customFolders.state.status === 'choosing' || customFolders.state.status === 'saving';
   const linkable = snapshot.linkSupport?.supported === true;

   const openFolder = async (folderId: SharedFolderId) => {
      const opened = await actions.openFolder(folderId).catch(() => null);
      setFolderResult(!opened || opened.status === 'failed' ? 'failed' : opened.status === 'unsupported' ? 'unsupported' : null);
   };

   return (
      <div className="border-t">
         {busy && snapshot.folders.length === 0 ? <LoadingPanel /> : null}
         {sharedContent.status === 'error' ? <WarningLine className="px-3 py-2 text-sm">{shared('loadError')}</WarningLine> : null}
         {folderResult ? <p className="text-muted-foreground px-3 py-2 text-sm">{common(`openFolder.${folderResult}`)}</p> : null}

         {snapshot.folders.length > 0 ? (
            <div className="divide-y">
               {snapshot.folders.map((folder) => (
                  <div
                     key={folder.id}
                     className="group/folder hover:bg-muted/50 flex min-h-14 items-center gap-3 py-2 pr-3 pl-10 text-sm transition-colors"
                  >
                     <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                           <span className="font-medium">{folderLabel(folder.id, folder.relativePath)}</span>
                           <SharedFolderStateBadge state={folder.state} />
                           {isCustomSharedFolderId(folder.id) ? (
                              <Badge className="px-1.5 py-0 text-[10px] leading-4" variant="outline">
                                 {custom('custom')}
                              </Badge>
                           ) : null}
                           {folder.risky ? (
                              <Badge className="px-1.5 py-0 text-[10px] leading-4" variant="secondary">
                                 {shared('risky')}
                              </Badge>
                           ) : null}
                        </div>
                        {folder.state === 'foreign' && folder.linkTargetPath ? (
                           <div className="text-muted-foreground truncate text-xs" aria-label={folder.linkTargetPath}>
                              {folder.linkTargetPath}
                           </div>
                        ) : null}
                     </div>

                     {canManage || isLocal ? (
                        <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-focus-within/folder:opacity-100 group-hover/folder:opacity-100">
                           {canManage ? <SharedFolderActionButtons folder={folder} actions={actions} disabled={busy} linkable={linkable} /> : null}
                           {canManage && isCustomSharedFolderId(folder.id) && (folder.state === 'absent' || folder.state === 'unlinked') ? (
                              <Button
                                 type="button"
                                 variant="ghost"
                                 size="icon"
                                 disabled={busy}
                                 aria-label={custom('forget')}
                                 title={custom('forget')}
                                 onClick={() => void customFolders.forget(folder.id)}
                              >
                                 <Trash2 />
                              </Button>
                           ) : null}
                           {isLocal ? (
                              <CopyPathContextMenu pathType="path" value={folder.installFolderPath}>
                                 <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={common('openFolder.action')}
                                    onClick={() => void openFolder(folder.id)}
                                 >
                                    <FolderOpen />
                                 </Button>
                              </CopyPathContextMenu>
                           ) : null}
                        </div>
                     ) : null}
                  </div>
               ))}
            </div>
         ) : null}

         {customFolders.state.status === 'invalid' ? (
            <WarningLine className="border-t px-3 py-2 text-sm">
               {custom(`issues.${customFolders.state.issue}`)}
               {customFolders.state.detail ? ` (${customFolders.state.detail})` : ''}
            </WarningLine>
         ) : null}

         {canManage && isLocal ? (
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2 pl-10">
               <p className="text-muted-foreground text-xs">{custom('hint')}</p>
               <Button type="button" variant="ghost" size="sm" disabled={busy || !linkable} onClick={() => void customFolders.add()}>
                  <Plus data-icon="inline-start" />
                  {custom('add')}
               </Button>
            </div>
         ) : null}

         <SharedContentActionDialog request={request} actions={actions} />
      </div>
   );
}

function ConnectionBadge({ summary }: { summary: ConnectionSummary }) {
   const t = useTranslations('sharedContent.page');

   return (
      <Badge
         className="px-1.5 py-0 text-[10px] leading-4"
         variant={summary.status === 'connected' ? 'default' : summary.status === 'none' ? 'outline' : 'secondary'}
      >
         {t(`connection.${summary.status}`)}
      </Badge>
   );
}

function summarize(install: SharedInstallOverview, rootPath: string): ConnectionSummary {
   let linkedHere = 0;
   let linkedElsewhere = 0;
   let issues = 0;
   let expected = 0;

   for (const folder of install.folders) {
      // risky folders are opt-in, so they only count once they are actually linked
      if (!folder.risky || folder.state === 'linked') expected += 1;
      if (folder.state === 'broken' || folder.state === 'foreign') issues += 1;
      if (folder.state !== 'linked') continue;

      if (folder.rootPath === rootPath) linkedHere += 1;
      else linkedElsewhere += 1;
   }

   const status = linkedHere === 0 ? (linkedElsewhere > 0 ? 'elsewhere' : 'none') : linkedHere >= expected && issues === 0 ? 'connected' : 'partial';

   return { linkedHere, linkedElsewhere, issues, expected, status };
}
