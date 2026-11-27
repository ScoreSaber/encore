import { useEffect, useState } from 'react';

import { useNavigate } from '@tanstack/react-router';
import { CircleCheck, FolderPlus, Monitor, PackageOpen, Plus } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { EncoreMark } from '@/components/encore-mark';
import { PcvrIcon, QuestIcon } from '@/components/headset-icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/components/utils';

import type { BSManagerVersion } from '@/modules/bsmanager/contract';
import { useBSManagerAdoption, type BSManagerAdopter } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import type { VersionDownloader } from '@/modules/downloads/renderer/use-version-download';
import { InstallColorSwatch, InstallPlatformIcon } from '@/modules/installs/renderer/install-identity';
import type { InstallImporter } from '@/modules/installs/renderer/use-install-import';
import { useInstalls } from '@/modules/installs/renderer/use-installs';
import { QuestSetup } from '@/modules/quest/renderer/quest-setup';
import type { SetupChoice } from '@/modules/settings/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { localTargetId, runsOnSteamFrame } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type Step = 'choose' | 'bsmanager' | 'pc' | 'quest' | 'done';

const allSteps: Step[] = ['choose', 'bsmanager', 'pc', 'quest', 'done'];
const rowEnter = 'animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300 ease-out motion-reduce:animate-none';
const stagger = (index: number) => ({ animationDelay: `${index * 45}ms` });

