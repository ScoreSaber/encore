import { describe, expect, test } from 'vite-plus/test';

import { androidNamespaceUri, findElement, getAttribute, parseAxml, serializeAxml, type AxmlEvent } from '@/lib/android/axml';
import { applyModdingManifestPatch } from '@/modules/quest/main/android-manifest';

const manifest: AxmlEvent[] = [
   { kind: 'start-namespace', prefix: 'android', uri: androidNamespaceUri },
   {
      kind: 'start-element',
      lineNumber: 1,
      namespace: null,
      name: 'manifest',
      attributes: [
         { namespace: androidNamespaceUri, name: 'versionName', resourceId: 0x0101021c, value: { type: 'string', value: '1.37.0_9064817954' } },
         { namespace: null, name: 'package', resourceId: null, value: { type: 'string', value: 'com.beatgames.beatsaber' } }
      ]
   },
   { kind: 'start-element', lineNumber: 2, namespace: null, name: 'application', attributes: [] },
   { kind: 'end-element', lineNumber: 2, namespace: null, name: 'application' },
   { kind: 'end-element', lineNumber: 3, namespace: null, name: 'manifest' },
   { kind: 'end-namespace', prefix: 'android', uri: androidNamespaceUri }
];

describe('android manifest patching', () => {
   test('round trips a patched manifest android accepts and patching twice changes nothing', () => {
      const once = parseAxml(serializeAxml(applyModdingManifestPatch(manifest, { legacyDevice: false }).unwrap())).unwrap();
      const twice = parseAxml(serializeAxml(applyModdingManifestPatch(once, { legacyDevice: false }).unwrap())).unwrap();
      expect(twice).toEqual(once);

      const application = findElement(once, 'application');
      for (const flag of ['debuggable', 'hardwareAccelerated', 'requestLegacyExternalStorage', 'extractNativeLibs']) {
         expect(application && getAttribute(application, flag)?.value).toEqual({ type: 'boolean', value: true });
      }
      const ids = application?.attributes.map((attribute) => attribute.resourceId ?? -1) ?? [];
      expect(ids).toEqual(ids.toSorted((left, right) => left - right));

      const permissions = once.flatMap((event) =>
         event.kind === 'start-element' && event.name === 'uses-permission' ? [getAttribute(event, 'name')?.value] : []
      );
      expect(permissions).toEqual([
         { type: 'string', value: 'android.permission.MANAGE_EXTERNAL_STORAGE' },
         { type: 'string', value: 'android.permission.WRITE_EXTERNAL_STORAGE' },
         { type: 'string', value: 'android.permission.READ_EXTERNAL_STORAGE' }
      ]);

      const metadata = findElement(once, 'meta-data');
      expect(metadata && getAttribute(metadata, 'value')?.value).toEqual({ type: 'string', value: 'quest|quest2|questpro|quest3|quest3s' });
      expect(once.findIndex((event) => event === metadata)).toBeLessThan(
         once.findIndex((event) => event.kind === 'end-element' && event.name === 'application')
      );
   });
});
