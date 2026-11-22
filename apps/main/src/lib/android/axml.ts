import { Result } from 'better-result';

import { uint32 } from '@/lib/android/apk-archive';
import { createProblem, type Problem } from '@/lib/errors';

export const androidNamespaceUri = 'http://schemas.android.com/apk/res/android';

const chunkXml = 0x0003;
const chunkStringPool = 0x0001;
const chunkResourceMap = 0x0180;
const chunkStartNamespace = 0x0100;
const chunkEndNamespace = 0x0101;
const chunkStartElement = 0x0102;
const chunkEndElement = 0x0103;

const headerXml = 0x00080003;
const headerStringPool = 0x001c0001;
const headerResourceMap = 0x00080180;
const headerStartNamespace = 0x00100100;
const headerEndNamespace = 0x00100101;
const headerStartElement = 0x00100102;
const headerEndElement = 0x00100103;

const utf8Flag = 0x100;
const noIndex = 0xffffffff;
const elementAttributeSizes = 0x00140014;

const typeReference = 0x01;
const typeString = 0x03;
const typeFloat = 0x04;
const typeInt = 0x10;
const typeHex = 0x11;
const typeBoolean = 0x12;

type AxmlValue =
   | { type: 'string'; value: string }
   | { type: 'boolean'; value: boolean }
   | { type: 'int'; value: number }
   | { type: 'hex'; value: number }
   | { type: 'reference'; value: number }
   | { type: 'float'; value: number }
   | { type: 'raw'; typeId: number; value: number };

export type AxmlAttribute = {
   namespace: string | null;
   name: string;
   resourceId: number | null;
   value: AxmlValue;
};

export type AxmlEvent =
   | { kind: 'start-namespace'; prefix: string | null; uri: string }
   | { kind: 'end-namespace'; prefix: string | null; uri: string }
   | { kind: 'start-element'; lineNumber: number; namespace: string | null; name: string; attributes: AxmlAttribute[] }
   | { kind: 'end-element'; lineNumber: number; namespace: string | null; name: string };

export function parseAxml(data: Buffer): Result<AxmlEvent[], Problem> {
   return Result.try({
      try: () => readDocument(data),
      catch: (cause) => createProblem('android.axml.unreadable', { cause })
   });
}

export function serializeAxml(events: AxmlEvent[]): Buffer {
   const pool = createStringPool();

   for (const event of events) {
      if (event.kind !== 'start-element') continue;

      for (const attribute of event.attributes) {
         if (attribute.resourceId !== null) pool.internResource(attribute.name, attribute.resourceId);
      }
   }

   const body = Buffer.concat(events.map((event) => writeEvent(event, pool)));
   const stringPool = pool.serialize();
   const resourceMap = writeChunk(headerResourceMap, Buffer.concat(pool.resourceIds.map(uint32)));

   return writeChunk(headerXml, Buffer.concat([stringPool, resourceMap, body]));
}

type AxmlElement = Extract<AxmlEvent, { kind: 'start-element' }>;

export function findElement(events: AxmlEvent[], name: string) {
   return events.filter((event) => event.kind === 'start-element').find((element) => element.name === name);
}

export function getAttribute(element: AxmlElement, name: string) {
   return element.attributes.find((attribute) => attribute.name === name && attribute.namespace === androidNamespaceUri) ?? null;
}

export function setAttribute(element: AxmlElement, attribute: AxmlAttribute) {
   const existing = element.attributes.findIndex((candidate) => candidate.name === attribute.name && candidate.namespace === attribute.namespace);
   if (existing === -1) element.attributes.push(attribute);
   else element.attributes[existing] = attribute;
}

