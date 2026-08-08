import { Check, FolderOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { ColorPicker } from '@/components/ui/color-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/utils';

import { defaultInstallColor, installColors } from '@/modules/installs/contract';
import type { InstallEditor } from '@/modules/installs/renderer/use-install-editor';

export function EditInstallDialog({ editor }: { editor: InstallEditor }) {
   const t = useTranslations('installs.manage.edit');
   const common = useTranslations('common');
   const { state } = editor;
   const busy = state.status === 'saving' || state.status === 'choosing';

   return (
      <Dialog
         open={state.status !== 'closed'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            editor.close();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            {state.status === 'closed' ? null : (
               <div className="flex flex-col gap-4 text-sm">
                  <div className="flex flex-col gap-2">
                     <label className="font-medium" htmlFor="install-name">
                        {t('name')}
                     </label>
                     <Input
                        id="install-name"
                        value={state.name}
                        maxLength={60}
                        disabled={busy}
                        placeholder={t('namePlaceholder')}
                        onChange={(event) => editor.edit({ name: event.target.value })}
                     />
                  </div>

                  {state.canChangePath ? (
                     <div className="flex flex-col gap-2">
                        <span className="font-medium">{t('folder')}</span>
                        <div className="flex items-start gap-2">
                           <div className="bg-muted/40 min-w-0 flex-1 rounded-md border px-3 py-2 text-xs break-all">{state.path}</div>
                           <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void editor.choosePath()}>
                              <FolderOpen data-icon="inline-start" />
                              {t('changeFolder')}
                           </Button>
                        </div>
                        <p className="text-muted-foreground text-xs">{t('folderHint')}</p>
                     </div>
                  ) : null}

                  <div className="flex flex-col gap-2">
                     <span className="font-medium">{t('color')}</span>
                     <div className="flex flex-wrap items-center gap-2">
                        <button
                           type="button"
                           disabled={busy}
                           aria-label={t('noColor')}
                           aria-pressed={state.color === null}
                           className={cn(
                              'border-input flex size-7 cursor-pointer items-center justify-center rounded-full border disabled:opacity-50',
                              state.color === null && 'ring-ring ring-2 ring-offset-2'
                           )}
                           onClick={() => editor.edit({ color: null })}
                        >
                           {state.color === null ? <Check className="size-3.5" /> : null}
                        </button>

                        {installColors.map((color) => (
                           <button
                              key={color}
                              type="button"
                              disabled={busy}
                              aria-label={color}
                              aria-pressed={state.color === color}
                              style={{ backgroundColor: color }}
                              className={cn(
                                 'size-7 cursor-pointer rounded-full disabled:opacity-50',
                                 state.color === color && 'ring-ring ring-2 ring-offset-2'
                              )}
                              onClick={() => editor.edit({ color })}
                           />
                        ))}

                        <div className="ml-1 flex items-center gap-1.5">
                           <ColorPicker
                              className={cn(
                                 'size-7 rounded-full p-0',
                                 state.color !== null && !installColors.includes(state.color) && 'ring-ring ring-2 ring-offset-2'
                              )}
                              disabled={busy}
                              label={t('customColor')}
                              inputLabel={t('colorInputLabel')}
                              value={state.color ?? defaultInstallColor}
                              onChange={(color) => editor.edit({ color })}
                           />
                           <span className="text-muted-foreground text-xs">{t('customColor')}</span>
                        </div>
                     </div>
                  </div>

                  {state.status === 'failed' ? (
                     <div>
                        <p>{t('failed')}</p>
                        <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                     </div>
                  ) : null}
               </div>
            )}

            <DialogFooter>
               <Button type="button" variant="outline" size="sm" disabled={busy} onClick={editor.close}>
                  {common('cancel')}
               </Button>
               <Button type="button" size="sm" disabled={!editor.canSave} onClick={() => void editor.save()}>
                  {t('save')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
