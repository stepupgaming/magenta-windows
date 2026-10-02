"use client";

import type React from "react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="h-dvh w-screen overflow-hidden bg-neutral-950 text-white">
      {children}
    </div>
  );
}
