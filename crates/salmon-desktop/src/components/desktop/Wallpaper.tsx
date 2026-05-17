// Aurora / Ubuntu / Deep / Salmon — 4 wallpaper variants from the design
// demo. CSS-only gradient stacks (no 4K assets) so the bundle stays small.
// User choice persists via localStorage; Phase 3 will move to the
// per-user systemd setting.
export type WallpaperVariant = "aurora" | "ubuntu" | "deep" | "salmon";

export const WALLPAPER_VARIANTS: ReadonlyArray<{ id: WallpaperVariant; label: string }> = [
  { id: "aurora", label: "Aurora" },
  { id: "ubuntu", label: "Ubuntu" },
  { id: "deep",   label: "Deep" },
  { id: "salmon", label: "Salmon" },
];

interface Props {
  variant: WallpaperVariant;
}

export function Wallpaper({ variant }: Props) {
  return (
    <div className={`dt-wallpaper dt-wp-${variant}`} aria-hidden>
      <div className="dt-wp-grid" />
    </div>
  );
}
