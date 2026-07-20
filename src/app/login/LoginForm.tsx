"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";

export default function LoginForm() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="relative w-full max-w-sm space-y-6 overflow-hidden rounded-2xl border border-sdc-border bg-white p-8 shadow-xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sdc-blue to-sdc-blue-dark" />
        <div className="flex flex-col items-center gap-2 pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sdc-navy">
            <Image src="/brand/sdc-logo-white.png" alt="SDC" width={28} height={16} unoptimized />
          </div>
          <h1 className="font-heading text-lg font-bold text-sdc-navy">Sign in</h1>
          <p className="text-xs text-sdc-gray-400">Use your Steven Douglas Corp. account</p>
        </div>

        <button
          type="button"
          onClick={() => signIn("microsoft-entra-id", { callbackUrl: "/" })}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-sdc-border bg-white py-2.5 text-sm font-medium text-sdc-navy shadow-sm transition-colors hover:bg-sdc-gray-100"
        >
          {/* Microsoft logo */}
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <rect x="0" y="0" width="7.5" height="7.5" fill="#f25022" />
            <rect x="8.5" y="0" width="7.5" height="7.5" fill="#7fba00" />
            <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00a4ef" />
            <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        <p className="text-center text-[11px] text-sdc-gray-400">
          Access is restricted to @sdcautomation.com accounts.
        </p>
      </div>
    </div>
  );
}
