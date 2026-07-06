export type VdfValue = string | VdfObject;

export type VdfObject = {
   [key: string]: VdfValue | undefined;
};

export function parseVdf(contents: string): VdfObject {
   const tokens = tokenizeVdf(contents);
   let index = 0;

   function readObject() {
      const object: VdfObject = {};

      while (index < tokens.length && tokens[index] !== '}') {
         const key = readToken('key');
         const value = tokens[index] === '{' ? readNestedObject() : readToken('value');
         object[key] = value;
      }

      return object;
   }

   function readNestedObject() {
      index += 1;
      const object = readObject();

      if (tokens[index] !== '}') {
         throw new Error('unterminated VDF object');
      }

      index += 1;
      return object;
   }

   function readToken(kind: string) {
      const token = tokens[index];
      if (token === undefined || token === '{' || token === '}') {
         throw new Error(`expected VDF ${kind}`);
      }

      index += 1;
      return token;
   }

   const parsed = readObject();
   if (index < tokens.length) {
      throw new Error('unexpected VDF token');
   }

   return parsed;
}

export function vdfObject(value: VdfValue | undefined): VdfObject | null {
   return value && typeof value === 'object' ? value : null;
}

export function vdfString(value: VdfValue | undefined): string | null {
   return typeof value === 'string' ? value : null;
}

function tokenizeVdf(contents: string) {
   const tokens: string[] = [];
   let index = 0;

   while (index < contents.length) {
      const char = contents[index];

      if (!char || /\s/.test(char)) {
         index += 1;
         continue;
      }

      if (char === '/' && contents[index + 1] === '/') {
         index = skipLine(contents, index + 2);
         continue;
      }

      if (char === '{' || char === '}') {
         tokens.push(char);
         index += 1;
         continue;
      }

      if (char === '"') {
         const quoted = readQuotedString(contents, index + 1);
         tokens.push(quoted.value);
         index = quoted.nextIndex;
         continue;
      }

      const bare = readBareToken(contents, index);
      tokens.push(bare.value);
      index = bare.nextIndex;
   }

   return tokens;
}

function readQuotedString(contents: string, startIndex: number) {
   let value = '';
   let index = startIndex;

   while (index < contents.length) {
      const char = contents[index];

      if (char === '"') {
         return {
            value,
            nextIndex: index + 1
         };
      }

      if (char === '\\' && contents[index + 1]) {
         value += contents[index + 1];
         index += 2;
         continue;
      }

      value += char;
      index += 1;
   }

   throw new Error('unterminated VDF string');
}

function readBareToken(contents: string, startIndex: number) {
   let index = startIndex;

   while (index < contents.length) {
      const char = contents[index];
      if (!char || /\s/.test(char) || char === '{' || char === '}') break;
      index += 1;
   }

   return {
      value: contents.slice(startIndex, index),
      nextIndex: index
   };
}

function skipLine(contents: string, startIndex: number) {
   let index = startIndex;

   while (index < contents.length && contents[index] !== '\n') {
      index += 1;
   }

   return index;
}
