import { useEffect, useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ConfirmDialog } from '@/components/dialog/confirm-dialog';
import { RefreshButton } from '@/components/refresh-button';
import { ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldTitle } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import type {
   ModOfficialSourceSummary,
   ModRepositoryIssue,
   ModRepositoryProblem,
   ModRepositoryResult,
   ModRepositorySummary
} from '@/modules/mods/contract';
import { modIdentityResolutionStrategySchema } from '@/modules/mods/contract';
import { modRepositoryIssueKeys } from '@/modules/mods/renderer/mod-issue-keys';
import { modRepositoryListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useTargets } from '@/modules/targets/renderer/use-targets';

export function ModRepositoriesSection() {
   const t = useTranslations('settings.modRepositories');
   const { targets } = useTargets();

   if (!targets.some((target) => target.status === 'ready' && target.capabilities.includes('manage-mods'))) return null;

   return (
      <SettingsSection title={t('title')}>
         <ModRepositoriesFields />
      </SettingsSection>
   );
}

export function ModRepositoriesFields({
   initialUrl = '',
   addOnly = false,
   reviewOnly = false,
   onChanged,
   onDraftDismissed
}: {
   initialUrl?: string;
   addOnly?: boolean;
   reviewOnly?: boolean;
   onChanged?: () => void;
   onDraftDismissed?: () => void;
} = {}) {
   const t = useTranslations('settings.modRepositories');
   const issues = useTranslations('mods.repositories.issues');
   const common = useTranslations('common');
   const [url, setUrl] = useState(initialUrl);
   const [acknowledged, setAcknowledged] = useState(false);
   const [issue, setIssue] = useState<{ issue: ModRepositoryIssue; detail?: string } | null>(null);
   const mods = window.encore.mods;
   const queryKey = modRepositoryListQueryOptions.queryKey;
   const repositories = useQuery(modRepositoryListQueryOptions);
   const previewRepository = useMutation({ mutationFn: (address: string) => mods.previewRepository({ url: address }) });
   const previewInitialRepository = previewRepository.mutate;
   const refreshRepositories = useSnapshotMutation({ queryKey, run: () => mods.refreshRepositories() });
   const addRepository = useSnapshotMutation({
      queryKey,
      run: mods.addRepository,
      snapshot: (result) => (result.status === 'ok' ? result.snapshot : undefined)
   });
   const toggleRepository = useSnapshotMutation({
      queryKey,
      run: mods.setRepositoryEnabled,
      snapshot: (result) => (result.status === 'ok' ? result.snapshot : undefined)
   });
   const removeRepository = useSnapshotMutation({
      queryKey,
      run: mods.removeRepository,
      snapshot: (result) => (result.status === 'ok' ? result.snapshot : undefined)
   });
   const setResolution = useSnapshotMutation({
      queryKey,
      run: mods.setModSourceResolution,
      snapshot: (result) => (result.status === 'ok' ? result.snapshot : undefined)
   });

   const snapshot = repositories.data ?? null;
   const preview = previewRepository.data ?? null;
   const busy =
      previewRepository.isPending ||
      refreshRepositories.isPending ||
      addRepository.isPending ||
      toggleRepository.isPending ||
      setResolution.isPending ||
      removeRepository.isPending;
   const loadFailed = repositories.isError || refreshRepositories.isError;
   const showRepositoryList = !snapshot || loadFailed || snapshot.repositories.length > 0;

   useEffect(() => {
      if (!initialUrl) return;

      previewInitialRepository(initialUrl, {
         onSuccess: (result) => setIssue(toIssue(result)),
         onError: () => setIssue({ issue: 'fetch-failed' })
      });
   }, [initialUrl, previewInitialRepository]);

   function resetDraft() {
      setUrl('');
      setAcknowledged(false);
      setIssue(null);
      previewRepository.reset();
      onDraftDismissed?.();
   }

   async function apply(write: Promise<ModRepositoryResult>) {
      const result = await write.catch(() => null);
      setIssue(toIssue(result));
      if (result?.status === 'ok') onChanged?.();

      return result?.status === 'ok';
   }

   async function inspect() {
      const result = await previewRepository.mutateAsync(url).catch(() => null);

      setAcknowledged(false);
      setIssue(toIssue(result));
   }

   async function add() {
      if (await apply(addRepository.mutateAsync({ url, acknowledged }))) resetDraft();
   }

   const canAdd = preview?.status === 'ok' && acknowledged && !busy;

   return (
      <>
         {!addOnly ? (
            <>
               <Field orientation="vertical" className="py-2">
                  <FieldContent className="min-w-0 gap-0.5">
                     <FieldTitle>{t('official.label')}</FieldTitle>
                  </FieldContent>

                  <div className="flex w-full flex-col gap-2">
                     {snapshot?.official.map((source) => (
                        <RepositoryRow
                           key={source.id}
                           repository={source}
                           disabled={busy}
                           linkUrl={source.listingUrl}
                           onToggle={(enabled) => void apply(toggleRepository.mutateAsync({ id: source.id, enabled }))}
                        />
                     ))}
                  </div>
               </Field>

               {snapshot ? (
                  <>
                     <SettingsRow label={t('resolution.combine.title')} description={t('resolution.combine.description')}>
                        <Switch
                           checked={snapshot.resolution.combine}
                           disabled={busy}
                           aria-label={t('resolution.combine.title')}
                           onCheckedChange={(combine) => void apply(setResolution.mutateAsync({ ...snapshot.resolution, combine }))}
                        />
                     </SettingsRow>
                     <SettingsRow
                        label={t('resolution.strategy.title')}
                        description={t('resolution.strategy.description')}
                        htmlFor="settings-mod-source-resolution"
                     >
                        <Select
                           value={snapshot.resolution.strategy}
                           disabled={busy || !snapshot.resolution.combine}
                           onValueChange={(value) =>
                              void apply(
                                 setResolution.mutateAsync({
                                    ...snapshot.resolution,
                                    strategy: modIdentityResolutionStrategySchema.parse(value)
                                 })
                              )
                           }
                        >
                           <SelectTrigger id="settings-mod-source-resolution" className="w-full min-w-44 @md/field-group:w-56">
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
                     </SettingsRow>
                  </>
               ) : null}
            </>
         ) : null}

         <Field orientation="vertical" className={reviewOnly ? undefined : 'py-2'}>
            {!reviewOnly ? (
               <>
                  <FieldContent className="min-w-0 gap-0.5">
                     <FieldTitle>{t('add.label')}</FieldTitle>
                  </FieldContent>

                  <form
                     className="w-full"
                     onSubmit={(event) => {
                        event.preventDefault();
                        void inspect();
                     }}
                  >
                     <InputGroup>
                        <InputGroupInput
                           value={url}
                           placeholder={t('add.placeholder')}
                           aria-label={t('add.label')}
                           disabled={busy}
                           onChange={(event) => {
                              setUrl(event.target.value);
                              setAcknowledged(false);
                              previewRepository.reset();
                           }}
                        />
                        <InputGroupAddon align="inline-end">
                           <InputGroupButton type="submit" size="icon-sm" aria-label={t('add.inspect')} disabled={busy || url.trim().length === 0}>
                              <Plus />
                           </InputGroupButton>
                        </InputGroupAddon>
                     </InputGroup>
                  </form>
               </>
            ) : null}

            {issue ? (
               <WarningLine className="text-status-warning w-full">
                  {issues(modRepositoryIssueKeys[issue.issue])}
                  {issue.detail ? ` ${issue.detail}` : ''}
               </WarningLine>
            ) : null}

            {preview?.status === 'ok' ? (
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
                     <Checkbox checked={acknowledged} disabled={busy} onCheckedChange={(next) => setAcknowledged(next === true)} />
                     <span className="min-w-0 break-words">{t('preview.acknowledge')}</span>
                  </label>
                  <div className={reviewOnly ? 'flex flex-wrap justify-end gap-2 pt-1' : 'flex flex-wrap gap-2'}>
                     <Button type="button" size="sm" disabled={!canAdd} onClick={() => void add()}>
                        <Plus data-icon="inline-start" />
                        {t('add.confirm')}
                     </Button>
                     <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={resetDraft}>
                        {common('cancel')}
                     </Button>
                  </div>
               </div>
            ) : null}
         </Field>

         {!addOnly && showRepositoryList ? (
            <Field orientation="vertical" className="py-2">
               <div className="flex w-full items-center justify-between gap-2">
                  <FieldTitle>{t('list.label')}</FieldTitle>
                  <RefreshButton
                     label={common('refresh')}
                     disabled={busy}
                     onClick={() => refreshRepositories.mutate(undefined, { onSuccess: onChanged })}
                  />
               </div>

               <div className="flex w-full flex-col gap-2">
                  {!snapshot && !loadFailed ? <LoadingPanel rows={1} /> : null}
                  {loadFailed ? (
                     <ErrorPanel message={t('unavailable')} onRetry={() => refreshRepositories.mutate(undefined, { onSuccess: onChanged })} />
                  ) : null}
                  {snapshot?.repositories.map((repository) => (
                     <RepositoryRow
                        key={repository.id}
                        repository={repository}
                        disabled={busy}
                        linkUrl={repository.infoUrl}
                        onToggle={(enabled) => void apply(toggleRepository.mutateAsync({ id: repository.id, enabled }))}
                        onRemove={() => void apply(removeRepository.mutateAsync({ id: repository.id }))}
                     />
                  ))}
               </div>
            </Field>
         ) : null}
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
      <div className="bg-background/50 flex flex-col gap-2 rounded-md border px-3 py-2 text-sm @lg/field-group:flex-row @lg/field-group:items-center">
         <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
               <div className="truncate font-medium">{repository.name}</div>
               {linkUrl ? (
                  <Button
                     type="button"
                     variant="ghost-icon"
                     size="icon-xs"
                     className="shrink-0"
                     aria-label={t('list.open', { name: repository.name })}
                     onClick={() => void window.encore.mods.openLink({ url: linkUrl })}
                  >
                     <ExternalLink />
                  </Button>
               ) : null}
            </div>
            <div className="text-muted-foreground text-xs break-all">{repository.listingUrl}</div>
            {'owner' in repository ? (
               <>
                  <div className="text-muted-foreground mt-1 text-xs break-words">
                     {t('list.meta', {
                        owner: repository.owner || t('preview.unknownOwner'),
                        count: repository.packageCount ?? 0
                     })}
                  </div>
                  {repository.blocked ? (
                     <div className="text-status-warning mt-1 text-xs break-words">
                        {t('list.blocked', { reason: repository.blockedReason ?? issues(modRepositoryIssueKeys.denylisted) })}
                     </div>
                  ) : null}
                  {!repository.blocked && repository.issue ? (
                     <div className="text-muted-foreground mt-1 text-xs break-words">{issues(modRepositoryIssueKeys[repository.issue])}</div>
                  ) : null}
               </>
            ) : null}
         </div>
         <div className="flex shrink-0 items-center gap-2">
            <Switch
               checked={repository.enabled}
               disabled={disabled || ('blocked' in repository && repository.blocked)}
               aria-label={t('list.toggle')}
               onCheckedChange={onToggle}
            />
            {onRemove ? (
               <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={() => setConfirmOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  {t('list.remove')}
               </Button>
            ) : null}
         </div>

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
      </div>
   );
}
