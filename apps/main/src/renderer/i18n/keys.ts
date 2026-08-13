import type { MessageKeys, Messages, NamespaceKeys, NestedKeyOf, NestedValueOf } from 'use-intl';

export type MessageNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

export type MessageKey<Namespace extends MessageNamespace> = MessageKeys<
   NestedValueOf<Messages, Namespace>,
   NestedKeyOf<NestedValueOf<Messages, Namespace>>
>;

export type MessageKeyMap<Code extends PropertyKey, Namespace extends MessageNamespace> = Record<Code, MessageKey<Namespace>>;
