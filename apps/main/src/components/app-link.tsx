import type { ComponentProps } from 'react';

import { createLink, useRouter } from '@tanstack/react-router';

function AppAnchor({ onClick, disabled, ...props }: ComponentProps<'a'> & { disabled?: boolean }) {
   const router = useRouter();

   return (
      <a
         {...props}
         onClick={(event) => {
            onClick?.(event);
            if (disabled || event.defaultPrevented || event.button !== 0) return;
            if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) return;

            const target = event.currentTarget.getAttribute('target');
            if (target && target !== '_self') return;

            const rawHref = event.currentTarget.getAttribute('href');
            if (!rawHref) return;

            const hashPrefix = `${window.location.pathname}${window.location.search}#`;
            const href = window.location.protocol === 'file:' && rawHref.startsWith(hashPrefix) ? rawHref.slice(hashPrefix.length) : rawHref;
            event.preventDefault();
            void router.navigate({ href });
         }}
      />
   );
}

export const AppLink = createLink(AppAnchor);
