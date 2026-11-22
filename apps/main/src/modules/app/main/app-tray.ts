import { Menu, nativeImage, Tray } from 'electron';

import { translate } from '@/lib/messages';
import trayIcon from '@/modules/app/main/tray-icon.png?inline';

type TrayState = { status: 'hidden' } | { status: 'visible'; tray: Tray } | { status: 'disposed' };

export function createAppTray(actions: { open: () => void; quit: () => void }) {
   let state: TrayState = { status: 'hidden' };

   function show() {
      const tray = new Tray(nativeImage.createFromDataURL(trayIcon));
      tray.setToolTip(translate('app.name'));
      tray.setContextMenu(
         Menu.buildFromTemplate([
            { label: translate('app.tray.open'), click: actions.open },
            { type: 'separator' },
            { label: translate('app.tray.quit'), click: actions.quit }
         ])
      );
      tray.on('click', actions.open);
      state = { status: 'visible', tray };
   }

   function hide() {
      if (state.status !== 'visible') return;

      state.tray.destroy();
      state = { status: 'hidden' };
   }

   return {
      setVisible(visible: boolean) {
         if (state.status === 'disposed') return;
         if (visible && state.status === 'hidden') show();
         if (!visible && state.status === 'visible') hide();
      },
      dispose() {
         hide();
         state = { status: 'disposed' };
      }
   };
}
