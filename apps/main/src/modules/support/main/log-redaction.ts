const redactedMarker = '[redacted]';
const redactedUser = '[user]';

// support logs leave the machine, so redact credentials and identifying paths before any preview or export
const rules = [
   { pattern: /\bbearer\s+[\w.\-+/=]{8,}/gi, replace: redactedMarker },
   {
      pattern:
         /\b(api[_-]?key|access[_-]?key|authorization|cookie|passwd|password|pwd|refresh[_-]?token|secret|session|token)\b(\s*[:=]\s*)"?[\w.\-+/=]{6,}"?/gi,
      replace: `$1$2${redactedMarker}`
   },
   { pattern: /([A-Za-z]:\\Users\\)[^\\\r\n"']+/g, replace: `$1${redactedUser}` },
   { pattern: /(\/(?:home|Users)\/)[^/\r\n"':]+/g, replace: `$1${redactedUser}` },
   { pattern: /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/g, replace: `${redactedMarker}@${redactedMarker}` },
   { pattern: /\b7656\d{13}\b/g, replace: redactedMarker },
   { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replace: redactedMarker },
   { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replace: redactedMarker }
];

export function redactSupportText(input: string, options: { homePath?: string | null } = {}) {
   let text = input;

   const homePath = options.homePath?.trim();
   if (homePath) {
      const homePattern = new RegExp(homePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      text = text.replace(homePattern, '~');
   }

   for (const rule of rules) text = text.replace(rule.pattern, rule.replace);

   return text;
}
