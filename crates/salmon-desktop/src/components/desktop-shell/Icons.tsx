// Icon set ported from the Anthropic Claude Design bundle's icons.jsx.
// Stroke-based line icons that inherit color via currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const stroke = (props: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

const filled = (props: P) => ({
  viewBox: "0 0 24 24",
  fill: "currentColor",
  ...props,
});

export const Icons = {
  Mail: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
  Calendar: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  ),
  CheckSquare: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  ),
  Doc: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  Clipboard: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4.5A2.5 2.5 0 0 1 11.5 2h1A2.5 2.5 0 0 1 15 4.5V6H9zM9 11h6M9 15h5" />
    </svg>
  ),
  Video: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m22 8-6 4 6 4z" />
    </svg>
  ),
  Camera: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  ),
  Crop: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M6 3v13a2 2 0 0 0 2 2h13" />
      <path d="M3 6h13a2 2 0 0 1 2 2v13" />
      <path d="M10 10h4v4h-4z" />
    </svg>
  ),
  Sparkle: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  ),
  Arrow: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ),
  ChevronDown: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  ChevronUp: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  ),
  More: (p: P) => (
    <svg {...filled(p)}>
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </svg>
  ),
  Close: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <path d="m18 6-12 12M6 6l12 12" />
    </svg>
  ),
  Pin: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M12 17v5M5 9h14l-2 7H7zM7 3h10v6H7z" />
    </svg>
  ),
  Search: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  Wifi: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M3 9a14 14 0 0 1 18 0M6 12.5a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
    </svg>
  ),
  Battery: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="2" y="8" width="18" height="8" rx="2" />
      <path d="M22 11v2" />
      <rect x="4" y="10" width="10" height="4" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  Volume: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </svg>
  ),
  Bell: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  ),
  Sun: (p: P) => (
    <svg {...stroke(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Monitor: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  Bluetooth: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M7 7l10 10-5 4V3l5 4L7 17" />
    </svg>
  ),
  Printer: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M6 9V4h12v5" />
      <rect x="5" y="14" width="14" height="7" rx="1.5" />
      <path d="M7 17h10M6 18H4a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
      <circle cx="18" cy="12" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  ),
  Accessibility: (p: P) => (
    <svg {...stroke(p)}>
      <circle cx="12" cy="4" r="1.5" />
      <path d="M5 8h14M12 8v6M8 21l4-7 4 7M8 12h8" />
    </svg>
  ),
  Shield: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  ),
  Info: (p: P) => (
    <svg {...stroke(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7.5v.01" />
    </svg>
  ),
  Send: (p: P) => (
    <svg {...stroke({ ...p, strokeWidth: 2 })}>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </svg>
  ),
  Grid: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  Folder: (p: P) => (
    <svg {...stroke(p)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  Browser: (p: P) => (
    <svg {...stroke(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  ),
  Terminal: (p: P) => (
    <svg {...stroke(p)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7 9 3 3-3 3M13 15h5" />
    </svg>
  ),
  Settings: (p: P) => (
    <svg {...stroke(p)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  Salmon: (p: P) => (
    // Stylized "S" fish silhouette for SalmonApp
    <svg {...stroke(p)}>
      <path d="M3 12c2-4 6-6 10-6 4 0 6 2 7 4l1-1v6l-1-1c-1 2-3 4-7 4-4 0-8-2-10-6z" />
      <circle cx="16" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8 12h3M11 9c0 1.5-1 3 0 6" />
    </svg>
  ),
  AIStar: (p: P) => (
    <svg {...filled(p)}>
      <path d="M12 2c.5 4 2.5 6 6 6.5-3.5.5-5.5 2.5-6 6.5-.5-4-2.5-6-6-6.5 3.5-.5 5.5-2.5 6-6.5z" opacity=".95" />
      <path d="M19 14c.3 2.2 1.4 3.3 3 3.5-1.6.2-2.7 1.3-3 3.5-.3-2.2-1.4-3.3-3-3.5 1.6-.2 2.7-1.3 3-3.5z" />
    </svg>
  ),
};
