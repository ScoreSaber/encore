import { createTranslator, type MessageKeys, type NestedKeyOf } from 'use-intl/core';

import { defaultLocale } from '@/renderer/i18n/config';
import { messagesByLocale, type Messages } from '@/renderer/i18n/messages';

export const translate = createTranslator({ locale: defaultLocale, messages: messagesByLocale[defaultLocale] });

export const translateProblem = createTranslator({ locale: defaultLocale, messages: messagesByLocale[defaultLocale], namespace: 'problems' });

export type ProblemCode = MessageKeys<Messages['problems'], NestedKeyOf<Messages['problems']>>;
