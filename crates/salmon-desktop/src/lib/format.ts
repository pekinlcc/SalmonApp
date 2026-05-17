export function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(ts);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function shortPath(p: string, max = 28): string {
  if (p.length <= max) return p;
  const home = (window as any).__SALMON_HOME__ || "";
  let q = p;
  if (home && p.startsWith(home)) q = "~" + p.slice(home.length);
  if (q.length <= max) return q;
  const parts = q.split("/").filter(Boolean);
  if (parts.length <= 2) return q;
  return "…/" + parts.slice(-2).join("/");
}
