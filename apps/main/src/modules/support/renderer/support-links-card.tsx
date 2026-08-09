import { ExternalLink, Heart } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { Button } from '@/components/ui/button';

import { quickLinkSections, supportLinkUrls } from '@/modules/support/contract';
import type { Support } from '@/modules/support/renderer/use-support';

export function SupportLinksCard({ support }: { support: Support }) {
   const t = useTranslations('home.links');

   return (
      <section className="mt-6 flex min-w-0 flex-col gap-4 border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
         <h2 className="text-base font-semibold tracking-tight">{t('title')}</h2>
         <div className="flex flex-col gap-4">
            {quickLinkSections.map((section) => (
               <section key={section.id} className="flex flex-col gap-2" aria-labelledby={`quick-links-${section.id}`}>
                  <h3 id={`quick-links-${section.id}`} className="text-muted-foreground text-xs font-medium">
                     {t(`sections.${section.id}`)}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                     {section.links.map((id) => (
                        <CopyPathContextMenu key={id} pathType="url" value={supportLinkUrls[id]}>
                           <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={() => void support.openLink(id)}>
                              {id === 'support-encore' ? (
                                 <Heart className="fill-pink-300 text-pink-400" data-icon="inline-start" />
                              ) : (
                                 <ExternalLink data-icon="inline-start" />
                              )}
                              {t(id)}
                           </Button>
                        </CopyPathContextMenu>
                     ))}
                  </div>
               </section>
            ))}
         </div>
      </section>
   );
}
