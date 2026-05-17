// Wallpaper — four GNOME-style gradient variants. CSS lives in desktop.css.

export type WallpaperVariant = "aurora" | "ubuntu" | "deep" | "salmon";

export const WALLPAPER_VARIANTS: { id: WallpaperVariant; label: string }[] = [
  { id: "aurora", label: "Aurora" },
  { id: "ubuntu", label: "Ubuntu" },
  { id: "deep", label: "Deep" },
  { id: "salmon", label: "Salmon" },
];

interface Props {
  variant: WallpaperVariant;
}

export function Wallpaper({ variant }: Props) {
  return (
    <div className="wallpaper">
      <div className={`wallpaper-fill wp-${variant}`} />
      <div className="wp-grid" />
    </div>
  );
}
