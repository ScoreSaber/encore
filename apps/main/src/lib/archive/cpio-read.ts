const headerBytes = 76;
const fileTypeMask = 0o170000;
const regularFile = 0o100000;

export async function* readCpioFiles(source: AsyncIterable<Uint8Array>) {
   const chunks = source[Symbol.asyncIterator]();
   let buffered: Uint8Array = new Uint8Array(0);

   async function take(length: number, keep: boolean) {
      const parts: Uint8Array[] = [];
      for (let remaining = length; remaining > 0;) {
         if (buffered.length === 0) {
            const next = await chunks.next();
            if (next.done) throw new Error('unexpected end of cpio archive');
            buffered = next.value;
         }
         const part = buffered.subarray(0, remaining);
         buffered = buffered.subarray(part.length);
         remaining -= part.length;
         if (keep) parts.push(part);
      }
      return Buffer.concat(parts);
   }

   for (;;) {
      const header = (await take(headerBytes, true)).toString('latin1');
      if (!header.startsWith('070707')) throw new Error('not a cpio archive');

      const octal = (start: number, end: number) => Number.parseInt(header.slice(start, end), 8);
      const nameBytes = octal(59, 65);
      const name = (await take(nameBytes, true)).toString('utf8', 0, nameBytes - 1).replace(/^\.\//, '');
      if (name === 'TRAILER!!!') return;

      let unread = octal(65, 76);
      if ((octal(18, 24) & fileTypeMask) === regularFile) {
         yield {
            name,
            read: () => {
               const size = unread;
               unread = 0;
               return take(size, true);
            }
         };
      }
      await take(unread, false);
   }
}
