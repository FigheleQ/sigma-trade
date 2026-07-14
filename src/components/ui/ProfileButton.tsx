"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

function getInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const letters = local.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || "??").toUpperCase();
}

export default function ProfileButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initials = getInitials(email);
  const displayName = email.split("@")[0] ?? email;

  return (
    <div ref={ref} className="relative flex items-center gap-3">
      {/* Welcome text — hidden on mobile to keep the TopBar on one line */}
      <span className="hidden sm:inline font-mono text-xs text-gray-400 tracking-wide">
        Welcome,{" "}
        <span className="text-gray-200 font-semibold">{displayName}</span>
      </span>

      {/* Avatar button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
          "border-2 border-accent bg-bg-panel",
          "font-mono text-xs font-bold text-accent",
          "transition-all duration-150",
          "hover:shadow-[0_0_10px_rgba(0,255,136,0.4)]",
          "focus:outline-none focus:ring-2 focus:ring-accent/50",
          open && "shadow-[0_0_14px_rgba(0,255,136,0.5)]",
        )}
        aria-label="Profile menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+8px)] z-50",
            "min-w-[160px] py-1.5",
            "bg-bg-panel border border-border-subtle",
            "shadow-[0_8px_32px_rgba(0,0,0,0.6)]",
          )}
          style={{ borderRadius: "25px" }}
        >
          <DropdownItem
            label="My Profile"
            onClick={() => setOpen(false)}
          />
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className={cn(
                "w-full text-left px-5 py-2",
                "font-mono text-xs text-gray-300 tracking-wide",
                "transition-colors duration-100",
                "hover:bg-white/5 hover:text-gray-100",
              )}
            >
              Sign Out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      className={cn(
        "w-full text-left px-5 py-2",
        "font-mono text-xs text-gray-300 tracking-wide",
        "transition-colors duration-100",
        "hover:bg-white/5 hover:text-gray-100",
        pressed && "bg-white/10 text-white scale-[0-98]",
      )}
    >
      {label}
    </button>
  );
}
