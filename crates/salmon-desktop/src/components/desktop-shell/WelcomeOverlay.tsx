// First-run welcome — the moment-zero surface a new user sees the very
// first time they sign into a SalmonApp Desktop session. Pure intro:
// big Salmon orb, brand line, four discoverability hints for the
// interactions a fresh user has the hardest time finding (Super for
// the launcher, Activities for the overview, the dock AI tile for
// Brief, right-click on the desktop for appearance).
//
// Gated by a single localStorage key. The appearance panel can clear
// it ("再看一次欢迎") if the user wants to re-run the intro — that
// path lives in DesktopView, this component is purely presentational.

import { useEffect, useRef } from "react";
import { Icons } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

const HINTS: { glyph: string; title: string; body: string; kbd?: string }[] = [
  {
    glyph: "✦",
    title: "Salmon Brief",
    body: "Dock 左侧的 AI 磁贴会持续整理你的邮件、日历和待办。轻点即可展开。",
  },
  {
    glyph: "□",
    title: "应用与搜索",
    body: "按 Super 键打开 Launcher，输入应用名直接启动,或搜索文件与 AI 操作。",
    kbd: "Super",
  },
  {
    glyph: "▦",
    title: "Activities 总览",
    body: "顶栏左上角 Activities,或 Super+A,可以一眼看到所有窗口与工作区。",
    kbd: "Super + A",
  },
  {
    glyph: "✎",
    title: "自定义桌面",
    body: "桌面空白处右键,选 “桌面外观” 切换壁纸、主题、强调色和字体。",
  },
];

export function WelcomeOverlay({ open, onClose }: Props) {
  const dismissRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => dismissRef.current?.focus(), 240);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="welcome-overlay" role="dialog" aria-label="Welcome to Salmon Desktop">
      <div className="welcome-scrim" />
      <div className="welcome-card">
        <div className="welcome-orb">
          <div className="welcome-orb-core">
            <Icons.Salmon />
          </div>
          <div className="welcome-orb-ring" />
          <div className="welcome-orb-ring welcome-orb-ring--slow" />
        </div>

        <h1 className="welcome-title">
          欢迎来到 <em>Salmon Desktop</em>
        </h1>
        <p className="welcome-sub">
          一个把邮件、日历、待办,和 AI 助手编织在一起的 Linux 桌面。
        </p>

        <div className="welcome-hints">
          {HINTS.map((h, i) => (
            <div key={i} className="welcome-hint" style={{ animationDelay: `${0.12 + i * 0.08}s` }}>
              <span className="welcome-hint-glyph">{h.glyph}</span>
              <div className="welcome-hint-text">
                <div className="welcome-hint-title">
                  <span>{h.title}</span>
                  {h.kbd && <span className="kbd">{h.kbd}</span>}
                </div>
                <div className="welcome-hint-body">{h.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="welcome-actions">
          <button ref={dismissRef} type="button" className="welcome-cta" onClick={onClose}>
            开始使用
          </button>
          <div className="welcome-fineprint">
            随时可以在 桌面 → 右键 → 桌面外观 重新看一次
          </div>
        </div>
      </div>
    </div>
  );
}
