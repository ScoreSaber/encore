import { CheckCircle2, Gamepad2, Link2, MonitorDown } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';

import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { shortcutKinds, type ShortcutIssue, type ShortcutWarning } from '@/modules/shortcuts/contract';
import type { InstallShortcuts } from '@/modules/shortcuts/renderer/use-install-shortcuts';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

const issueKeys: MessageKeyMap<ShortcutIssue, 'shortcuts.issues'> = {
   'install-not-found': 'installNotFound',
   'invalid-options': 'invalidOptions',
   'steam-client-missing': 'steamClientMissing',
   'steam-file-unreadable': 'steamFileUnreadable',
   'steam-user-missing': 'steamUserMissing',
   'unsupported-kind': 'unsupportedKind',
   'unsupported-platform': 'unsupportedPlatform',
   'write-failed': 'writeFailed'
};

const warningKeys: MessageKeyMap<ShortcutWarning, 'shortcuts.warnings'> = {
   'replaces-existing': 'replacesExisting',
   'steam-must-be-closed': 'steamMustBeClosed'
};

export function CreateShortcutSubmenu({ shortcuts }: { shortcuts: InstallShortcuts }) {
   const t = useTranslations('shortcuts');
   const { support, state } = shortcuts;
   const busy = state.status === 'previewing' || state.status === 'creating';

   if (!support || support.kinds.length === 0) return null;

   return (
      <DropdownMenuSub>
         <DropdownMenuSubTrigger disabled={busy}>
            <Link2 />
            {t('action')}
         </DropdownMenuSubTrigger>
         <DropdownMenuSubContent>
            {shortcutKinds
               .filter((kind) => support.kinds.includes(kind))
               .map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => void shortcuts.start(kind)}>
                     {kind === 'steam' ? <Gamepad2 /> : <MonitorDown />}
                     {t(`kinds.${kind}.action`)}
                  </DropdownMenuItem>
               ))}
         </DropdownMenuSubContent>
      </DropdownMenuSub>
   );
}

export function ShortcutDialog({ shortcuts }: { shortcuts: InstallShortcuts }) {
   const t = useTranslations('shortcuts');
   const common = useTranslations('common');
   const { state } = shortcuts;
   const busy = state.status === 'previewing' || state.status === 'creating';

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            shortcuts.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('dialog.title')}</DialogTitle>
               <DialogDescription>{t('dialog.description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'unavailable' ? (
                  <>
                     <p>{t(`issues.${issueKeys[state.preview.issue]}`)}</p>
                     {state.preview.detail ? <p className="text-muted-foreground text-xs break-all">{state.preview.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'creating' ? (
                  <>
                     <PreviewRow label={t(`kinds.${state.preview.kind}.target`)} value={state.preview.shortcutPath} />
                     <PreviewRow label={t('dialog.name')} value={state.preview.name} />
                     <PreviewRow label={t('dialog.starts')} value={state.preview.executablePath} />
                     <PreviewRow label={t('dialog.link')} value={state.preview.link} />

                     {state.preview.warnings.map((warning) => (
                        <WarningLine key={warning}>{t(`warnings.${warningKeys[warning]}`)}</WarningLine>
                     ))}
                  </>
               ) : null}

               {state.status === 'creating' ? <p className="text-muted-foreground">{t('result.creating')}</p> : null}

               {state.status === 'created' ? (
                  <>
                     <p className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                        <span className="min-w-0 break-words">{t(`result.created.${state.summary.kind}`)}</span>
                     </p>
                     <PreviewRow label={t(`kinds.${state.summary.kind}.target`)} value={state.summary.shortcutPath} />
                  </>
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={shortcuts.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void shortcuts.confirm()}>
                        {t('dialog.confirm')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'unavailable' || state.status === 'failed' || state.status === 'created' ? (
                  <Button type="button" size="sm" onClick={shortcuts.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
