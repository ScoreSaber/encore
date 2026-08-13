import encoreLogoUrl from "../../../../assets/logo.svg?url";

export function DocsBrand() {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <img className="shrink-0" src={encoreLogoUrl} width={24} height={24} alt="" />
      <span className="[font-family:var(--font-pixel),ui-monospace,monospace] font-medium">
        Encore
      </span>
      <span className="text-fd-muted-foreground text-[0.82em]">Docs</span>
    </span>
  );
}
