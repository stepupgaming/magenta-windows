"use client";

import { isTauri } from "@tauri-apps/api/core";
import { AlertTriangle, Loader2, PlugZap } from "lucide-react";
import { motion } from "motion/react";
import { useLive } from "../store.ts";

export function EngineBanner() {
  const phase = useLive((state) => state.phase);
  const bootstrap = useLive((state) => state.bootstrap);
  const status = useLive((state) => state.status);
  if (phase !== "offline" && phase !== "error") {
    return null;
  }
  const settingUp = phase === "offline" && bootstrap.length > 0;
  let icon = <PlugZap className="size-4 shrink-0 text-white/60" />;
  let title = "The sound engine is not running";
  let body = isTauri()
    ? "The window starts it on its own. If this stays, check engine/logs/server.log."
    : "Start it with magenta serve, or open the desktop window. Everything here works and waits for it.";
  if (settingUp) {
    icon = <Loader2 className="size-4 shrink-0 animate-spin text-amber-200" />;
    title = "Setting up the first launch";
    body = bootstrap;
  } else if (phase === "error") {
    icon = <AlertTriangle className="size-4 shrink-0 text-rose-300" />;
    title = "Something went wrong";
    body = `${status}. Press play to try again.`;
  }
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mx-3 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5"
      initial={{ opacity: 0, y: -6 }}
    >
      {icon}
      <div className="min-w-0">
        <p className="text-[13px] text-white/90">{title}</p>
        <p className="truncate text-white/50 text-xs">{body}</p>
      </div>
    </motion.div>
  );
}
