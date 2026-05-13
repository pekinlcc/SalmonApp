/**
 * v1.1.2 — inline app icon (origami salmon). Replaces the per-view emoji
 * (✦ 👥 📋) inside `.left-head .logo` slots and the `S` placeholder in
 * chat AI avatars. Same artwork as `src-tauri/icons/icon.svg` so the
 * in-app identity matches the Dock / Finder icon.
 *
 * The SVG carries its own cream rounded-square background (rx=224 on
 * the 1024 viewBox), so consumers can place this directly into the
 * existing `.logo` / `.avatar.ai` containers and the CSS salmon
 * gradient previously painted behind the emoji becomes invisible
 * (entirely covered by the SVG's own background rect).
 *
 * Drop-shadow filter from the master icon is omitted — at 24-28px it's
 * not perceivable and adds rendering cost on every paint.
 */
export function SalmonLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="salmon-logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF7F2" />
          <stop offset="1" stopColor="#FFEAE0" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="224" fill="url(#salmon-logo-bg)" />
      <polygon points="160,512 480,256 640,512" fill="#FFA68A" />
      <polygon points="160,512 480,768 640,512" fill="#FA8072" />
      <polygon points="640,512 480,256 800,400" fill="#E5685A" />
      <polygon points="640,512 480,768 800,624" fill="#B7493D" />
      <polygon points="800,400 800,624 960,272" fill="#B7493D" />
      <polygon points="800,400 800,624 960,752" fill="#E5685A" />
      <g stroke="#FFF1ED" strokeWidth={3} opacity={0.55} fill="none" strokeLinejoin="round">
        <path d="M160 512 L 640 512" />
        <path d="M480 256 L 480 768" />
        <path d="M640 512 L 800 400" />
        <path d="M640 512 L 800 624" />
      </g>
      <circle cx={352} cy={476} r={34} fill="#1B1F23" />
      <circle cx={342} cy={466} r={11} fill="#FFFFFF" />
    </svg>
  );
}
