import { app, dialog, session } from 'electron';

import { translate } from '@/lib/messages';
import type { QuestBluetoothDevice } from '@/modules/quest/contract';

type ChooserSession =
   | { status: 'idle' }
   | { status: 'choosing'; contentsId: number; choose: (deviceId: string) => void; devices: QuestBluetoothDevice[] };

export function createQuestBluetoothChooser(publish: (devices: QuestBluetoothDevice[]) => void) {
   let chooserSession: ChooserSession = { status: 'idle' };
   let selected: string | null = null;

   function clearSession(contentsId?: number) {
      if (chooserSession.status !== 'choosing') return;
      if (contentsId !== undefined && chooserSession.contentsId !== contentsId) return;
      const previous = chooserSession.choose;
      chooserSession = { status: 'idle' };
      publish([]);
      previous('');
   }

   app.on('web-contents-created', (_event, contents) => {
      contents.on('select-bluetooth-device', (event, found, callback) => {
         event.preventDefault();
         if (chooserSession.status === 'choosing' && chooserSession.contentsId !== contents.id) {
            clearSession();
         }
         const devices = found.slice(0, 50).map((device) => ({ deviceId: device.deviceId, name: device.deviceName || 'Meta Quest' }));
         chooserSession = { status: 'choosing', contentsId: contents.id, choose: callback, devices };
         publish(devices);
      });
      contents.once('destroyed', () => clearSession(contents.id));
      contents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
         if (isMainFrame) clearSession(contents.id);
      });
   });

   if (process.platform !== 'darwin') {
      session.defaultSession.setBluetoothPairingHandler((details, callback) => {
         if (details.pairingKind === 'providePin') {
            callback({ confirmed: false });
            return;
         }
         void dialog
            .showMessageBox({
               type: 'question',
               buttons: [translate('quest.bluetoothPrompt.allow'), translate('common.cancel')],
               defaultId: 1,
               cancelId: 1,
               message: translate('quest.bluetoothPrompt.message'),
               detail: details.pin ? translate('quest.bluetoothPrompt.pin', { pin: details.pin }) : undefined
            })
            .then(
               (result) => callback({ confirmed: result.response === 0 }),
               () => callback({ confirmed: false })
            );
      });
   }

   function select(deviceId: string | null) {
      if (deviceId === null) selected = null;
      if (chooserSession.status !== 'choosing') return;
      if (deviceId !== null && !chooserSession.devices.some((device) => device.deviceId === deviceId)) return;

      const callback = chooserSession.choose;
      chooserSession = { status: 'idle' };
      selected = deviceId;
      publish([]);
      callback(deviceId ?? '');
   }

   return { select, selected: () => selected };
}
