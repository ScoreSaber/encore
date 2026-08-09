import { useFormatters } from '@/renderer/i18n/formatters';

export function DateCell({ value }: { value: string }) {
   const format = useFormatters();
   const at = Date.parse(value);

   if (!(at > 0)) return null;

   return <span aria-label={format.dateTime(value)}>{format.date(value)}</span>;
}
