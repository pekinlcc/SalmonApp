// Aurora wallpaper — single variant for v1. The CSS-only gradient stack
// avoids shipping a 4K asset (would inflate the bundle). Other variants
// (Ubuntu茄子紫 / Deep / Salmon) from the design demo are tracked in
// docs/phase3-compositor/ for the eventual Wayland session.

export function Wallpaper() {
  return (
    <div className="dt-wallpaper dt-wp-aurora" aria-hidden>
      <div className="dt-wp-grid" />
    </div>
  );
}
