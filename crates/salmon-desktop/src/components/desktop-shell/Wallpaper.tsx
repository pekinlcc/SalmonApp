// Wallpaper — GNOME-style built-in variants plus optional user image.
// CSS lives in desktop.css so the shell can share motion / contrast tokens.

export type WallpaperVariant = "horizon" | "aurora" | "ubuntu" | "deep" | "salmon";
export type WallpaperFit = "cover" | "contain" | "fill" | "center";

export const WALLPAPER_VARIANTS: { id: WallpaperVariant; label: string }[] = [
  { id: "horizon", label: "Horizon" },
  { id: "aurora", label: "Aurora" },
  { id: "ubuntu", label: "Ubuntu" },
  { id: "deep", label: "Deep" },
  { id: "salmon", label: "Salmon" },
];

interface Props {
  variant: WallpaperVariant;
  imageSrc?: string | null;
  fit?: WallpaperFit;
}

export function Wallpaper({ variant, imageSrc, fit = "cover" }: Props) {
  return (
    <div className="wallpaper">
      {imageSrc ? (
        <div className={`wallpaper-fill wp-image wp-fit-${fit}`} style={{ backgroundImage: `url("${imageSrc}")` }} />
      ) : (
        <div className={`wallpaper-fill wp-${variant}`} />
      )}
      <div className="wp-grid" />
      <div className="wp-film" />
    </div>
  );
}
