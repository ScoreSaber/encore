import { Bug, ChevronRight, Cpu, Loader2, MemoryStick, Monitor, Play, ScrollText, ShieldCheck, SkipForward, SquarePen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { RiftIcon } from '@/components/headset-icons';
import { WarningLine } from '@/components/state/state-panel';
import { PathText } from '@/components/text/path-text';
import { Button } from '@/components/ui/button';
import { CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { formatLaunchArgs, launchFlagsFor, type ReadyLaunchPreview } from '@/modules/launch/contract';
import { ProtonFolderField } from '@/modules/launch/renderer/proton-folder-field';
import type { InstallLaunch } from '@/modules/launch/renderer/use-install-launch';

const optionIcons = {
   'oculus-mode': RiftIcon,
   fpfc: Monitor,
   debug: Bug,
   'skip-steam': SkipForward,
   editor: SquarePen,
   'proton-logs': ScrollText,
   'emulate-x64': Cpu,
   'run-as-admin': ShieldCheck,
   'close-encore': MemoryStick
};

const launchOptionOrder: (keyof typeof optionIcons)[] = [
   'editor',
   'oculus-mode',
   'skip-steam',
   'fpfc',
   'run-as-admin',
   'close-encore',
   'debug',
   'proton-logs',
   'emulate-x64'
];

export function LaunchAction({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const common = useTranslations('common');
   if (launch.platform === 'quest' && launch.gameRunning) {
      return (
         <Button type="button" variant="outline" size="lg" disabled={launch.stopping} onClick={launch.stop}>
            {launch.stopping ? t('stopping') : t('stop')}
         </Button>
      );
   }

   return (
      <div className="flex shrink-0 items-center gap-2">
         {launch.launching ? (
            <Button type="button" variant="outline" size="sm" disabled={launch.starting} onClick={launch.cancel}>
               {common('cancel')}
            </Button>
         ) : null}

         <Button
            type="button"
            size="lg"
            className="shadow-primary/20 hover:shadow-primary/30 min-w-52 cursor-pointer gap-2.5 font-semibold shadow-lg"
            disabled={!launch.canLaunch}
            onClick={launch.launch}
         >
            {launch.launching ? <Loader2 /> : <Play />}
            {launch.launching ? t('result.starting') : t('start')}
         </Button>
      </div>
   );
}

export function LaunchProgress({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch.progress');
   if (!launch.launching) return null;

   const progress = launch.operation?.progress;
   const percent = Math.min(Math.max(progress?.percent ?? 0, 0), 100);
   const status =
      progress?.phase === 'arm64-download' ? t('arm64-download', { percent }) : progress?.phase === 'arm64-runtime' ? t('arm64-runtime') : null;

   return (
      <>
         {status ? <p className="text-muted-foreground text-center text-xs">{status}</p> : null}
         <span aria-hidden className="bg-primary/20 absolute inset-x-0 bottom-0 h-0.5">
            <span className="bg-primary block h-full transition-[width] duration-300" style={{ width: `${percent}%` }} />
         </span>
      </>
   );
}

export function LaunchOptions({ launch }: { launch: InstallLaunch }) {
   const disabled = launch.launching || !launch.ready;
   const supportedFlags = launchFlagsFor(launch.platform, launch.steamFrame);
   const options = launchOptionOrder.filter((option) => {
      if (option === 'run-as-admin') return launch.platform === 'windows';
      if (option === 'close-encore') return launch.platform === 'windows' || launch.platform === 'linux';
      return supportedFlags.includes(option);
   });

   return options.map((option) => (
      <LaunchOption
         key={option}
         option={option}
         pressed={
            option === 'run-as-admin'
               ? launch.options.runAsAdmin
               : option === 'close-encore'
                 ? launch.options.closeEncore
                 : launch.options.flags.includes(option)
         }
         disabled={disabled}
         onPressedChange={(pressed) =>
            option === 'run-as-admin'
               ? launch.setRunAsAdmin(pressed)
               : option === 'close-encore'
                 ? launch.setCloseEncore(pressed)
                 : launch.toggleFlag(option, pressed)
         }
      />
   ));
}

export function LaunchAdvancedTrigger() {
   const t = useTranslations('launch');

   return (
      <CollapsibleTrigger asChild>
         <Button type="button" variant="menu" size="sm" className="group">
            <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
            {t('advanced')}
         </Button>
      </CollapsibleTrigger>
   );
}

export function LaunchAdvanced({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const disabled = launch.launching || !launch.ready;

   return (
      <CollapsibleContent className="flex flex-col gap-3 pb-1">
         <LaunchProton launch={launch} when="ready" />
         <div className="flex flex-col gap-1.5">
            <Label htmlFor="launch-line" className="text-xs">
               {t('line.label')}
            </Label>
            <Input
               id="launch-line"
               className="max-w-xl font-mono text-xs"
               value={launch.launchLine}
               disabled={disabled}
               placeholder={t(launch.platform === 'linux' ? 'line.placeholderLinux' : 'line.placeholder')}
               onChange={(event) => launch.setLaunchLine(event.target.value)}
            />
         </div>

         {launch.preview ? <LaunchCommand preview={launch.preview} /> : null}
      </CollapsibleContent>
   );
}

export function LaunchProton({ launch, when }: { launch: InstallLaunch; when: 'missing' | 'ready' }) {
   if (launch.platform !== 'linux' || !launch.localTarget) return null;

   return <ProtonFolderField className="px-0 sm:px-0" when={when} disabled={launch.launching} onChange={launch.recheck} />;
}

export function LaunchNotices({ launch }: { launch: InstallLaunch }) {
   const t = useTranslations('launch');
   const problems = useTranslations('problems.launch');
   const { previewFailure, failure, optionsFailure } = launch;
   const unavailable = launch.unavailable?.issue === 'proton-not-set' && launch.localTarget ? null : launch.unavailable;
   const problem = unavailable
      ? { text: problems(unavailable.issue), detail: unavailable.detail }
      : previewFailure
        ? { text: problems('inspect-failed'), detail: previewFailure }
        : failure
          ? { text: t('result.failed'), detail: failure }
          : optionsFailure
            ? { text: t('optionsFailed'), detail: optionsFailure }
            : null;
   const warnings = launch.preview?.warnings ?? [];

   if (!problem && warnings.length === 0) return null;

   return (
      <ul className="flex flex-col gap-1 pb-0.5 text-xs">
         {problem ? (
            <WarningLine as="li" tone="destructive" iconClassName="mt-0.5 size-3.5">
               {problem.text}
               {problem.detail ? <span className="text-muted-foreground"> {problem.detail}</span> : null}
            </WarningLine>
         ) : null}

         {warnings.map((warning) => (
            <WarningLine key={warning} as="li" tone="warning" iconClassName="mt-0.5 size-3.5">
               {t(`warnings.${warning}`)}
            </WarningLine>
         ))}
      </ul>
   );
}

function LaunchOption({
   option,
   pressed,
   disabled,
   onPressedChange
}: {
   option: keyof typeof optionIcons;
   pressed: boolean;
   disabled: boolean;
   onPressedChange: (pressed: boolean) => void;
}) {
   const t = useTranslations('launch');
   const Icon = optionIcons[option];

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
                  {t(`flags.${option}.label`)}
               </Toggle>
            </span>
         </TooltipTrigger>
         <TooltipContent className="max-w-64">{t(`flags.${option}.description`)}</TooltipContent>
      </Tooltip>
   );
}

function LaunchCommand({ preview }: { preview: ReadyLaunchPreview }) {
   const t = useTranslations('launch');

   return (
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 rounded-md border px-3 py-2.5 text-xs">
         <CommandRow label={t('preview.executable')} value={preview.executablePath} />
         <CommandRow label={t('preview.workingDirectory')} value={preview.workingDirectory} />
         {Object.keys(preview.options.environment).length > 0 ? (
            <CommandRow
               label={t('preview.environment')}
               value={formatLaunchArgs(Object.entries(preview.options.environment).map(([name, value]) => `${name}=${value}`))}
            />
         ) : null}
         <CommandRow label={t('preview.args')} value={preview.args.length > 0 ? formatLaunchArgs(preview.args) : t('preview.noArgs')} />

         {preview.proton ? (
            <>
               {preview.options.wrapper.length > 0 ? (
                  <CommandRow label={t('preview.wrapperCommand')} value={formatLaunchArgs(preview.options.wrapper)} />
               ) : null}
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
