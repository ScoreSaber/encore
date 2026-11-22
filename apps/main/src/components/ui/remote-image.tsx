import { useState, type ComponentProps } from 'react';

export function RemoteImage({ onError, src, ...props }: ComponentProps<'img'>) {
   const [failedSrc, setFailedSrc] = useState<string | Blob | undefined>(undefined);
   const hidden = src !== undefined && failedSrc === src;

   return (
      <img
         loading="lazy"
         decoding="async"
         referrerPolicy="no-referrer"
         {...props}
         src={src}
         hidden={hidden || props.hidden}
         onError={(event) => {
            onError?.(event);
            setFailedSrc(src);
         }}
      />
   );
}