function readDocument(data: Buffer): AxmlEvent[] {
   if (data.length < 8 || (data.readUInt32LE(0) & 0xffff) !== chunkXml) throw new Error('not an axml document');

   const declaredSize = data.readUInt32LE(4);
   const end = Math.min(declaredSize > 0 ? declaredSize : data.length, data.length);

   let offset = 8;
   const poolSize = readChunkSize(data, offset, chunkStringPool, 'string pool');
   const strings = readStringPool(data, offset);
   offset += poolSize;

   const mapSize = readChunkSize(data, offset, chunkResourceMap, 'resource map');
   const resourceIds: number[] = [];
   for (let cursor = offset + 8; cursor + 4 <= offset + mapSize; cursor += 4) {
      resourceIds.push(data.readUInt32LE(cursor));
   }
   offset += mapSize;

   const pooled = (index: number) => {
      const value = strings[index];
      if (value === undefined) throw new Error(`string index ${index} is out of range`);

      return value;
   };
   const optionalPooled = (index: number) => (index === noIndex ? null : pooled(index));

   const events: AxmlEvent[] = [];
   while (offset + 8 <= end) {
      const chunkHeader = data.readUInt32LE(offset);
      const size = data.readUInt32LE(offset + 4);
      if (size < 8 || offset + size > data.length) throw new Error('a manifest chunk runs past the end of the file');

      const body = offset + 8;
      switch (chunkHeader & 0xffff) {
         case chunkStartNamespace:
         case chunkEndNamespace: {
            const namespace = {
               prefix: optionalPooled(data.readUInt32LE(body + 8)),
               uri: pooled(data.readUInt32LE(body + 12))
            };
            events.push(
               (chunkHeader & 0xffff) === chunkStartNamespace ? { kind: 'start-namespace', ...namespace } : { kind: 'end-namespace', ...namespace }
            );
            break;
         }
         case chunkStartElement: {
            if (data.readUInt32LE(body + 16) !== elementAttributeSizes) throw new Error('the manifest uses an unsupported attribute layout');

            const attributeCount = data.readUInt16LE(body + 20);
            const attributes: AxmlAttribute[] = [];
            for (let index = 0; index < attributeCount; index += 1) {
               attributes.push(readAttribute(data, body + 28 + index * 20, pooled, optionalPooled, resourceIds));
            }

            events.push({
               kind: 'start-element',
               lineNumber: data.readUInt32LE(body),
               namespace: optionalPooled(data.readUInt32LE(body + 8)),
               name: pooled(data.readUInt32LE(body + 12)),
               attributes
            });
            break;
         }
         case chunkEndElement:
            events.push({
               kind: 'end-element',
               lineNumber: data.readUInt32LE(body),
               namespace: optionalPooled(data.readUInt32LE(body + 8)),
               name: pooled(data.readUInt32LE(body + 12))
            });
            break;
         default:
            throw new Error(`the manifest has an unsupported chunk 0x${chunkHeader.toString(16)}`);
      }

      offset += size;
   }

   return events;
}

function readAttribute(
   data: Buffer,
   offset: number,
   pooled: (index: number) => string,
   optionalPooled: (index: number) => string | null,
   resourceIds: number[]
): AxmlAttribute {
   const namespace = optionalPooled(data.readUInt32LE(offset));
   const nameIndex = data.readUInt32LE(offset + 4);
   const typeId = data.readUInt32LE(offset + 12) >>> 24;
   const raw = data.readUInt32LE(offset + 16);

   return {
      namespace,
      name: pooled(nameIndex),
      resourceId: resourceIds[nameIndex] ?? null,
      value: readValue(typeId, raw, pooled)
   };
}

function readValue(typeId: number, raw: number, pooled: (index: number) => string): AxmlValue {
   switch (typeId) {
      case typeString:
         return { type: 'string', value: pooled(raw) };
      case typeBoolean:
         return { type: 'boolean', value: raw !== 0 };
      case typeReference:
         return { type: 'reference', value: raw };
      case typeHex:
         return { type: 'hex', value: raw | 0 };
      case typeFloat:
         return { type: 'float', value: uint32(raw).readFloatLE(0) };
      case typeInt:
         return { type: 'int', value: raw | 0 };
      default:
         return { type: 'raw', typeId, value: raw };
   }
}

function readChunkSize(data: Buffer, offset: number, expected: number, label: string) {
   if (offset + 8 > data.length) throw new Error(`the manifest ends before its ${label}`);
   if ((data.readUInt32LE(offset) & 0xffff) !== expected) throw new Error(`expected the ${label} chunk`);

   const size = data.readUInt32LE(offset + 4);
   if (size < 8 || offset + size > data.length) throw new Error(`the ${label} chunk runs past the end of the file`);

   return size;
}

function readStringPool(data: Buffer, offset: number) {
   const count = data.readUInt32LE(offset + 8);
   const flags = data.readUInt32LE(offset + 16);
   const stringsStart = data.readUInt32LE(offset + 20);
   const utf8 = (flags & utf8Flag) !== 0;

   const strings: string[] = [];
   for (let index = 0; index < count; index += 1) {
      const start = offset + stringsStart + data.readUInt32LE(offset + 28 + index * 4);

      if (utf8) {
         const characters = readUtf8Length(data, start);
         const bytes = readUtf8Length(data, characters.next);
         strings.push(data.toString('utf8', bytes.next, bytes.next + bytes.value));
      } else {
         const units = readUtf16Length(data, start);
         strings.push(data.toString('utf16le', units.next, units.next + units.value * 2));
      }
   }

   return strings;
}

function readUtf8Length(data: Buffer, offset: number) {
   const first = data.readUInt8(offset);
   if ((first & 0x80) === 0) return { value: first, next: offset + 1 };

   return { value: ((first & 0x7f) << 8) | data.readUInt8(offset + 1), next: offset + 2 };
}

function readUtf16Length(data: Buffer, offset: number) {
   const first = data.readUInt16LE(offset);
   if ((first & 0x8000) === 0) return { value: first, next: offset + 2 };

   return { value: ((first & 0x7fff) << 16) | data.readUInt16LE(offset + 2), next: offset + 4 };
}

type StringPool = ReturnType<typeof createStringPool>;

