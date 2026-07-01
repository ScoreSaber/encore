import type { LucideIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export function ErrorCard({
   icon: Icon,
   title,
   description,
   actions
}: {
   icon: LucideIcon;
   title: string;
   description: string;
   actions?: React.ReactNode;
}) {
   return (
      <Card className="mx-auto mt-12 w-full max-w-lg">
         <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="bg-destructive/10 text-destructive flex size-12 items-center justify-center rounded-lg">
               <Icon />
            </div>
            <div className="flex flex-col gap-2">
               <h2 className="text-lg font-semibold">{title}</h2>
               <p className="text-muted-foreground text-sm">{description}</p>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
         </CardContent>
      </Card>
   );
}