export function Onboarding({ importer, downloader }: { importer: InstallImporter; downloader: VersionDownloader }) {
   const t = useTranslations('onboarding');
   const common = useTranslations('common');
   const bsmanager = useTranslations('bsmanager');
   const settings = useSettings();
   const navigate = useNavigate();
   const { targets } = useTargets();
   const localInstalls = useInstalls(localTargetId);
   const adopter = useBSManagerAdoption(localTargetId);
   const frame = runsOnSteamFrame(targets);
   const [picked, setChoice] = useState<SetupChoice | null>(null);
   const [current, setCurrent] = useState<Step>('choose');
   const [direction, setDirection] = useState<'forward' | 'back'>('forward');
   const choice = frame ? 'pc' : picked;
   const pc = choice !== null && choice !== 'quest';
   const steps = allSteps.filter((candidate) => {
      if (candidate === 'choose') return !frame;
      if (candidate === 'bsmanager') return pc && window.encore.platform !== 'darwin' && adopter.detection?.status === 'detected';
      if (candidate === 'pc') return pc;
      if (candidate === 'quest') return choice !== null && choice !== 'pc';
      return choice !== null;
   });
   const step = steps.includes(current) ? current : (steps[0] ?? 'choose');
   const index = steps.indexOf(step);
   const headset = targets.find((target) => target.kind === 'quest' && target.connection !== 'remote' && target.status === 'ready') ?? null;
   const adopting = adopter.state.status === 'adopting';

   const go = (next: Step) => {
      setDirection(steps.indexOf(next) < index ? 'back' : 'forward');
      setCurrent(next);
   };
   const next = () => go(steps[index + 1] ?? 'done');

   const finish = async (setup: SetupChoice) => {
      if (settings.saving) return;

      const written = await settings.updateApp({ setup });
      if (written.ok) void navigate({ to: '/' });
   };

   const pairPc = async () => {
      if (settings.saving) return;

      const written = await settings.updateApp({ setup: 'pc' });
      if (written.ok) void navigate({ to: '/settings/remote' });
   };

   const primary = () => {
      if (step === 'done' && choice) return { label: t('finish'), disabled: settings.saving, run: () => void finish(choice) };
      if (step === 'bsmanager' && adopter.state.status === 'adopting') {
         return { label: bsmanager(adopter.state.copyPrefix ? 'copyingPrefix' : 'adding'), disabled: true, run: next };
      }
      if (step === 'bsmanager' && (adopter.state.status === 'idle' || adopter.state.status === 'loading')) {
         return { label: t('continue'), disabled: true, run: next };
      }
      if (step === 'bsmanager' && adopter.state.status === 'ready' && (adopter.selected.length > 0 || adopter.state.copyPrefix)) {
         const label = bsmanager(adopter.action, { count: adopter.selected.length });
         return { label, disabled: false, run: () => void adopter.confirm() };
      }

      return { label: t('continue'), disabled: !choice, run: next };
   };
   const action = primary();

   return (
      <div className="bg-background text-foreground flex h-dvh flex-col">
         {window.encore.runtime === 'desktop' && !frame ? <header className="window-title-bar h-8 shrink-0" /> : null}
         <div className="flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-10">
            <div className="m-auto flex w-full max-w-xl flex-col gap-8">
               <div className="flex items-center justify-between">
                  <EncoreMark className="text-primary size-9" />
                  <div className="flex items-center gap-1.5">
                     <span className="sr-only">{t('step', { current: index + 1, total: steps.length })}</span>
                     {steps.map((candidate, dot) => (
                        <span
                           key={candidate}
                           aria-hidden
                           className={cn(
                              'animate-in fade-in zoom-in-50 h-1.5 rounded-full transition-all duration-300 motion-reduce:animate-none',
                              dot === index ? 'bg-primary w-6' : 'w-1.5',
                              dot < index && 'bg-primary/50',
                              dot > index && 'bg-muted-foreground/30'
                           )}
                        />
                     ))}
                  </div>
               </div>

               <div
                  key={step}
                  className={cn(
                     'animate-in fade-in fill-mode-both flex min-h-80 flex-col gap-6 duration-300 ease-out motion-reduce:animate-none',
                     direction === 'forward' ? 'slide-in-from-right-8' : 'slide-in-from-left-8'
                  )}
               >
                  {step === 'choose' ? <ChooseStep choice={choice} onChoose={setChoice} /> : null}
                  {step === 'bsmanager' ? <BSManagerStep adopter={adopter} /> : null}
                  {step === 'pc' ? (
                     <PcStep
                        importer={importer}
                        downloader={downloader}
                        frame={frame}
                        saving={settings.saving}
                        onReview={steps.includes('bsmanager') ? () => go('bsmanager') : undefined}
                        onPairPc={frame ? () => void pairPc() : undefined}
                     />
                  ) : null}
                  {step === 'quest' ? (
                     <>
                        <StepHeading title={t('quest.title')} description={t('quest.description')} />
                        <QuestSetup />
                        <p className="text-muted-foreground text-xs">{t('quest.later')}</p>
                     </>
                  ) : null}
                  {step === 'done' && choice ? (
                     <DoneStep
                        choice={choice}
                        frame={frame}
                        installCount={localInstalls.snapshot?.installs.length ?? 0}
                        headsetReady={headset !== null}
                     />
                  ) : null}
               </div>

               <footer className="flex items-center justify-between gap-3">
                  {index === 0 ? (
                     <Button
                        variant="ghost"
                        size="sm"
                        disabled={settings.saving}
                        onClick={() => void settings.updateApp({ setup: frame ? 'pc' : 'both' })}
                     >
                        {t('skip')}
                     </Button>
                  ) : (
                     <Button variant="ghost" size="sm" disabled={adopting} onClick={() => go(steps[index - 1] ?? 'choose')}>
                        {common('back')}
                     </Button>
                  )}
                  <Button size="sm" disabled={action.disabled} onClick={action.run}>
                     {action.label}
                  </Button>
               </footer>
            </div>
         </div>
      </div>
   );
}

