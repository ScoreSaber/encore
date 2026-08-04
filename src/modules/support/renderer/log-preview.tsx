import { cn } from '@/components/utils';

export function LogPreview({ className, text }: { className?: string; text: string }) {
   return (
      <pre
         className={cn(
            'min-w-0 max-w-full overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]',
            className
         )}
      >
         {text}
      </pre>
   );
}