function createStringPool() {
   const indices = new Map<string, number>();
   const resourceIndices = new Map<string, number>();
   const strings: string[] = [];
   const resourceIds: number[] = [];

   function intern(value: string) {
      const existing = indices.get(value);
      if (existing !== undefined) return existing;

      indices.set(value, strings.length);
      return strings.push(value) - 1;
   }

   function internResource(name: string, resourceId: number) {
      const key = `${resourceId}:${name}`;
      const existing = resourceIndices.get(key);
      if (existing !== undefined) return existing;
      if (resourceIds.length !== strings.length) throw new Error('resource names must come before other manifest strings');

      resourceIndices.set(key, strings.length);
      resourceIds.push(resourceId);
      return strings.push(name) - 1;
   }

   function serialize() {
      const encoded = strings.map((value) => {
         const bytes = Buffer.from(value, 'utf8');
         return Buffer.concat([writeUtf8Length(value.length), writeUtf8Length(bytes.length), bytes, Buffer.from([0])]);
      });

      const offsets = Buffer.alloc(encoded.length * 4);
      let running = 0;
      encoded.forEach((entry, index) => {
         offsets.writeUInt32LE(running, index * 4);
         running += entry.length;
      });

      const stringsStart = 28 + offsets.length;
      const header = Buffer.concat([uint32(encoded.length), uint32(0), uint32(utf8Flag), uint32(stringsStart), uint32(0)]);

      const body = Buffer.concat([header, offsets, ...encoded]);
      const padding = 4 - ((body.length + 8) % 4);

      return writeChunk(headerStringPool, Buffer.concat([body, Buffer.alloc(padding)]));
   }

   return { intern, internResource, resourceIds, serialize };
}

function writeEvent(event: AxmlEvent, pool: StringPool): Buffer {
   switch (event.kind) {
      case 'start-namespace':
      case 'end-namespace':
         return writeChunk(
            event.kind === 'start-namespace' ? headerStartNamespace : headerEndNamespace,
            Buffer.concat([
               uint32(0),
               uint32(noIndex),
               uint32(event.prefix === null ? noIndex : pool.intern(event.prefix)),
               uint32(pool.intern(event.uri))
            ])
         );
      case 'start-element': {
         const attributes = [...event.attributes].sort((left, right) => (left.resourceId ?? -1) - (right.resourceId ?? -1));

         return writeChunk(
            headerStartElement,
            Buffer.concat([
               uint32(event.lineNumber),
               uint32(noIndex),
               uint32(event.namespace === null ? noIndex : pool.intern(event.namespace)),
               uint32(pool.intern(event.name)),
               uint32(elementAttributeSizes),
               uint16(attributes.length),
               uint16(0),
               uint16(0),
               uint16(0),
               ...attributes.map((attribute) => writeAttribute(attribute, pool))
            ])
         );
      }
      case 'end-element':
         return writeChunk(
            headerEndElement,
            Buffer.concat([
               uint32(event.lineNumber),
               uint32(noIndex),
               uint32(event.namespace === null ? noIndex : pool.intern(event.namespace)),
               uint32(pool.intern(event.name))
            ])
         );
   }
}

function writeAttribute(attribute: AxmlAttribute, pool: StringPool): Buffer {
   const nameIndex = attribute.resourceId === null ? pool.intern(attribute.name) : pool.internResource(attribute.name, attribute.resourceId);
   const { typeId, raw } = encodeValue(attribute.value, pool);

   return Buffer.concat([
      uint32(attribute.namespace === null ? noIndex : pool.intern(attribute.namespace)),
      uint32(nameIndex),
      uint32(attribute.value.type === 'string' ? raw : noIndex),
      uint32((typeId << 24) | 0x08),
      uint32(raw)
   ]);
}

function encodeValue(value: AxmlValue, pool: StringPool) {
   switch (value.type) {
      case 'string':
         return { typeId: typeString, raw: pool.intern(value.value) };
      case 'boolean':
         return { typeId: typeBoolean, raw: value.value ? noIndex : 0 };
      case 'reference':
         return { typeId: typeReference, raw: value.value };
      case 'hex':
         return { typeId: typeHex, raw: value.value };
      case 'int':
         return { typeId: typeInt, raw: value.value };
      case 'float': {
         const bytes = Buffer.alloc(4);
         bytes.writeFloatLE(value.value, 0);
         return { typeId: typeFloat, raw: bytes.readUInt32LE(0) };
      }
      case 'raw':
         return { typeId: value.typeId, raw: value.value };
   }
}

function writeChunk(header: number, body: Buffer) {
   return Buffer.concat([uint32(header), uint32(body.length + 8), body]);
}

function writeUtf8Length(length: number) {
   if (length > 0x7fff) throw new Error('a manifest string is too long to store');
   if (length <= 0x7f) return Buffer.from([length]);

   return Buffer.from([0x80 | (length >> 8), length & 0xff]);
}

function uint16(value: number) {
   const bytes = Buffer.alloc(2);
   bytes.writeUInt16LE(value, 0);

   return bytes;
}
