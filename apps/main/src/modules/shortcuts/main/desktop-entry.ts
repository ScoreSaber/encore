export function desktopExecArg(value: string) {
   return `"${value.replaceAll(/["`$\\]/g, '\\$&')}"`.replaceAll('\\', '\\\\').replaceAll('%', '%%');
}
