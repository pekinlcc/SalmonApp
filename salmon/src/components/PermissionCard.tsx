interface Props {
  tool: string;
  command?: string | null;
  input: any;
  workdir: string;
  onApprove: (allow: boolean) => void;
}

export function PermissionCard({ tool, command, input, workdir, onApprove }: Props) {
  const cmd = command || (input?.command as string) || JSON.stringify(input);
  return (
    <div className="perm">
      <div className="perm-head">
        <span className="perm-icon">!</span>
        <span className="perm-title">权限请求 · {tool}</span>
      </div>
      <div className="perm-body">
        <div className="perm-cmd">
          <span style={{ color: "var(--salmon-300)", marginRight: 6 }}>$</span>
          {cmd}
        </div>
        <div className="perm-meta">
          工作目录：<code style={{ fontFamily: "var(--mono)", background: "var(--ink-50)", padding: "0 4px", borderRadius: 3, border: "1px solid var(--ink-100)" }}>{workdir}</code>
        </div>
      </div>
      <div className="perm-actions">
        <button className="btn btn-sm btn-primary" onClick={() => onApprove(true)}>允许一次</button>
        <button className="btn btn-sm btn-danger" onClick={() => onApprove(false)}>拒绝</button>
      </div>
    </div>
  );
}
