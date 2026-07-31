"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Inbox, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Workflows", icon: Workflow, match: (p: string) => p === "/" || p.startsWith("/workflows") },
  { href: "/runs", label: "History", icon: History, match: (p: string) => p.startsWith("/runs") },
  { href: "/outbox", label: "Outbox", icon: Inbox, match: (p: string) => p.startsWith("/outbox") },
];

export function AppNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-6">
        <Link href="/" className="focus-ring flex items-center gap-2.5 rounded-lg">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <Workflow className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Workflow Studio</span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "focus-ring flex h-8 items-center gap-2 rounded-lg px-3 text-sm transition-colors",
                  active
                    ? "bg-surface-raised font-medium text-foreground"
                    : "text-subtle hover:bg-surface hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
