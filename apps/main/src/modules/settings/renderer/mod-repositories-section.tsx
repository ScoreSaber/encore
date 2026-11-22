import { useCallback, useEffect, useRef, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { RefreshButton } from '@/components/refresh-button';
import { ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { createLatestGuard } from '@/lib/state/machine';
import type {
   ModOfficialSourceSummary,
   ModRepositoryIssue,
   ModRepositoryPreview,
   ModRepositoryProblem,
   ModRepositoryResult,
   ModRepositorySummary
} from '@/modules/mods/contract';
import { modIdentityResolutionStrategySchema } from '@/modules/mods/contract';
import { modRepositoryListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSnapshotMutation } from '@/renderer/query/api-query';

const repositoriesDocsUrl = 'https://encore.scoresaber.com/docs/modding/mod-repositories';

type ReadyModRepositoryPreview = Extract<ModRepositoryPreview, { status: 'ok' }>;
type RepositoryIssueNotice = { issue: ModRepositoryIssue; detail?: string };
type AddRepoState =
   | { status: 'idle'; url: string }
   | { status: 'previewing'; url: string }
   | { status: 'ready'; url: string; preview: ReadyModRepositoryPreview; acknowledged: boolean }
   | { status: 'adding'; url: string; preview: ReadyModRepositoryPreview; acknowledged: boolean }
   | { status: 'invalid'; url: string; issue: ModRepositoryIssue; detail?: string };

export function ModRepositoriesFields({
   initialUrl = '',
   reviewOnly = false,
   onChanged,
   onDraftDismissed
}: {
   initialUrl?: string;
   reviewOnly?: boolean;
   onChanged?: () => void;
   onDraftDismissed?: () => void;
} = {}) {
   const t = useTranslations('settings.modRepositories');
   const issues = useTranslations('mods.repositories.issues');
   const common = useTranslations('common');
   const [addState, setAddState] = useState<AddRepoState>(() => ({ status: 'idle', url: initialUrl }));
   const [manageIssue, setManageIssue] = useState<RepositoryIssueNotice | null>(null);
   const previewGuardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);
   const mods = window.encore.mods;
   const queryClient = useQueryClient();
   const queryKey = modRepositoryListQueryOptions.queryKey;
   const repositories = useQuery(modRepositoryListQueryOptions);
   const refreshRepositories = useSnapshotMutation(queryKey, () => mods.refreshRepositories());
   const writeRepositories = useMutation({
      mutationFn: (write: () => Promise<ModRepositoryResult>) => write(),
      onSuccess: (result) => {
         if (result.status === 'ok') queryClient.setQueryData(queryKey, result.snapshot);
         else void queryClient.invalidateQueries({ queryKey });
      },
      onError: () => queryClient.invalidateQueries({ queryKey })
   });

   const getPreviewGuard = useCallback(() => {
      if (!previewGuardRef.current) previewGuardRef.current = createLatestGuard();
      return previewGuardRef.current;
   }, []);

   const inspectUrl = useCallback(
      async (address: string) => {
         const guard = getPreviewGuard();
         const token = guard.next();
         setAddState({ status: 'previewing', url: address });

         const result = Result.unwrapOr(await Result.tryPromise(() => mods.previewRepository({ url: address })), null);
         if (!guard.isCurrent(token)) return;

         if (!result) {
            setAddState({ status: 'invalid', url: address, issue: 'fetch-failed' });
            return;
         }
         if (result.status === 'invalid') {
            const invalid: AddRepoState = { status: 'invalid', url: address, issue: result.issue };
            if (result.detail) invalid.detail = result.detail;
            setAddState(invalid);
            return;
         }

         setAddState({ status: 'ready', url: address, preview: result, acknowledged: false });
      },
      [getPreviewGuard, mods]
   );

   useEffect(() => {
      const guard = getPreviewGuard();
      if (!initialUrl) return () => guard.invalidate();

      void inspectUrl(initialUrl);
      return () => guard.invalidate();
   }, [getPreviewGuard, initialUrl, inspectUrl]);

   const snapshot = repositories.data ?? null;
   const addBusy = addState.status === 'previewing' || addState.status === 'adding';
   const manageBusy = refreshRepositories.isPending || writeRepositories.isPending;
   const loadFailed = repositories.isError || refreshRepositories.isError;
   const preview = addState.status === 'ready' || addState.status === 'adding' ? addState.preview : null;
   const acknowledged = addState.status === 'ready' || addState.status === 'adding' ? addState.acknowledged : false;
   const draftIssue: RepositoryIssueNotice | null = addState.status === 'invalid' ? { issue: addState.issue, detail: addState.detail } : null;

   function resetDraft() {
      getPreviewGuard().invalidate();
      setAddState({ status: 'idle', url: '' });
      onDraftDismissed?.();
   }

   async function apply(write: () => Promise<ModRepositoryResult>) {
      const result = Result.unwrapOr(await Result.tryPromise(() => writeRepositories.mutateAsync(write)), null);
      setManageIssue(toIssue(result));
      if (result?.status === 'ok') onChanged?.();

      return result?.status === 'ok';
   }

   async function add() {
      if (addState.status !== 'ready' || !addState.acknowledged || manageBusy) return;

      const guard = getPreviewGuard();
      const token = guard.next();
      const currentUrl = addState.url;
      setAddState({ status: 'adding', url: currentUrl, preview: addState.preview, acknowledged: addState.acknowledged });

      const result = Result.unwrapOr(
         await Result.tryPromise(() => writeRepositories.mutateAsync(() => mods.addRepository({ url: currentUrl, acknowledged: true }))),
         null
      );
      if (!guard.isCurrent(token)) return;

      if (result?.status === 'ok') {
         onChanged?.();
         resetDraft();
         return;
      }

      const issue = toIssue(result) ?? { issue: 'fetch-failed' };
      const invalid: AddRepoState = { status: 'invalid', url: currentUrl, issue: issue.issue };
      if (issue.detail) invalid.detail = issue.detail;
      setAddState(invalid);
   }

   const canAdd = addState.status === 'ready' && addState.acknowledged && !manageBusy;
   const draft = (
      <>
         {addState.status === 'previewing' && reviewOnly ? <LoadingPanel className="min-h-20" /> : null}

         {draftIssue ? (
            <WarningLine className="text-status-warning w-full">
               {issues(draftIssue.issue)}
               {draftIssue.detail ? ` ${draftIssue.detail}` : ''}
            </WarningLine>
         ) : null}

         {preview ? (
            <div
               className={
                  reviewOnly ? 'flex w-full flex-col gap-4' : 'bg-background/50 flex w-full flex-col gap-2 rounded-md border px-3 py-2 text-sm'
               }
            >
               <div className={reviewOnly ? 'flex flex-col gap-1' : 'contents'}>
                  <div className={reviewOnly ? 'text-base font-medium break-words' : 'font-medium break-words'}>{preview.name}</div>
                  <div className="text-muted-foreground text-xs break-all">{preview.listingUrl}</div>
                  <div className={reviewOnly ? 'text-muted-foreground mt-1 text-sm' : 'text-muted-foreground text-xs'}>
                     {t('preview.summary', { owner: preview.owner || t('preview.unknownOwner'), count: preview.packageCount })}
                  </div>
               </div>
               {!reviewOnly ? (
                  <>
                     <div className="text-muted-foreground text-xs break-all">
                        {t('preview.hosts', { hosts: preview.downloadHosts.join(', ') || t('preview.noHosts') })}
                     </div>
                     <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                        {preview.packages.map((listed) => (
                           <li key={listed.id} className="break-words">
                              {t('preview.package', { name: listed.name, version: listed.version || t('preview.unknownVersion') })}
                              {listed.identity ? ` ${t('preview.identityClaim', { identity: listed.identity })}` : ''}
                           </li>
                        ))}
                     </ul>
                  </>
               ) : null}
               {preview.identityClaimCount > 0 ? (
                  <WarningLine className="text-status-warning w-full">
                     {t('preview.identityClaims', { count: preview.identityClaimCount })}
                  </WarningLine>
               ) : null}
               <label className={reviewOnly ? 'flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-xs'}>
                  <Checkbox
                     checked={acknowledged}
                     disabled={addBusy || manageBusy}
                     onCheckedChange={(next) =>
                        setAddState((current) => (current.status === 'ready' ? { ...current, acknowledged: next === true } : current))
                     }
                  />
                  <span className="min-w-0 break-words">{t('preview.acknowledge')}</span>
               </label>
               <div className={reviewOnly ? 'flex flex-wrap justify-end gap-2 pt-1' : 'flex flex-wrap gap-2'}>
                  <Button type="button" size="sm" disabled={!canAdd} onClick={() => void add()}>
                     <Plus data-icon="inline-start" />
                     {t('add.confirm')}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={addBusy || manageBusy} onClick={resetDraft}>
                     {common('cancel')}
                  </Button>
               </div>
            </div>
         ) : null}
      </>
   );

   if (reviewOnly) return <div className="flex min-w-0 flex-col gap-3">{draft}</div>;

   return (
      <>
         {snapshot ? (
            <SettingsSection title={t('resolution.title')}>
               <SettingsRow
                  title={t('resolution.combine.title')}
                  description={t('resolution.combine.description')}
                  control={
                     <Switch
                        checked={snapshot.resolution.combine}
                        disabled={manageBusy}
                        aria-label={t('resolution.combine.title')}
                        onCheckedChange={(combine) => void apply(() => mods.setModSourceResolution({ ...snapshot.resolution, combine }))}
                     />
                  }
               />
               <SettingsRow
                  title={t('resolution.strategy.title')}
                  description={t('resolution.strategy.description')}
                  htmlFor="settings-mod-source-resolution"
                  control={
                     <Select
                        value={snapshot.resolution.strategy}
                        disabled={manageBusy || !snapshot.resolution.combine}
                        onValueChange={(value) =>
                           void apply(() =>
                              mods.setModSourceResolution({
                                 ...snapshot.resolution,
                                 strategy: modIdentityResolutionStrategySchema.parse(value)
                              })
                           )
                        }
                     >
                        <SelectTrigger id="settings-mod-source-resolution" size="sm" className="w-full sm:w-56">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectGroup>
                              {modIdentityResolutionStrategySchema.options.map((strategy) => (
                                 <SelectItem key={strategy} value={strategy}>
                                    {t(`resolution.strategy.options.${strategy}`)}
                                 </SelectItem>
                              ))}
                           </SelectGroup>
                        </SelectContent>
                     </Select>
                  }
               />
            </SettingsSection>
         ) : null}

         <SettingsSection title={t('official.label')}>
            {snapshot ? (
               snapshot.official.map((source) => (
                  <RepositoryRow
                     key={source.id}
                     repository={source}
                     disabled={manageBusy}
                     linkUrl={source.listingUrl}
                     onToggle={(enabled) => void apply(() => mods.setRepositoryEnabled({ id: source.id, enabled }))}
                  />
               ))
            ) : loadFailed ? (
               <ErrorPanel
                  className="py-3"
                  message={t('unavailable')}
                  onRetry={() => refreshRepositories.mutate(undefined, { onSuccess: onChanged })}
               />
            ) : (
               <LoadingPanel className="min-h-20" />
            )}
         </SettingsSection>

         <SettingsSection
            title={
               <span className="flex items-center gap-2">
                  {t('list.label')}
                  <a
                     className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-xs"
                     href={repositoriesDocsUrl}
                     target="_blank"
                     rel="noreferrer"
                     onClick={(event) => {
                        event.preventDefault();
                        void window.encore.app.openLink({ url: repositoriesDocsUrl });
                     }}
                  >
                     {t('list.learnMore')}
                     <ExternalLink className="size-3" />
                  </a>
               </span>
            }
            headerAction={
               <RefreshButton
                  variant="ghost"
                  label={common('refresh')}
                  busy={refreshRepositories.isPending}
                  disabled={manageBusy}
                  onClick={() => refreshRepositories.mutate(undefined, { onSuccess: onChanged })}
               />
            }
         >
            <SettingsRow
               title={t('add.label')}
               control={
                  <form
                     className="w-full sm:w-80"
                     onSubmit={(event) => {
                        event.preventDefault();
                        if (!addBusy && addState.url.trim().length > 0) void inspectUrl(addState.url);
                     }}
                  >
                     <InputGroup className="h-8">
                        <InputGroupInput
                           value={addState.url}
                           placeholder={t('add.placeholder')}
                           aria-label={t('add.label')}
                           disabled={addBusy}
                           onChange={(event) => {
                              getPreviewGuard().invalidate();
                              setAddState({ status: 'idle', url: event.target.value });
                           }}
                        />
                        <InputGroupAddon align="inline-end">
                           <InputGroupButton
                              type="submit"
                              size="icon-xs"
                              aria-label={t('add.inspect')}
                              disabled={addBusy || addState.url.trim().length === 0}
                           >
                              <Plus />
                           </InputGroupButton>
                        </InputGroupAddon>
                     </InputGroup>
                  </form>
               }
            >
               {draftIssue || preview ? <div className="mt-3 flex flex-col gap-3">{draft}</div> : null}
            </SettingsRow>

            {manageIssue ? (
               <WarningLine className="text-status-warning px-4 py-2 text-sm">
                  {issues(manageIssue.issue)}
                  {manageIssue.detail ? ` ${manageIssue.detail}` : ''}
               </WarningLine>
            ) : null}

            {snapshot?.repositories.map((repository) => (
               <RepositoryRow
                  key={repository.id}
                  repository={repository}
                  disabled={manageBusy}
                  linkUrl={repository.infoUrl}
                  onToggle={(enabled) => void apply(() => mods.setRepositoryEnabled({ id: repository.id, enabled }))}
                  onRemove={() => void apply(() => mods.removeRepository({ id: repository.id }))}
               />
            ))}
         </SettingsSection>
      </>
   );
}

function toIssue(result: { status: 'ok' } | ModRepositoryProblem | null): { issue: ModRepositoryIssue; detail?: string } | null {
   if (!result) return { issue: 'fetch-failed' };

   return result.status === 'invalid' ? result : null;
}

function RepositoryRow({
   repository,
   disabled,
   linkUrl,
   onToggle,
   onRemove
}: {
   repository: ModOfficialSourceSummary | ModRepositorySummary;
   disabled: boolean;
   linkUrl?: string | null;
   onToggle: (enabled: boolean) => void;
   onRemove?: () => void;
}) {
   const t = useTranslations('settings.modRepositories');
   const issues = useTranslations('mods.repositories.issues');
   const [confirmOpen, setConfirmOpen] = useState(false);

   return (
      <SettingsRow
         title={
            <>
               <span className="truncate">{repository.name}</span>
               {linkUrl ? (
                  <Button
                     type="button"
                     variant="ghost-icon"
                     size="icon-xs"
                     className="shrink-0 cursor-pointer"
                     aria-label={t('list.open', { name: repository.name })}
                     onClick={() => void window.encore.app.openLink({ url: linkUrl })}
                  >
                     <ExternalLink />
                  </Button>
               ) : null}
            </>
         }
         description={
            <>
               <span className="block break-all">{repository.listingUrl}</span>
               {'owner' in repository ? (
                  <>
                     <span className="mt-1 block break-words">
                        {t('list.meta', { owner: repository.owner || t('preview.unknownOwner'), count: repository.packageCount ?? 0 })}
                     </span>
                     {repository.blocked ? (
                        <span className="text-status-warning mt-1 block break-words">
                           {t('list.blocked', { reason: repository.blockedReason ?? issues('denylisted') })}
                        </span>
                     ) : repository.issue ? (
                        <span className="mt-1 block break-words">{issues(repository.issue)}</span>
                     ) : null}
                  </>
               ) : null}
            </>
         }
         control={
            <>
               <Switch
                  checked={repository.enabled}
                  disabled={disabled || ('blocked' in repository && repository.blocked)}
                  aria-label={t('list.toggle')}
                  onCheckedChange={onToggle}
               />
               {onRemove ? (
                  <Button
                     type="button"
                     variant="ghost-icon"
                     size="icon-sm"
                     disabled={disabled}
                     aria-label={t('list.remove')}
                     onClick={() => setConfirmOpen(true)}
                  >
                     <Trash2 />
                  </Button>
               ) : null}
            </>
         }
      >
         {onRemove ? (
            <ConfirmDialog
               open={confirmOpen}
               title={t('list.removeConfirm.title')}
               description={t('list.removeConfirm.description')}
               confirmLabel={t('list.removeConfirm.confirm')}
               busy={disabled}
               onOpenChange={setConfirmOpen}
               onConfirm={() => {
                  setConfirmOpen(false);
                  onRemove();
               }}
            >
               <PreviewRow label={t('list.removeConfirm.name')} value={repository.name} />
               <PreviewRow label={t('list.removeConfirm.listing')} value={repository.listingUrl} />
            </ConfirmDialog>
         ) : null}
      </SettingsRow>
   );
}
