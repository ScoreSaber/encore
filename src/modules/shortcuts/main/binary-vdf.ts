// Steam shortcut files use this binary VDF tree and must round-trip without changing their shape
export type BinaryVdfValue = string | number | BinaryVdfMap;
export type BinaryVdfMap = Map<string, BinaryVdfValue>;

const mapType = 0x00;
const stringType = 0x01;
const int32Type = 0x02;
const endOfMap = 0x08;

export function parseBinaryVdf(buffer: Buffer): BinaryVdfMap {
   const reader = { buffer, offset: 0 };
   const root = readMap(reader);

   if (reader.offset < buffer.length) throw new Error('unexpected trailing binary VDF data');

   return root;
}

export function serializeBinaryVdf(map: BinaryVdfMap) {
   return Buffer.concat([...writeMapEntries(map), Buffer.from([endOfMap])]);
}

export function vdfMap(value: BinaryVdfValue | undefined) {
   return value instanceof Map ? value : null;
}

export function vdfText(value: BinaryVdfValue | undefined) {
   return typeof value === 'string' ? value : null;
}

function readMap(reader: { buffer: Buffer; offset: number }): BinaryVdfMap {
   const map: BinaryVdfMap = new Map();

   for (;;) {
      if (reader.offset >= reader.buffer.length) throw new Error('unterminated binary VDF map');

      const type = reader.buffer[reader.offset];
      reader.offset += 1;
      if (type === endOfMap) return map;

      const key = readString(reader);

      if (type === mapType) {
         map.set(key, readMap(reader));
         continue;
      }

      if (type === stringType) {
         map.set(key, readString(reader));
         continue;
      }

      if (type === int32Type) {
         if (reader.offset + 4 > reader.buffer.length) throw new Error('truncated binary VDF number');

         map.set(key, reader.buffer.readInt32LE(reader.offset));
         reader.offset += 4;
         continue;
      }

      throw new Error(`unsupported binary VDF type ${type ?? 'end of file'}`);
   }
}

function readString(reader: { buffer: Buffer; offset: number }) {
   const end = reader.buffer.indexOf(0, reader.offset);
   if (end < 0) throw new Error('unterminated binary VDF string');

   const value = reader.buffer.toString('utf8', reader.offset, end);
   reader.offset = end + 1;

   return value;
}

function writeMapEntries(map: BinaryVdfMap) {
   const chunks: Buffer[] = [];

   for (const [key, value] of map) {
      if (value instanceof Map) {
         chunks.push(Buffer.from([mapType]), writeString(key), ...writeMapEntries(value), Buffer.from([endOfMap]));
         continue;
      }

      if (typeof value === 'number') {
         const number = Buffer.alloc(4);
         number.writeInt32LE(value);
         chunks.push(Buffer.from([int32Type]), writeString(key), number);
         continue;
      }

      chunks.push(Buffer.from([stringType]), writeString(key), writeString(value));
   }

   return chunks;
}

function writeString(value: string) {
   return Buffer.concat([Buffer.from(value, 'utf8'), Buffer.from([0])]);
}