function StepHeading({ title, description }: { title: string; description?: string }) {
   return (
      <div className="flex flex-col gap-1.5">
         <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
         {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
   );
}

function ChooseStep({ choice, onChoose }: { choice: SetupChoice | null; onChoose: (choice: SetupChoice) => void }) {
   const t = useTranslations('onboarding.choose');
   const mac = window.encore.platform === 'darwin';
   const options: { id: SetupChoice; icons: (typeof QuestIcon)[]; description: string }[] = [
      { id: 'pc', icons: [PcvrIcon], description: t(mac ? 'pcMacDescription' : 'pcDescription') },
      { id: 'quest', icons: [QuestIcon], description: t('questDescription') },
      { id: 'both', icons: [PcvrIcon, QuestIcon], description: t('bothDescription') }
   ];

   return (
      <>
         <StepHeading title={t('title')} description={t('description')} />
         <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t('title')}>
            {options.map((option, index) => (
               <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={choice === option.id}
                  style={stagger(index)}
                  className={cn(
                     rowEnter,
                     'hover:bg-accent flex flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center transition-[background-color,border-color,box-shadow,scale] active:scale-[0.98] sm:aspect-square',
                     choice === option.id && 'border-primary bg-primary/5 hover:bg-primary/10 ring-primary ring-1'
                  )}
                  onClick={() => onChoose(option.id)}
               >
                  <span
                     className={cn(
                        'flex gap-1.5 transition-[color,scale] duration-300',
                        choice === option.id ? 'text-primary scale-110' : 'text-muted-foreground'
                     )}
                  >
                     {option.icons.map((Icon, iconIndex) => (
                        <Icon key={iconIndex} className="size-12" />
                     ))}
                  </span>
                  <span className="text-sm font-semibold">{t(option.id)}</span>
                  <span className="text-muted-foreground text-xs leading-snug">{option.description}</span>
               </button>
            ))}
         </div>
      </>
   );
}

function BSManagerStep({ adopter }: { adopter: BSManagerAdopter }) {
   const t = useTranslations('bsmanager');
   const common = useTranslations('common');
   const problems = useTranslations('problems.bsmanager');
   const { state, selected, open } = adopter;

   useEffect(() => {
      if (state.status === 'idle') void open();
   }, [open, state.status]);

   return (
      <>
         <StepHeading title={t('title')} description={t('description')} />

         {state.status === 'idle' || state.status === 'loading' ? <p className="text-muted-foreground text-sm">{common('loading')}</p> : null}

         {state.status === 'invalid' ? (
            <div className="flex flex-col gap-1 text-sm">
               <p>{problems(state.plan.issue)}</p>
               {state.plan.detail ? <p className="text-muted-foreground text-xs break-all">{state.plan.detail}</p> : null}
            </div>
         ) : null}

         {state.status === 'failed' ? (
            <div className="flex flex-col items-start gap-3 text-sm">
               <p>{t('result.failed')}</p>
               <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
               {state.error.detail ? <p className="text-muted-foreground text-xs break-all">{state.error.detail}</p> : null}
               <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
                  {common('retry')}
               </Button>
            </div>
         ) : null}

         {state.status === 'ready' || state.status === 'adopting' || state.status === 'adopted' ? (
            <>
               <ul className="divide-y overflow-hidden rounded-xl border">
                  {state.plan.versions.map((version, index) => (
                     <BSManagerVersionRow
                        key={version.id}
                        version={version}
                        index={index}
                        checked={selected.includes(version.id)}
                        editable={state.status === 'ready'}
                        added={state.status === 'adopted' && selected.includes(version.id)}
                        onToggle={adopter.toggleVersion}
                     />
                  ))}
               </ul>

               {state.status === 'adopted' ? (
                  <p className={cn(rowEnter, 'flex items-center gap-2 text-sm font-medium')} style={stagger(selected.length)}>
                     <CircleCheck className="text-primary size-4" />
                     {state.outcome.adopted > 0 ? t('result.adopted', { count: state.outcome.adopted }) : t('prefixCopied')}
                  </p>
               ) : (
                  <label
                     className={cn(rowEnter, 'flex items-start justify-between gap-4 rounded-xl border p-4')}
                     style={stagger(state.plan.versions.length)}
                  >
                     <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{t('shareContent')}</span>
                        <span className="text-muted-foreground text-xs wrap-anywhere">
                           {t('shareContentHint', { path: state.plan.sharedContentPath })}
                        </span>
                     </span>
                     <Switch
                        checked={selected.length > 0 && adopter.shareContent}
                        disabled={state.status !== 'ready' || selected.length === 0}
                        onCheckedChange={(checked) => adopter.setOption('shareContent', checked)}
                     />
                  </label>
               )}
               {state.status === 'adopted' && state.copyPrefix && state.outcome.adopted > 0 ? <p className="text-sm">{t('prefixCopied')}</p> : null}
               {state.status !== 'adopted' && state.plan.prefixPath ? (
                  <label
                     className={cn(
                        rowEnter,
                        'flex items-start justify-between gap-4 rounded-xl border p-4',
                        state.plan.existingPrefix && 'border-destructive bg-destructive/10'
                     )}
                     style={stagger(state.plan.versions.length + 1)}
                  >
                     <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{t(state.plan.existingPrefix ? 'replacePrefix' : 'copyPrefix')}</span>
                        {state.plan.existingPrefix ? (
                           <span className="text-destructive text-sm font-semibold">{t('replacePrefixWarning')}</span>
                        ) : null}
                        <span className="text-muted-foreground text-xs wrap-anywhere">{t('copyPrefixHint', { path: state.plan.prefixPath })}</span>
                     </span>
                     <Switch
                        checked={state.copyPrefix}
                        disabled={state.status !== 'ready'}
                        onCheckedChange={(checked) => adopter.setOption('copyPrefix', checked)}
                     />
                  </label>
               ) : null}
            </>
         ) : null}
      </>
   );
}

