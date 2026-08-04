import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { RemoteImage } from '@/components/ui/remote-image';
import { cn } from '@/components/utils';

// raw HTML stays disabled
const markdownStyles = [
   'min-w-0 space-y-3 text-sm break-words',
   '[&_h1]:text-base [&_h1]:font-medium [&_h2]:text-sm [&_h2]:font-medium [&_h3]:text-sm [&_h3]:font-medium',
   '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5',
   '[&_a]:cursor-pointer [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-primary',
   '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
   '[&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
   '[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
   '[&_table]:block [&_table]:w-fit [&_table]:max-w-full [&_table]:overflow-x-auto [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1',
   '[&_th]:border [&_td]:border [&_hr]:border-border'
].join(' ');

type MarkdownContentProps = {
   content: string;
   className?: string;
   // callers own external navigation
   onLinkClick?: (url: string) => void;
};

export function MarkdownContent({ content, className, onLinkClick }: MarkdownContentProps) {
   const components: Components = {
      a: ({ href, children }) =>
         href === undefined || href === '' ? (
            <span>{children}</span>
         ) : (
            <CopyPathContextMenu pathType="url" value={href}>
               <a
                  href={href}
                  onClick={(event) => {
                     event.preventDefault();
                     onLinkClick?.(href);
                  }}
               >
                  {children}
               </a>
            </CopyPathContextMenu>
         ),
      // third-party images never receive a referrer
      img: ({ src, alt }) =>
         src === undefined || src === '' ? null : (
            <RemoteImage
               src={src}
               alt={alt ?? ''}
               loading="lazy"
               decoding="async"
               referrerPolicy="no-referrer"
               className="max-h-96 max-w-full rounded-md border"
            />
         )
   };

   return (
      <div className={cn(markdownStyles, className)}>
         <Markdown remarkPlugins={[remarkGfm]} urlTransform={httpsUrlOnly} components={components}>
            {content}
         </Markdown>
      </div>
   );
}

// never resolve non-HTTPS URLs against the app origin
function httpsUrlOnly(value: string) {
   const parsed = URL.parse(value);

   return parsed?.protocol === 'https:' ? parsed.toString() : '';
}
