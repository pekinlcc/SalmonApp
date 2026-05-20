// Ongoing discoverability — a small pill in the top-right area that
// rotates through useful interactions every ~8 seconds. The Welcome
// overlay surfaces the four most important interactions exactly once;
// this is the gentler, longer-lived sibling that keeps reminding the
// user about the other interactions without being a wall of text.
//
// State:
//   - localStorage flag (salmon.desktop.tips-dismissed) — when the
//     user clicks × the ticker never reappears.
//   - Slides in 1200ms after mount so it doesn't fight the welcome
//     overlay or shell-boot animation for attention.

import { useEffect, useRef, useState } from "react";
import { Icons } from "./Icons";

const STORAGE_KEY = "salmon.desktop.tips-dismissed";

interface Tip {
  text: string;
  keys?: string[];
}

const TIPS: Tip[] = [
  { text: "按 这些键 看所有窗口和工作区",  keys: ["Super", "A"] },
  { text: "按 这些键 查看完整快捷键速查",  keys: ["Ctrl", "/"] },
  { text: "桌面空白处右键 — 切换壁纸、主题、强调色与字体" },
  { text: "AI 磁贴 hover 预览 Brief · 点击展开决策项" },
  { text: "按 这些键 直接跳到对应工作区",  keys: ["Super", "1", "·", "2", "·", "3", "·", "4"] },
  { text: "按 这些键 立刻锁屏",            keys: ["Super", "L"] },
  { text: "按 这些键 打开终端",            keys: ["Super", "T"] },
  { text: "顶栏左上角 Activities · 工作区 + 窗口卡片一览" },
  { text: "Alt+Tab 现在带应用色卡片,不是单调文字" },
];

function loadDismissed(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export function TipsTicker() {
  const [dismissed, setDismissed] = useState<boolean>(() => loadDismissed());
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  const mountTimer = useRef<number | null>(null);

  // Delay first appearance so it doesn't race the welcome overlay.
  useEffect(() => {
    if (dismissed) return;
    mountTimer.current = window.setTimeout(() => setMounted(true), 1200);
    return () => {
      if (mountTimer.current != null) window.clearTimeout(mountTimer.current);
    };
  }, [dismissed]);

  // Rotate tips while the ticker is visible.
  useEffect(() => {
    if (dismissed || !mounted) return;
    const t = window.setInterval(() => {
      setIdx((i) => (i + 1) % TIPS.length);
    }, 8200);
    return () => window.clearInterval(t);
  }, [dismissed, mounted]);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  if (dismissed || !mounted) return null;

  const cur = TIPS[idx];

  // Split the localized text by "这些键" so the keys render inline
  // between the natural-language clauses without needing per-language
  // formatting strings.
  const segments = cur.keys
    ? cur.text.split("这些键")
    : [cur.text];

  return (
    <div className="tips-ticker" role="status" aria-live="polite">
      <span className="tips-ticker-glyph">
        <Icons.Sparkle />
      </span>
      <span className="tips-ticker-text" key={idx}>
        {segments[0]}
        {cur.keys && segments[1] !== undefined && (
          <>
            <span className="tips-ticker-keys">
              {cur.keys.map((k, i) => (
                <span key={i} className="kbd">{k}</span>
              ))}
            </span>
            {segments[1]}
          </>
        )}
      </span>
      <button
        type="button"
        className="tips-ticker-close"
        onClick={dismiss}
        aria-label="不再显示提示"
        title="不再显示"
      >
        ×
      </button>
    </div>
  );
}