function BSManagerVersionRow({
   version,
   index,
   checked,
   editable,
   added,
   onToggle
}: {
   version: BSManagerVersion;
   index: number;
   checked: boolean;
   editable: boolean;
   added: boolean;
   onToggle: BSManagerAdopter['toggleVersion'];
}) {
   const t = useTranslations('bsmanager');
   const id = `bsmanager-version-${version.id}`;
   const selectable = version.status === 'ready';

   return (
      <li className={cn(rowEnter, 'flex items-center gap-3 px-4 py-3 text-sm', !selectable && 'text-muted-foreground')} style={stagger(index)}>
         <span className="grid size-4 shrink-0 place-items-center">
            {added ? (
               <CircleCheck className="text-primary animate-in zoom-in-50 fade-in fill-mode-both size-4 duration-300" style={stagger(index)} />
            ) : (
               <Checkbox
                  id={id}
                  checked={checked || version.status === 'adopted'}
                  disabled={!editable || !selectable}
                  onCheckedChange={(next) => onToggle(version.id, next === true)}
               />
            )}
         </span>
         <InstallColorSwatch color={version.color} />
         <InstallPlatformIcon store={version.store} className="text-muted-foreground" />
         <label htmlFor={id} className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate font-medium">{version.name ?? version.version}</span>
            {version.name ? <span className="text-muted-foreground truncate text-xs">{version.version}</span> : null}
         </label>
         {version.status === 'ready' ? null : <span className="text-muted-foreground shrink-0 text-xs">{t(`status.${version.status}`)}</span>}
      </li>
   );
}

