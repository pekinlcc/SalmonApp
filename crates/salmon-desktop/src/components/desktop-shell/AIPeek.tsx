// Hover-only quick glance above the AI Live Tile. Real data from BriefSnapshot.
import { Icons } from "./Icons";
import { AIOrb, widgetHelpers, type WidgetCallbacks } from "./Widget";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";

interface Props {
  show: boolean;
  snap: BriefSnapshot;
  callbacks: WidgetCallbacks;
}

export function AIPeek({ show, snap, callbacks }: Props) {
  const items = widgetHelpers.snapToItems(snap, callbacks).slice(0, 3);
  const summary = widgetHelpers.buildSummary(snap, items);
  const updatedAt = snap.refreshedAt
    ? new Date(snap.refreshedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false })
    : "刚刚";

  return (
    <div className={"ai-anchor " + (show ? "--show" : "")} aria-hidden={!show}>
      <div className="ai-peek">
        <div className="ai-peek-head">
          <AIOrb size="xs" pulse={false} />
          <div>
            <div className="ttl">
              Salmon Brief{" "}
              <span className="dt-quiet" style={{ marginLeft: 4 }}>· {updatedAt}</span>
            </div>
            <div className="sub">
              {items.length > 0 ? `${items.length} 项待办` : "暂无待办"}
            </div>
          </div>
        </div>
        <div className="ai-peek-summary">{summary}</div>
        {items.length > 0 && (
          <div className="ai-peek-list">
            {items.map((q, i) => {
              const Icon = (
                {
                  mail: Icons.Mail,
                  cal: Icons.Calendar,
                  task: Icons.CheckSquare,
                  doc: Icons.Doc,
                  meet: Icons.Video,
                  ai: Icons.AIStar,
                } as const
              )[q.kind];
              return (
                <div key={i} className="ai-peek-row">
                  <div className={`ic bi-${q.kind}`}>
                    <Icon />
                  </div>
                  <div className="txt">{q.title}</div>
                  <div className="meta">{q.meta || ""}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="ai-peek-foot">
          <span>点击打开 · 或长按预览</span>
          <span className="open">
            打开 <Icons.Arrow />
          </span>
        </div>
      </div>
    </div>
  );
}
