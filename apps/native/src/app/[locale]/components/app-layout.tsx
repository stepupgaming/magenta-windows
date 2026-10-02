"use client";

import { SidebarProvider } from "@workspace/ui/components/sidebar";
import type React from "react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider className="h-dvh w-screen overflow-hidden bg-neutral-950 text-white">
      {children}
    </SidebarProvider>
  );
}
