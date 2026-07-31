import {
  Bot,
  Calculator,
  Clock,
  FileSearch,
  GitBranch,
  Globe,
  Mail,
  MessageSquare,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Maps the string icon names stored on tools / step meta to lucide components. */
const ICONS: Record<string, LucideIcon> = {
  Bot,
  Calculator,
  Clock,
  FileSearch,
  GitBranch,
  Globe,
  Mail,
  MessageSquare,
  Search,
  Wrench,
};

export function resolveIcon(name: string | undefined | null, fallback: LucideIcon = Wrench): LucideIcon {
  if (!name) return fallback;
  return ICONS[name] ?? fallback;
}
