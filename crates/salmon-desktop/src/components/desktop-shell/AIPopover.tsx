// Click-only floating window above the AI Live Tile. Esc / outside-click closes.
import { useEffect, useRef } from "react";
import { Icons } from "./Icons";
import { AIOrb, widgetHelpers, type WidgetCallbacks } from "./Widget";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";

interface Props {
  show: boolean;
  snap: BriefSnapshot;
  callbacks: WidgetCallbacks;
  onClose: () => void;
  onExpand: () => void;
}

export function AIPopover({ show, snap, callbacks, onClose, onExpand }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current) return;
      // Click inside the popover OR on the dock AI tile keeps it open.
      if (ref.current.contains(target)) return;
      if (target.closest(".dock-ai-tile")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [show, onClose]);

  const items = widgetHelpers.snapToItems(snap, callbacks);
  const summary = widgetHelpers.buildSummary(snap, items);

  return (
    <div ref={ref} className={"ai-anchor " + (show ? "--show" : "")} aria-hidden={!show}>
      <div className="ai-pop">
        <div className="widget-glow" />
        <div className="ai-pop-inner">
          <div className="ai-pop-head">
            <AIOrb size="sm" pulse={true} />
            <div className="label">
              <div className="ttl">
                Salmon Brief <span className="dt-quiet">· 实时</span>
              </div>
              <div className="sub">
                <span className="live-dot" />
                {items.length > 0
                  ? `${items.length} 项待办 · 来自真实账户数据`
                  : "暂无数据 · 在设置中连接 Gmail / Outlook"}
              </div>
            </div>
            <div className="actions">
              <button className="w-action" title="刷新" type="button">
                <Icons.Sparkle />
              </button>
              <button className="w-action" title="关闭" type="button" onClick={onClose}>
                <Icons.Close />
              </button>
            </div>
          </div>

          <div className="ai-pop-summary">{summary}</div>

          {items.length > 0 && (
            <div className="ai-pop-list">
              {items.slice(0, 5).map((it, i) => {
                const Icon = (
                  {
                    mail: Icons.Mail,
                    cal: Icons.Calendar,
                    task: Icons.CheckSquare,
                    doc: Icons.Doc,
                    meet: Icons.Video,
                    ai: Icons.AIStar,
                  } as const
                )[it.kind];
                return (
                  <div key={i} className="ai-pop-item" onClick={it.onClick}>
                    <div className={`ic bi-${it.kind}`}>
                      <Icon />
                    </div>
                    <div className="tx">
                      <div className="t">
                        {it.chip && (
                          <span className={`chip${it.chipKind ? " --" + it.chipKind : ""}`}>{it.chip}</span>
                        )}
                        <span className="dt-flex-truncate">{it.title}</span>
                      </div>
                      <div className="s">
                        {[it.who, it.meta, it.tail].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button
                      className={"cta" + (i === 0 ? " --primary" : "")}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        it.onClick?.();
                      }}
                    >
                      {it.cta || "查看"}
                      <Icons.Arrow />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ai-pop-foot">
            <span className="hint">点击 dock 图标外关闭 · 或按 Esc</span>
            <button className="expand-btn" type="button" onClick={onExpand}>
              在桌面展开 <Icons.Arrow />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
