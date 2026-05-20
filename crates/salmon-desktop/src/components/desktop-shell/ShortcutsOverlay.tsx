// Keyboard shortcuts cheatsheet — the GNOME-style "press Ctrl+/ to
// see everything you can press" overlay. Mirrors what labwc actually
// binds in packaging/labwc-config/rc.xml plus the shell-level
// shortcuts Salmon adds (Activities Super+A, Alt+Tab, etc.).
//
// Single source of truth for shortcut discoverability — easier than
// asking new users to read the labwc XML.

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; items: Shortcut[] };

// Display keys lazily — "Super" and "Ctrl" read clearer than ⌘/⌃ for
// the kind of mixed Mac/Windows users likely to try the project.
const GROUPS: Group[] = [
  {
    title: "AI & 桌面",
    items: [
      { keys: ["Super"], label: "打开 Launcher · 应用 / 文件 / AI 操作搜索" },
      { keys: ["Super", "A"], label: "Activities 总览 · 工作区 + 窗口卡片" },
      { keys: ["Ctrl", "/"], label: "显示 / 关闭这个快捷键速查" },
      { keys: ["Super", "/"], label: "同上 (Super 别名)" },
      { keys: ["Super", "D"], label: "显示桌面 (再按一次恢复)" },
      { keys: ["Super", "R"], label: "刷新 labwc 配置" },
      { keys: ["Super", "Escape"], label: "返回桌面 · 收起浮层" },
    ],
  },
  {
    title: "应用",
    items: [
      { keys: ["Super", "T"], label: "打开终端" },
      { keys: ["Ctrl", "Alt", "T"], label: "打开终端 (跨发行版别名)" },
      { keys: ["Super", "Return"], label: "打开终端" },
      { keys: ["Super", "B"], label: "打开默认浏览器" },
      { keys: ["Super", "F"], label: "打开文件管理器" },
      { keys: ["Super", "L"], label: "锁定会话 · swaylock" },
    ],
  },
  {
    title: "窗口",
    items: [
      { keys: ["Alt", "Tab"], label: "Salmon 窗口切换器" },
      { keys: ["Alt", "Shift", "Tab"], label: "反向切换" },
      { keys: ["Alt", "F4"], label: "关闭当前窗口" },
      { keys: ["Alt", "Space"], label: "labwc 客户端菜单 · 还原/最大化/移动" },
      { keys: ["Super", "Up"], label: "最大化窗口" },
      { keys: ["Super", "Down"], label: "还原 / 最小化" },
      { keys: ["Super", "Left"], label: "贴左半屏" },
      { keys: ["Super", "Right"], label: "贴右半屏" },
      { keys: ["Super", "F11"], label: "切换全屏" },
      { keys: ["Super", "M"], label: "最小化窗口" },
    ],
  },
  {
    title: "工作区",
    items: [
      { keys: ["Super", "1"], label: "切换到工作区 1 · Work" },
      { keys: ["Super", "2"], label: "切换到工作区 2 · Mail" },
      { keys: ["Super", "3"], label: "切换到工作区 3 · Chat" },
      { keys: ["Super", "4"], label: "切换到工作区 4 · Browse" },
      { keys: ["Super", "Shift", "1-4"], label: "把当前窗口送到指定工作区" },
      { keys: ["Super", "Page Up"], label: "前一个工作区" },
      { keys: ["Super", "Page Down"], label: "后一个工作区" },
    ],
  },
  {
    title: "截图 & 输入",
    items: [
      { keys: ["Print"], label: "全屏截图 → ~/Pictures/Screenshots" },
      { keys: ["Shift", "Print"], label: "区域截图 (slurp 框选)" },
      { keys: ["Super", "Space"], label: "切换输入法 (fcitx5 / IBus)" },
    ],
  },
  {
    title: "硬件",
    items: [
      { keys: ["XF86 音量 ↑/↓/Mute"], label: "PipeWire / PulseAudio 音量" },
      { keys: ["XF86 亮度 ↑/↓"], label: "brightnessctl 屏幕亮度" },
      { keys: ["XF86 麦克 Mute"], label: "切换默认输入静音" },
      { keys: ["XF86 媒体 播放/上下一首"], label: "playerctl 媒体键" },
      { keys: ["XF86 Sleep"], label: "挂起会话 · systemctl/loginctl" },
    ],
  },
];

function KeyChip({ k }: { k: string }) {
  return <span className="sc-key">{k}</span>;
}

export function ShortcutsOverlay({ open, onClose }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtnRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <div className="shortcuts-head-text">
            <h2>键盘快捷键</h2>
            <div className="shortcuts-head-sub">
              这是 SalmonApp Desktop 默认绑定的全部快捷键 · 可在
              <code> packaging/labwc-config/rc.xml </code> 自定义
            </div>
          </div>
          <button ref={closeBtnRef} type="button" className="shortcuts-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="shortcuts-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="shortcuts-group">
              <div className="shortcuts-group-title">{g.title}</div>
              <div className="shortcuts-group-items">
                {g.items.map((it, i) => (
                  <div key={i} className="shortcuts-item">
                    <div className="shortcuts-item-keys">
                      {it.keys.map((k, j) => (
                        <span key={j} className="shortcuts-key-wrap">
                          {j > 0 && <span className="shortcuts-plus">+</span>}
                          <KeyChip k={k} />
                        </span>
                      ))}
                    </div>
                    <div className="shortcuts-item-label">{it.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="shortcuts-foot">
          按 <span className="sc-key">Esc</span> 或点空白处关闭
        </div>
      </div>
    </div>
  );
}
