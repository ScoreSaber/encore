import { z } from 'zod';

const namedCauses = new Map([
   ['AbortError', 'cancelled'],
   ['TimeoutError', 'timed out']
]);
const codedCauseSchema = z.object({ code: z.union([z.string(), z.number()]) });

export function causeMessage(cause: unknown) {
   if (!(cause instanceof Error)) return String(cause);
   return namedCauses.get(cause.name) ?? cause.message;
}

export function causeCode(cause: unknown) {
   const coded = codedCauseSchema.safeParse(cause);
   if (coded.success) return String(coded.data.code);
   return causeMessage(cause);
}

export function causeFailure(message: string, cause: unknown) {
   return `${message}: ${causeMessage(cause)}`;
}
