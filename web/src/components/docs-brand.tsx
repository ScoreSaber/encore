import Image from "next/image";

export function DocsBrand() {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Image className="shrink-0" src="/encore-logo.svg" width={24} height={24} alt="" priority />
      <span className="font-medium [font-family:var(--font-pixel),ui-monospace,monospace]">
        Encore
      </span>
      <span className="text-[0.82em] text-fd-muted-foreground">Docs</span>
    </span>
  );
}
