// Heterogeneous AI Live Tile that sits leftmost in the dock. Rotates through
// the most relevant brief items every 3.5s. Real data — derived from the same
// BriefSnapshot the Widget consumes — so the tile and widget stay in sync.
import { ReactNode, useEffect, useState } from "react";
import { Icons } from "./Icons";
import { widgetHelpers, type WidgetCallbacks } from "./Widget";
import type { BriefSnapshot } from "../../lib/useDesktopBrief";

interface Rotation {
  label: string;
  text: ReactNode;
  meta: string;
}

function deriveRotations(snap: BriefSnapshot, cb: WidgetCallbacks): Rotation[] {
  const out: Rotation[] = [];

  if (snap.nextEvent) {
    const r = widgetHelpers.relativeMin(snap.nextEvent.startMs);
    const title = snap.nextEvent.title || "(无标题会议)";
    out.push({
      label: "现在",
      text: (
        <>
          会议 <b>{r.chip}</b> · {title}
        </>
      ),
      meta: `${widgetHelpers.fmtTime(snap.nextEvent.startMs)}${snap.nextEvent.location ? " · " + snap.nextEvent.location : ""}`,
    });
  }

  snap.recs.slice(0, 2).forEach((r) => {
    out.push({
      label: r.priority === "high" ? "重要" : "AI 建议",
      text: <>{r.title}</>,
      meta: r.actionHint || "Salmon 已分析",
    });
  });

  if (snap.recentMail.length > 0) {
    const m = snap.recentMail[0];
    out.push({
      label: "等你回复",
      text: (
        <>
          {m.fromName || m.fromEmail || "未知发件人"} · {m.subject || "(无主题)"}
        </>
      ),
      meta: "Salmon 已起草",
    });
  } else if (snap.unreadMail > 0) {
    out.push({
      label: "未读邮件",
      text: (
        <>
          收件箱有 <b>{snap.unreadMail}</b> 封新邮件
        </>
      ),
      meta: "点开 dock 邮件查看",
    });
  }

  snap.todayTasks.slice(0, 1).forEach((t) => {
    out.push({
      label: "今日待办",
      text: <>{t.title}</>,
      meta: t.dueMs
        ? `截止 ${widgetHelpers.fmtTime(t.dueMs)}`
        : "无截止时间",
    });
  });

  if (out.length === 0) {
    // Reuse callbacks variable so the import isn't dead in the empty branch.
    void cb;
    out.push({
      label: "Salmon",
      text: <>今天没什么需要立刻处理的</>,
      meta: "连接邮箱 / 日历后这里会更活跃",
    });
  }

  return out;
}

interface Props {
  snap: BriefSnapshot;
  callbacks: WidgetCallbacks;
  badgeCount: number;
  onClick: (e: React.MouseEvent) => void;
  onHoverChange: (hover: boolean) => void;
  peek?: ReactNode;
  pop?: ReactNode;
}

export function AILiveTile({ snap, callbacks, badgeCount, onClick, onHoverChange, peek, pop }: Props) {
  const rotations = deriveRotations(snap, callbacks);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [rotations.length]);

  useEffect(() => {
    if (rotations.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % rotations.length), 3500);
    return () => clearInterval(t);
  }, [rotations.length]);

  const cur = rotations[idx] ?? rotations[0];

  return (
    <div
      className="dock-ai-tile"
      onClick={onClick}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      title="Salmon Brief · AI 推荐"
    >
      <div className="sheen" />
      <div className="orb">
        <div className="orb-glyph">
          <Icons.AIStar />
        </div>
      </div>
      <div className="body">
        <div className="rot" key={idx}>
          <div className="label">
            <span className="dot" />
            <span>{cur?.label}</span>
          </div>
          <div className="text">{cur?.text}</div>
          <div className="meta">{cur?.meta}</div>
        </div>
      </div>
      <div className="pips">
        {rotations.map((_, i) => (
          <i key={i} className={i === idx ? "--on" : ""} />
        ))}
      </div>
      {badgeCount > 0 && <span className="badge">{badgeCount}</span>}
      {peek}
      {pop}
    </div>
  );
}
