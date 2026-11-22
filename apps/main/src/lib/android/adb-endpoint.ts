import { z } from 'zod';

export const adbEndpointSchema = z
   .string()
   .trim()
   .min(1)
   .max(260)
   .regex(/^(?:\[[A-Fa-f\d:]+\]|[A-Za-z\d](?:[A-Za-z\d.-]*[A-Za-z\d])?)(?::\d{1,5})?$/)
   .transform((endpoint) => (/\]:\d+$|^[^:]+:\d+$/.test(endpoint) ? endpoint : `${endpoint}:5555`))
   .refine((endpoint) => URL.canParse(`http://${endpoint}`))
   .refine((endpoint) => {
      const port = Number(endpoint.slice(endpoint.lastIndexOf(':') + 1));
      return port > 0 && port <= 65_535;
   });
