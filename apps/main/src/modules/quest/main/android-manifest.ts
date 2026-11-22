import { Result } from 'better-result';

import { androidNamespaceUri, findElement, getAttribute, setAttribute, type AxmlAttribute, type AxmlEvent } from '@/lib/android/axml';
import { createProblem } from '@/lib/errors';

const resourceIds = {
   name: 0x01010003,
   value: 0x01010024,
   debuggable: 0x0101000f,
   hardwareAccelerated: 0x010102d3,
   extractNativeLibs: 0x010104ea,
   requestLegacyExternalStorage: 0x01010603
};

const moddingPermissions = [
   'android.permission.MANAGE_EXTERNAL_STORAGE',
   'android.permission.WRITE_EXTERNAL_STORAGE',
   'android.permission.READ_EXTERNAL_STORAGE'
];

const supportedDevicesMetadata = 'com.oculus.supportedDevices';
const supportedDevices = ['quest', 'quest2', 'questpro', 'quest3', 'quest3s'];
const legacySupportedDevices = ['quest', 'quest2'];

export function readManifestVersionName(events: AxmlEvent[]) {
   const manifest = findElement(events, 'manifest');
   const version = manifest ? getAttribute(manifest, 'versionName') : null;

   return version?.value.type === 'string' ? version.value.value : null;
}

export function applyModdingManifestPatch(events: AxmlEvent[], options: { legacyDevice: boolean }) {
   const patched = events.map((event) => (event.kind === 'start-element' ? { ...event, attributes: [...event.attributes] } : event));

   const application = findElement(patched, 'application');
   if (!application) return Result.err(createProblem('quest.patch.manifest-invalid'));

   setAttribute(application, booleanAttribute('debuggable', resourceIds.debuggable, true));
   setAttribute(application, booleanAttribute('hardwareAccelerated', resourceIds.hardwareAccelerated, true));
   setAttribute(application, booleanAttribute('requestLegacyExternalStorage', resourceIds.requestLegacyExternalStorage, true));
   setAttribute(application, booleanAttribute('extractNativeLibs', resourceIds.extractNativeLibs, true));

   const withMetadata = setSupportedDevices(patched, options.legacyDevice);
   const existing = readPermissions(withMetadata);

   return Result.ok(
      insertBeforeManifestEnd(
         withMetadata,
         moddingPermissions.filter((permission) => !existing.includes(permission)).flatMap((permission) => permissionElement(permission))
      )
   );
}

function readPermissions(events: AxmlEvent[]) {
   return events.flatMap((event) => {
      if (event.kind !== 'start-element' || event.name !== 'uses-permission') return [];

      const name = getAttribute(event, 'name');
      return name?.value.type === 'string' ? [name.value.value] : [];
   });
}

function permissionElement(permission: string): AxmlEvent[] {
   return [
      {
         kind: 'start-element',
         lineNumber: 0,
         namespace: null,
         name: 'uses-permission',
         attributes: [stringAttribute('name', resourceIds.name, permission)]
      },
      { kind: 'end-element', lineNumber: 0, namespace: null, name: 'uses-permission' }
   ];
}

function setSupportedDevices(events: AxmlEvent[], legacyDevice: boolean) {
   const devices = legacyDevice ? legacySupportedDevices : supportedDevices;
   const existing = events
      .filter((event) => event.kind === 'start-element')
      .find((element) => {
         const name = getAttribute(element, 'name');
         return element.name === 'meta-data' && name?.value.type === 'string' && name.value.value === supportedDevicesMetadata;
      });

   if (existing) {
      const listed = getAttribute(existing, 'value');
      const current = !legacyDevice && listed?.value.type === 'string' ? listed.value.value.split('|') : [];

      setAttribute(existing, stringAttribute('value', resourceIds.value, mergeDevices(current, devices)));
      return events;
   }

   const metadata: AxmlEvent[] = [
      {
         kind: 'start-element',
         lineNumber: 0,
         namespace: null,
         name: 'meta-data',
         attributes: [
            stringAttribute('name', resourceIds.name, supportedDevicesMetadata),
            stringAttribute('value', resourceIds.value, mergeDevices([], devices))
         ]
      },
      { kind: 'end-element', lineNumber: 0, namespace: null, name: 'meta-data' }
   ];

   const applicationEnd = events.findIndex((event) => event.kind === 'end-element' && event.name === 'application');
   if (applicationEnd === -1) return [...events, ...metadata];

   return [...events.slice(0, applicationEnd), ...metadata, ...events.slice(applicationEnd)];
}

function mergeDevices(current: string[], supported: string[]) {
   return [...new Set([...current, ...supported].map((device) => device.trim()).filter((device) => device.length > 0))].join('|');
}

function insertBeforeManifestEnd(events: AxmlEvent[], inserted: AxmlEvent[]) {
   if (inserted.length === 0) return events;

   const manifestEnd = events.findIndex((event) => event.kind === 'end-element' && event.name === 'manifest');
   if (manifestEnd === -1) return [...events, ...inserted];

   return [...events.slice(0, manifestEnd), ...inserted, ...events.slice(manifestEnd)];
}

function stringAttribute(name: string, resourceId: number, value: string): AxmlAttribute {
   return { namespace: androidNamespaceUri, name, resourceId, value: { type: 'string', value } };
}

function booleanAttribute(name: string, resourceId: number, value: boolean): AxmlAttribute {
   return { namespace: androidNamespaceUri, name, resourceId, value: { type: 'boolean', value } };
}
