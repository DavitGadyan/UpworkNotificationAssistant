"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@/components/icons";

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-sm ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const t = document.createElement("textarea");
          t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
        }
        setDone(true); setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <IconCheck size={16} /> : <IconCopy size={16} />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
