import encoreLogo from "../../../../assets/logo.svg";

export function DocsBrand() {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <img className="shrink-0" src={encoreLogo.src} width={24} height={24} alt="" />
      <span className="font-medium [font-family:var(--font-pixel),ui-monospace,monospace]">
        Encore
      </span>
      <span className="text-[0.82em] text-fd-muted-foreground">Docs</span>
    </span>
  );
}
