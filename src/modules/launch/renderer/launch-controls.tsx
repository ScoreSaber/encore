import { AlertTriangle, Bug, ChevronRight, Glasses, Loader2, Monitor, Play, ScrollText, ShieldCheck, SkipForward, SquarePen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { PathText } from '@/components/text/path-text';
import { Button } from '@/components/ui/button';
import { CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/components/utils';

import type { MessageKey } from '@/app/renderer/i18n/keys';
import {
   formatLaunchArgs,
   launchFlagsFor,
   type LaunchFlag,
   type LaunchIssue,
   type LaunchWarning,
   type ReadyLaunchPreview
} from '@/modules/launch/contract';
import { ProtonFolderField } from '@/modules/launch/renderer/proton-folder-field';
import type { InstallLaunch } from '@/modules/launch/renderer/use-install-launch';

const issueKeys: Record<LaunchIssue, MessageKey<'launch.issues'>> = {
   'executable-missing': 'executableMissing',
   'inspect-failed': 'inspectFailed',
   'invalid-options': 'invalidOptions',
   'not-found': 'notFound',
   'proton-not-found': 'protonNotFound',
   'proton-not-set': 'protonNotSet',
   'store-client-missing': 'storeClientMissing',
   'unsupported-platform': 'unsupportedPlatform',
   'unsupported-target': 'unsupportedTarget'
};

const warningKeys: Record<LaunchWarning, MessageKey<'launch.warnings'>> = {
   'admin-prompt': 'adminPrompt',
   'admin-unsupported': 'adminUnsupported',
   'oculus-client-starts': 'oculusClientStarts',
   'proton-logs': 'protonLogs',
   'steam-client-starts': 'steamClientStarts',
   'steam-skipped': 'steamSkipped'
};

const flagKeys: Record<LaunchFlag, { label: MessageKey<'launch'>; description: MessageKey<'launch'> }> = {
   'oculus-mode': { label: 'flags.oculusMode.label', description: 'flags.oculusMode.description' },
   fpfc: { label: 'flags.fpfc.label', description: 'flags.fpfc.description' },
   debug: { label: 'flags.debug.label', description: 'flags.debug.description' },
   'skip-steam': { label: 'flags.skipSteam.label', description: 'flags.skipSteam.description' },
   editor: { label: 'flags.editor.label', description: 'flags.editor.description' },
   'proton-logs': { label: 'flags.protonLogs.label', description: 'flags.protonLogs.description' }
};

const flagIcons: Record<LaunchFlag, typeof Play> = {
   'oculus-mode': Glasses,
   fpfc: Monitor,
   debug: Bug,
   'skip-steam': SkipForward,
   editor: SquarePen,
   'proton-logs': ScrollText
};

const launchOptionOrder: (LaunchFlag | 'run-as-admin')[] = ['editor', 'oculus-mode', 'skip-steam', 'fpfc', 'run-as-admin', 'debug', 'proton-logs'];

function isStarting(launch: InstallLaunch) {
   return launch.state.status === 'starting' || launch.state.status === 'running';
}

export function LaunchAction({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const common = useTranslations('common');
   const starting = isStarting(launch);

   return (
      <div className="flex shrink-0 items-center gap-2">
         {starting ? (
            <Button type="button" variant="outline" size="sm" disabled={launch.state.status === 'starting'} onClick={launch.cancel}>
               {common('cancel')}
            </Button>
         ) : null}

         <Button
            type="button"
            size="lg"
            className="shadow-primary/20 hover:shadow-primary/30 min-w-52 cursor-pointer gap-2.5 font-semibold shadow-lg"
            disabled={launch.state.status !== 'ready'}
            onClick={() => void launch.launch()}
         >
            {starting ? <Loader2 className="animate-spin" /> : <Play />}
            {starting ? t('result.starting') : t('start')}
         </Button>
      </div>
   );
}

export function LaunchProgress({ launch }: { launch: InstallLaunch }) {
   if (!isStarting(launch)) return null;

   const percent = Math.min(Math.max(launch.operation?.progress?.percent ?? 0, 0), 100);

   return (
      <span aria-hidden className="bg-primary/20 absolute inset-x-0 bottom-0 h-0.5">
         <span className="bg-primary block h-full transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </span>
   );
}

export function LaunchFacets({ launch, name }: { launch: InstallLaunch; name: string }) {
   const targets = useTranslations('targets');
   const preview =
      launch.state.status === 'ready' || launch.state.status === 'starting' || launch.state.status === 'running' ? launch.state.preview : null;
   const version = preview?.version;
   const facets: string[] = [];

   if (version && !name.includes(version)) facets.push(version);
   if (preview?.store) facets.push(targets(`store.${preview.store}`));

   return (
      <div className="text-muted-foreground flex min-h-4 min-w-0 items-center gap-x-2 text-xs">
         {facets.length > 0
            ? facets.map((facet, index) =>
                 index === 0 ? (
                    <span key={facet} className="truncate">
                       {facet}
                    </span>
                 ) : (
                    <Facet key={facet}>{facet}</Facet>
                 )
              )
            : null}
      </div>
   );
}

export function LaunchOptions({ launch }: { launch: InstallLaunch }) {
   const starting = isStarting(launch);
   const supportedFlags = launchFlagsFor(launch.platform);
   const options = launchOptionOrder.filter((option) => (option === 'run-as-admin' ? launch.platform !== 'linux' : supportedFlags.includes(option)));

   return (
      <>
         {options.map((option) =>
            option === 'run-as-admin' ? (
               <LaunchOption
                  key={option}
                  icon={ShieldCheck}
                  labelKey="runAsAdmin.label"
                  descriptionKey="runAsAdmin.description"
                  pressed={launch.runAsAdmin}
                  disabled={starting}
                  onPressedChange={launch.setRunAsAdmin}
               />
            ) : (
               <LaunchOption
                  key={option}
                  icon={flagIcons[option]}
                  labelKey={flagKeys[option].label}
                  descriptionKey={flagKeys[option].description}
                  pressed={launch.flags.includes(option)}
                  disabled={starting}
                  onPressedChange={(enabled) => launch.toggleFlag(option, enabled)}
               />
            )
         )}
      </>
   );
}

export function LaunchAdvancedTrigger() {
   const t = useTranslations('launch');

   return (
      <CollapsibleTrigger asChild>
         <Button type="button" variant="ghost" size="sm" className="text-muted-foreground group gap-1 px-2">
            <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
            {t('advanced')}
         </Button>
      </CollapsibleTrigger>
   );
}

export function LaunchAdvanced({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const preview =
      launch.state.status === 'ready' || launch.state.status === 'starting' || launch.state.status === 'running' ? launch.state.preview : null;
   const starting = isStarting(launch);

   return (
      <CollapsibleContent className="flex flex-col gap-3 pb-1">
         <div className="flex flex-col gap-1.5">
            <Label htmlFor="launch-args" className="text-xs">
               {t('args.label')}
            </Label>
            <Input
               id="launch-args"
               className="max-w-md"
               value={launch.argsInput}
               disabled={starting}
               placeholder={t('args.placeholder')}
               onChange={(event) => launch.setArgsInput(event.target.value)}
            />
         </div>

         {preview ? <LaunchCommand preview={preview} /> : null}
      </CollapsibleContent>
   );
}

export function LaunchProton({ launch }: { launch: InstallLaunch }) {
   if (launch.platform !== 'linux' || !launch.localTarget) return null;

   return <ProtonFolderField disabled={isStarting(launch)} onChange={launch.recheck} />;
}

export function LaunchNotices({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const { state, failure } = launch;
   const problem =
      state.status === 'unavailable'
         ? {
              text: t(`issues.${issueKeys[state.preview.issue]}`),
              detail: state.preview.detail
           }
         : state.status === 'failed'
           ? { text: t('issues.inspectFailed'), detail: state.error.message }
           : failure
             ? { text: t('result.failed'), detail: failure }
             : null;
   const warnings = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.preview.warnings : [];

   if (!problem && warnings.length === 0) return null;

   return (
      <ul className="flex flex-col gap-1 pb-0.5 text-xs">
         {problem ? (
            <Notice tone="bad">
               {problem.text}
               {problem.detail ? <span className="text-muted-foreground"> {problem.detail}</span> : null}
            </Notice>
         ) : null}

         {warnings.map((warning) => (
            <Notice key={warning}>{t(`warnings.${warningKeys[warning]}`)}</Notice>
         ))}
      </ul>
   );
}

function Notice({ tone, children }: { tone?: 'bad'; children: React.ReactNode }) {
   return (
      <li className={cn('flex gap-2', tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>
         <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', tone === 'bad' ? undefined : 'text-status-warning')} />
         <span className="min-w-0 break-words">{children}</span>
      </li>
   );
}

function Facet({ children }: { children: React.ReactNode }) {
   return (
      <span className="text-muted-foreground flex items-center gap-2 truncate">
         <span aria-hidden className="bg-muted-foreground/40 size-1 rounded-full" />
         {children}
      </span>
   );
}

function LaunchOption({
   icon: Icon,
   labelKey,
   descriptionKey,
   pressed,
   disabled,
   onPressedChange
}: {
   icon: typeof Play;
   labelKey: MessageKey<'launch'>;
   descriptionKey: MessageKey<'launch'>;
   pressed: boolean;
   disabled: boolean;
   onPressedChange: (pressed: boolean) => void;
}) {
   const t = useTranslations('launch');

   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <span className="inline-flex">
               <Toggle
                  variant="outline"
                  size="sm"
                  pressed={pressed}
                  disabled={disabled}
                  onPressedChange={onPressedChange}
                  className="data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-primary h-7 gap-1.5 px-2 text-xs [&_svg]:size-3.5"
               >
                  <Icon />
                  {t(labelKey)}
               </Toggle>
            </span>
         </TooltipTrigger>
         <TooltipContent className="max-w-64">{t(descriptionKey)}</TooltipContent>
      </Tooltip>
   );
}

function LaunchCommand({ preview }: { preview: ReadyLaunchPreview }) {
   const t = useTranslations('launch');

   return (
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 rounded-md border px-3 py-2.5 text-xs">
         <CommandRow label={t('preview.executable')} value={preview.executablePath} />
         <CommandRow label={t('preview.workingDirectory')} value={preview.workingDirectory} />
         <CommandRow label={t('preview.args')} value={preview.args.length > 0 ? formatLaunchArgs(preview.args) : t('preview.noArgs')} />

         {preview.proton ? (
            <>
               <CommandRow label={t('preview.proton')} value={preview.proton.protonBinaryPath} />
               <CommandRow label={t('preview.compatData')} value={preview.proton.compatDataPath} />
               {preview.proton.logPath ? <CommandRow label={t('preview.protonLogs')} value={preview.proton.logPath} /> : null}
               {preview.proton.flatpakHost || preview.proton.steamRunWrapper ? (
                  <CommandRow
                     label={t('preview.wrapper')}
                     value={
                        preview.proton.flatpakHost
                           ? t(preview.proton.steamRunWrapper ? 'preview.flatpakSteamRun' : 'preview.flatpakHost')
                           : t('preview.steamRun')
                     }
                  />
               ) : null}
            </>
         ) : null}
      </dl>
   );
}

function CommandRow({ label, value }: { label: string; value: string }) {
   return (
      <>
         <dt className="text-muted-foreground whitespace-nowrap">{label}</dt>
         <dd className="min-w-0 font-mono break-words">
            <PathText value={value} />
         </dd>
      </>
   );
}
