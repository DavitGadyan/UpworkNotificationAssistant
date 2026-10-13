"use client";

import { useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Spinner } from "@/components/ui/bits";

/** Finds the numeric id of a channel/group the bot can see (GET /api/telegram/discover) for TELEGRAM_CHAT_ID. */
export function TelegramHelper() {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ configuredChatId: string | null; chats: { id: string | number; title: string; type: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/telegram/discover");
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      setData(await r.json());
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-[16px] bg-[var(--color-sunken)] p-4">
      <p className="text-[13px] font-medium text-[var(--color-muted)]">Channel id helper</p>
      <p className="mt-1 text-[14px] text-[var(--color-muted)]">Add the bot as admin of your channel, post any message there, then look it up. Only works while no webhook is set.</p>
      <button type="button" className="btn btn-sm mt-3 bg-[var(--color-surface)]" disabled={busy} onClick={run}>{busy && <Spinner />}Find chats</button>
      {error && <p role="alert" className="mt-2 text-[14px] text-[var(--color-bad)]">{error}</p>}
      {data && (
        <div className="mt-3 grid gap-2 text-[14px]">
          <p>Configured: <code>{data.configuredChatId ?? "not set"}</code></p>
          {data.chats.length ? (
            <ul className="divide-row rounded-[12px] bg-[var(--color-surface)] px-3">
              {data.chats.map((c) => (
                <li key={String(c.id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="block truncate font-medium">{c.title}</span><code className="text-[13px] text-[var(--color-muted)]">{String(c.id)} · {c.type}</code></span>
                  <CopyButton text={String(c.id)} label="Copy id" />
                </li>
              ))}
            </ul>
          ) : <p className="text-[var(--color-muted)]">No chats seen yet. Post a message in the channel and try again.</p>}
          <p className="text-[13px] text-[var(--color-muted)]">Put the id in <code>TELEGRAM_CHAT_ID</code> in <code>.env</code> and restart.</p>
        </div>
      )}
    </div>
  );
}
