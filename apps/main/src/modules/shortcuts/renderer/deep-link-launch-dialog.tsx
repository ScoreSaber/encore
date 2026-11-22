import { CheckCircle2, Play } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { formatLaunchArgs } from '@/modules/launch/contract';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { canLaunchWithoutAsking, useDeepLinkLaunch } from '@/modules/shortcuts/renderer/use-deep-link-launch';

export function DeepLinkLaunchDialog() {
   const t = useTranslations('shortcuts.link');
   const launch = useTranslations('launch');
   const launchProblems = useTranslations('problems.launch');
   const common = useTranslations('common');
   const { state, remember, setRemember, confirm, dismiss } = useDeepLinkLaunch();
   const hidden =
      state.status === 'received' || (state.status === 'previewing' && state.automatic) || (state.status === 'starting' && state.automatic);

   return (
      <Dialog
         open={state.status !== 'idle' && !hidden}
         onOpenChange={(nextOpen) => {
            if (nextOpen || hidden || state.status === 'starting') return;

            dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'rejected' ? (
                  <>
                     <p>{t(`issues.${state.issue}`)}</p>
                     {state.detail ? <p className="text-muted-foreground text-xs break-all">{state.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'unavailable' ? (
                  <>
                     <PreviewRow label={t('install')} value={state.installName} />
                     <p>{launchProblems(state.preview.issue)}</p>
                     {state.preview.detail ? <p className="text-muted-foreground text-xs break-all">{state.preview.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{launch('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'starting' ? (
                  <>
                     <PreviewRow label={t('install')} value={state.installName} />
                     <PreviewRow label={launch('preview.executable')} value={state.preview.executablePath} />
                     <PreviewRow
                        label={launch('preview.args')}
                        value={state.preview.args.length > 0 ? formatLaunchArgs(state.preview.args) : launch('preview.noArgs')}
                     />

                     {state.preview.warnings.map((warning) => (
                        <WarningLine key={warning}>{launch(`warnings.${warning}`)}</WarningLine>
                     ))}
                     {state.preview.options.closeEncore ? <WarningLine>{launch('flags.close-encore.description')}</WarningLine> : null}
                     {state.status === 'ready' && canLaunchWithoutAsking(state.request) ? (
                        <label className="flex items-start gap-2">
                           <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
                           <span className="min-w-0 break-words">{t('remember')}</span>
                        </label>
                     ) : null}
                  </>
               ) : null}

               {state.status === 'starting' ? <p className="text-muted-foreground">{launch('result.starting')}</p> : null}

               {state.status === 'started' ? (
                  <p className="flex gap-2">
                     <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                     <span className="min-w-0 break-words">{launch('result.completed')}</span>
                  </p>
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void confirm()}>
                        <Play data-icon="inline-start" />
                        {launch('start')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'rejected' || state.status === 'unavailable' || state.status === 'failed' || state.status === 'started' ? (
                  <Button type="button" size="sm" onClick={dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
