import type { ComponentProps } from 'react';

export function RemoteImage({ onError, ...props }: ComponentProps<'img'>) {
   return (
      <img
         loading="lazy"
         decoding="async"
         referrerPolicy="no-referrer"
         {...props}
         onError={(event) => {
            onError?.(event);
            event.currentTarget.hidden = true;
         }}
      />
   );
}
