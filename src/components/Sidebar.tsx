"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { isEtcDirty } from "@/lib/etc-dirty-tracker";

const COLLAPSE_KEY = "sdc-etc-planner-sidebar-collapsed";
const WIDTH_KEY = "sdc-etc-planner-sidebar-width";
const DEFAULT_WIDTH = 240; // matches the old fixed w-60
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

// Minimal external store for the collapse toggle. Avoids setState-in-effect
// (which would cause a hydration mismatch anyway, since localStorage isn't
// available during SSR) — useSyncExternalStore is the correct primitive for
// syncing a browser-only value into React with a safe server snapshot.
let collapsedValue = false;
let initialized = false;
const listeners = new Set<() => void>();

function getSnapshot() {
  if (!initialized) {
    collapsedValue = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    initialized = true;
  }
  return collapsedValue;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setCollapsedValue(next: boolean) {
  collapsedValue = next;
  initialized = true;
  window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  listeners.forEach((cb) => cb());
}

// Same external-store pattern as the collapse toggle, for the drag-resized width.
let widthValue = DEFAULT_WIDTH;
let widthInitialized = false;
const widthListeners = new Set<() => void>();

function getWidthSnapshot() {
  if (!widthInitialized) {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    widthValue = stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
    widthInitialized = true;
  }
  return widthValue;
}

function getServerWidthSnapshot() {
  return DEFAULT_WIDTH;
}

function subscribeWidth(callback: () => void) {
  widthListeners.add(callback);
  return () => widthListeners.delete(callback);
}

function setWidthValue(next: number) {
  const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
  widthValue = clamped;
  widthInitialized = true;
  window.localStorage.setItem(WIDTH_KEY, String(clamped));
  widthListeners.forEach((cb) => cb());
}

type NavItem = { href: string; label: string; icon: React.ReactNode; isActive: (path: string) => boolean };
type NavGroup = { label: string; items: NavItem[] };

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
      {children}
    </svg>
  );
}

const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        href: "/",
        label: "Dashboard",
        isActive: (p) => p === "/",
        icon: (
          <Icon>
            <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
            <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
            <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Work",
    items: [
      {
        href: "/jobs",
        label: "Jobs",
        isActive: (p) => p === "/jobs" || p.startsWith("/jobs/"),
        icon: (
          <Icon>
            <line x1="1.5" y1="3.5" x2="14.5" y2="3.5" strokeLinecap="round" />
            <line x1="1.5" y1="8" x2="14.5" y2="8" strokeLinecap="round" />
            <line x1="1.5" y1="12.5" x2="14.5" y2="12.5" strokeLinecap="round" />
          </Icon>
        ),
      },
      {
        href: "/employees",
        label: "Employees",
        isActive: (p) => p === "/employees",
        icon: (
          <Icon>
            <circle cx="6" cy="5.5" r="2.5" />
            <path d="M1.5 13.5 C1.5 10.5 3.5 9.5 6 9.5 C8.5 9.5 10.5 10.5 10.5 13.5" strokeLinecap="round" />
            <circle cx="11.5" cy="6" r="2" />
            <path d="M12 9.5 C13.8 9.8 14.8 11 14.8 13" strokeLinecap="round" />
          </Icon>
        ),
      },
    ],
  },
  {
    label: "Planning",
    items: [
      {
        href: "/quoted",
        label: "Projects",
        isActive: (p) => p === "/quoted",
        icon: (
          <Icon>
            <circle cx="8" cy="8" r="6" />
            <line x1="8" y1="2" x2="8" y2="8" strokeLinecap="round" />
          </Icon>
        ),
      },
      {
        href: "/job-hours",
        label: "Job Hour Details",
        isActive: (p) => p === "/job-hours",
        icon: (
          <Icon>
            <line x1="2" y1="14" x2="14" y2="14" strokeLinecap="round" />
            <rect x="2.5" y="8" width="2.5" height="5" rx="0.5" />
            <rect x="6.75" y="4.5" width="2.5" height="8.5" rx="0.5" />
            <rect x="11" y="6.5" width="2.5" height="6.5" rx="0.5" />
          </Icon>
        ),
      },
      {
        href: "/etc",
        label: "Monthly ETC",
        isActive: (p) => p === "/etc",
        icon: (
          <Icon>
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <line x1="2" y1="6" x2="14" y2="6" />
          </Icon>
        ),
      },
    ],
  },
];

const ADMIN_GROUP: NavGroup = {
  label: "Admin",
  items: [
    {
      href: "/audit-log",
      label: "Audit Log",
      isActive: (p) => p === "/audit-log",
      icon: (
        <Icon>
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
          <line x1="4.5" y1="5.5" x2="11.5" y2="5.5" strokeLinecap="round" />
          <line x1="4.5" y1="8" x2="11.5" y2="8" strokeLinecap="round" />
          <line x1="4.5" y1="10.5" x2="8.5" y2="10.5" strokeLinecap="round" />
        </Icon>
      ),
    },
  ],
};

