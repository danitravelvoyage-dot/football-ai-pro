"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface SubNavItem {
  href: string;
  label: string;
  /** The overview matches only its own path; other sections also match their sub-paths. */
  exact?: boolean;
}

export function CommandSubNav({ items, label }: { items: SubNavItem[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
              active ? "bg-navy-900 text-white" : "bg-white text-navy-800 ring-1 ring-navy-100 hover:bg-navy-50",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