function PcStep({
   importer,
   downloader,
   frame,
   saving,
   onReview,
   onPairPc
}: {
   importer: InstallImporter;
   downloader: VersionDownloader;
   frame: boolean;
   saving: boolean;
   onReview?: () => void;
   onPairPc?: () => void;
}) {
   const t = useTranslations('onboarding');
   const { targets } = useTargets();
   const capabilities = targets.find((target) => target.id === localTargetId)?.capabilities ?? [];
   const installs = useInstalls(localTargetId);
   const list = installs.snapshot?.installs ?? [];
   const copy = frame ? 'frame' : 'pc';

   if (window.encore.platform === 'darwin') {
      return (
         <>
            <StepHeading title={t('pc.title')} description={t('pc.description')} />
            <p className="text-muted-foreground text-sm">{t('pc.mac')}</p>
         </>
      );
   }

   return (
      <>
         <StepHeading title={t(`${copy}.title`)} description={t(`${copy}.description`)} />

         {onReview && !list.some((install) => install.source === 'bsmanager') ? (
            <div className={cn(rowEnter, 'border-primary/40 bg-primary/5 flex items-center gap-3 rounded-xl border p-4')}>
               <PackageOpen className="text-primary size-5 shrink-0" />
               <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t('pc.bsmanager.title')}</p>
                  <p className="text-muted-foreground text-sm">{t('pc.bsmanager.description')}</p>
               </div>
               <Button size="sm" className="shrink-0" onClick={onReview}>
                  {t('pc.bsmanager.action')}
               </Button>
            </div>
         ) : null}

         <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{installs.loadStatus === 'loading' ? t('pc.scanning') : t('pc.found', { count: list.length })}</p>
            {list.length > 0 ? (
               <ul className="divide-y overflow-hidden rounded-xl border">
                  {list.map((install, index) => (
                     <li key={install.id} className={cn(rowEnter, 'flex items-center gap-3 px-4 py-2.5 text-sm')} style={stagger(index)}>
                        <InstallColorSwatch color={install.color} />
                        <InstallPlatformIcon store={install.store} className="text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{install.name}</span>
                        <span className="text-muted-foreground shrink-0 text-xs">{install.version}</span>
                     </li>
                  ))}
               </ul>
            ) : (
               <p className="text-muted-foreground text-sm">{t('pc.empty')}</p>
            )}
         </div>

         <div className="flex flex-wrap gap-2">
            {capabilities.includes('download-install') ? (
               <Button variant="outline" size="sm" disabled={downloader.step.status !== 'closed'} onClick={() => downloader.open(localTargetId)}>
                  <Plus data-icon="inline-start" />
                  {t('pc.download')}
               </Button>
            ) : null}
            {capabilities.includes('import-install') ? (
               <Button variant="outline" size="sm" disabled={importer.state.status !== 'idle'} onClick={() => void importer.choose(localTargetId)}>
                  <FolderPlus data-icon="inline-start" />
                  {t('pc.import')}
               </Button>
            ) : null}
         </div>

         {onPairPc ? (
            <div className="flex items-center gap-3 rounded-xl border p-4">
               <Monitor className="text-muted-foreground size-5 shrink-0" />
               <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t('pc.pairPc.title')}</p>
                  <p className="text-muted-foreground text-sm">{t('pc.pairPc.description')}</p>
               </div>
               <Button variant="outline" size="sm" className="shrink-0" disabled={saving} onClick={onPairPc}>
                  {t('pc.pairPc.action')}
               </Button>
            </div>
         ) : null}
      </>
   );
}

function DoneStep({
   choice,
   frame,
   installCount,
   headsetReady
}: {
   choice: SetupChoice;
   frame: boolean;
   installCount: number;
   headsetReady: boolean;
}) {
   const t = useTranslations('onboarding.done');
   const items = [
      ...(choice !== 'quest' ? [window.encore.platform === 'darwin' ? t('pcMac') : t('pc', { count: installCount })] : []),
      ...(choice !== 'pc' ? [t(headsetReady ? 'questReady' : 'questLater')] : []),
      ...(frame ? [t('pairPc')] : []),
      t('next')
   ];

   return (
      <>
         <CircleCheck className="text-primary animate-in zoom-in-50 fade-in fill-mode-both size-10 duration-500 ease-out motion-reduce:animate-none" />
         <StepHeading title={t('title')} />
         <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
            {items.map((item, index) => (
               <li key={item} className={cn(rowEnter, 'flex items-start gap-2')} style={stagger(index + 2)}>
                  <span aria-hidden className="bg-muted-foreground/40 mt-2 size-1 shrink-0 rounded-full" />
                  {item}
               </li>
            ))}
         </ul>
      </>
   );
}
