import { z } from 'zod';

import { translate, translateProblem, type ProblemCode } from '@/lib/messages';

const codedCauseSchema = z.object({ code: z.union([z.string(), z.number()]) });

export function causeMessage(cause: unknown) {
   if (!(cause instanceof Error)) return String(cause);
   if (cause.name === 'AbortError') return translate('common.cause.cancelled');
   if (cause.name === 'TimeoutError') return translate('common.cause.timedOut');
   return cause.message;
}

export function causeCode(cause: unknown) {
   const coded = codedCauseSchema.safeParse(cause);
   if (coded.success) return String(coded.data.code);
   return causeMessage(cause);
}

export type Problem<Code extends string = string> = {
   code: Code;
   message: string;
   detail?: string;
};

type ProblemValue = string | number | undefined;
type ProblemFields<Fields> = { [Field in keyof Fields]: Field extends 'cause' ? unknown : ProblemValue };

export function createProblem<Code extends ProblemCode>(code: Code): Problem<Code>;
export function createProblem<Code extends ProblemCode, Fields extends ProblemFields<Fields>>(
   code: Code,
   fields: Fields
): Problem<Code> & Omit<Fields, 'cause'>;
export function createProblem(code: ProblemCode, { cause, ...values }: { cause?: unknown } & Record<string, ProblemValue> = {}) {
   const filled = Object.entries(values).filter((entry): entry is [string, string | number] => entry[1] !== undefined);
   const problem: Problem = { ...values, code, message: translateProblem(code, Object.fromEntries(filled)) };
   if (cause !== undefined) problem.detail = causeCode(cause);
   return problem;
}
