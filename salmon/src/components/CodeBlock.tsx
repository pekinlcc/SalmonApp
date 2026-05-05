import { useRef, useState } from "react";

export function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="codeblock">
      <button
        className={`codeblock-copy${copied ? " copied" : ""}`}
        onClick={onCopy}
        title="复制到剪贴板"
        aria-label="复制代码块"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
