import { createElement } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'use-intl';
import { expect, test, vi } from 'vite-plus/test';

import type { ReadyBSManagerPlan } from '@/modules/bsmanager/contract';
import { BSManagerPlanBody } from '@/modules/bsmanager/renderer/bsmanager-dialog';
import messages from '@/renderer/i18n/en.json';

vi.mock('@/components/ui/data-table', () => ({ DataTable: () => null }));

const plan: ReadyBSManagerPlan = {
   status: 'ok',
   rootPath: '/BSManager',
   versionsPath: '/BSManager/BSInstances',
   sharedContentPath: '/BSManager/SharedContent',
   currentSharedRootPath: '/Encore/SharedContent',
   prefixPath: '/BSManager/SharedContent/compatdata/pfx',
   existingPrefix: false,
   sharedRootAdopted: false,
   useSymlinks: true,
   customFolders: [],
   versions: []
};

test.each([{ selected: [] }, { selected: ['1.37.0'] }])('only offers shared content when versions are selected: $selected', ({ selected }) => {
   const html = renderToStaticMarkup(
      createElement(IntlProvider, {
         locale: 'en',
         messages,
         children: createElement(BSManagerPlanBody, {
            plan,
            selected,
            shareContent: true,
            copyPrefix: true,
            editable: true,
            onToggle: vi.fn(),
            onOptionChange: vi.fn()
         })
      })
   );
   const checkbox = html.match(/<button[^>]*id="bsmanager-share-content"[^>]*>/)?.[0];
   expect(checkbox).toBeDefined();
   if (selected.length === 0) {
      expect(checkbox).toContain('disabled');
      expect(checkbox).toContain('aria-checked="false"');
   } else {
      expect(checkbox).not.toContain('disabled=""');
      expect(checkbox).toContain('aria-checked="true"');
   }
});
