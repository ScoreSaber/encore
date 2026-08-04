const namedCauses: Record<string, string> = {
   AbortError: 'cancelled',
   TimeoutError: 'timed out'
};

export function causeMessage(cause: unknown) {
   if (!(cause instanceof Error)) return String(cause);
   return namedCauses[cause.name] ?? cause.message;
}

export function causeCode(cause: unknown) {
   if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') return cause.code;
   return causeMessage(cause);
}

export function causeFailure(message: string, cause: unknown) {
   return `${message}: ${causeMessage(cause)}`;
}
