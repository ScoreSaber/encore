import { cn } from '@/components/utils';

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
   return (
      <div className="min-h-0 flex-1 overflow-y-auto">
         <div className={cn('mx-auto flex w-full max-w-7xl flex-col px-8 py-8', className)}>{children}</div>
      </div>
   );
}
