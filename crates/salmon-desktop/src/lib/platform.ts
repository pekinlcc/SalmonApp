// Frontend platform detection. We avoid adding @tauri-apps/plugin-os just for
// this — webkit2gtk (Linux) and WKWebView (macOS) both expose distinct
// userAgent strings that are stable enough for "is this Linux?" branching.
//
// Used by the Ubuntu Desktop shell: on Linux we default to desktop mode at
// first launch; on macOS / Windows the toggle exists in Settings but defaults
// off (the desktop metaphor only really makes sense on Linux).

export type Os = "linux" | "mac" | "windows" | "other";

export function detectOs(): Os {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  const plat = (navigator as any).platform || "";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
  if (/Mac|iPhone|iPad|iPod/.test(plat) || /Macintosh/.test(ua)) return "mac";
  if (/Windows|Win32|Win64/.test(plat) || /Windows/.test(ua)) return "windows";
  return "other";
}

export const IS_LINUX = detectOs() === "linux";
