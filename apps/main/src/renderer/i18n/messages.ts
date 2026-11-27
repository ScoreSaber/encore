import en from './en.json';
import zhCN from './zh-CN.json';

export type Messages = typeof en;

export const messagesByLocale = {
   en,
   'zh-CN': zhCN
};