export default function Sidebar({
  userEmail,
  role,
  signOutAction,
}: {
  userEmail?: string | null;
  role?: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const groups = role === "ADMIN" ? [...GROUPS, ADMIN_GROUP] : GROUPS;

  // Hidden entry point for the password-gated Standard Sheet columns: the box
  // that reveals them is intentionally undiscoverable on the /etc page itself
  // (only a few people are meant to know it exists). Clicking the "Monthly ETC"
  // item three times in quick succession takes you to /etc with the secret flag
  // that renders the password box; a normal single click just opens /etc.
  const etcClickCount = useRef(0);
  const etcClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleEtcClick(e: React.MouseEvent) {
    etcClickCount.current += 1;
    if (etcClickTimer.current) clearTimeout(etcClickTimer.current);
    if (etcClickCount.current >= 3) {
      etcClickCount.current = 0;
      e.preventDefault();
      router.push("/etc?standards=1");
      return;
    }
    // Reset the streak if the next click doesn't land within the window. Kept
    // generous so the third click reliably lands the first time — each click
    // also navigates to /etc, so the window has to absorb that latency.
    etcClickTimer.current = setTimeout(() => {
      etcClickCount.current = 0;
    }, 1500);
  }

  // Leaving /etc with unsaved New ETC values (typing alone doesn't autosave —
  // see EtcSectionCells/SaveEtcDraftsButton) is a plain client-side route
  // change, so it never fires the browser's native beforeunload warning.
  // This is the sidebar's equivalent of that warning; every nav item runs it
  // before whatever else it does (like the /etc triple-click above).
  function handleNavClick(e: React.MouseEvent, href: string) {
    if (isEtcDirty() && !window.confirm("You have unsaved New ETC changes that haven't been saved. Leave this page anyway?")) {
      e.preventDefault();
      return;
    }
    if (href === "/etc") handleEtcClick(e);
  }
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const persistedWidth = useSyncExternalStore(subscribeWidth, getWidthSnapshot, getServerWidthSnapshot);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? persistedWidth;

  function toggleCollapsed() {
    setCollapsedValue(!collapsed);
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = persistedWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setDragWidth(next);
    }

    function onMouseUp(ev: MouseEvent) {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setWidthValue(next);
      setDragWidth(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <aside
      style={{ width: collapsed ? undefined : width }}
      className={`relative flex shrink-0 flex-col bg-sdc-navy text-white ${
        dragWidth === null ? "transition-[width] duration-150" : ""
      } ${collapsed ? "w-16" : ""}`}
    >
      {!collapsed && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          className="absolute top-0 right-0 z-10 h-full w-1.5 -mr-0.5 cursor-col-resize hover:bg-white/10 active:bg-white/10"
        />
      )}
      <div
        className={`flex items-center gap-2.5 border-b border-white/10 ${collapsed ? "justify-center px-0 py-4" : "px-4 py-4"}`}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-sdc-blue">
          <Image src="/brand/sdc-logo-white.png" alt="SDC" width={28} height={15} unoptimized />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-white">ETC Planner</p>
            <p className="truncate text-[11px] text-sdc-blue-100/80">Steven Douglas Corp.</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10.5px] font-semibold tracking-wider text-sdc-blue-100/50 uppercase">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.isActive(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => handleNavClick(e, item.href)}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                      collapsed ? "justify-center" : ""
                    } ${
                      active
                        ? "border-l-2 border-sdc-blue bg-sdc-blue/20 text-white"
                        : "text-sdc-blue-100/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${active ? "text-white" : "text-sdc-blue-100/60"}`}>
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={toggleCollapsed}
        className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3 text-xs font-medium text-sdc-blue-100/70 hover:bg-white/5 hover:text-white"
      >
        <Icon>
          {collapsed ? (
            <path d="M6 3 L11 8 L6 13" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M10 3 L5 8 L10 13" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </Icon>
        {!collapsed && <span>Collapse</span>}
      </button>

      <div className={`flex items-center gap-2 border-t border-white/10 px-4 py-3 ${collapsed ? "justify-center px-0" : ""}`}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sdc-blue text-[11px] font-semibold text-white">
          {userEmail?.[0]?.toUpperCase() ?? "?"}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-sdc-blue-100/90">{userEmail}</p>
            <form action={signOutAction}>
              <button
                onClick={(e) => {
                  if (isEtcDirty() && !window.confirm("You have unsaved New ETC changes that haven't been saved. Sign out anyway?")) {
                    e.preventDefault();
                  }
                }}
                className="text-[11px] text-sdc-blue-100/60 underline hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
