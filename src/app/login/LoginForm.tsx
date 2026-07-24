"use client";

import Image from "next/image";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { registerUser } from "./actions";

type Mode = "signin" | "signup";

export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await registerUser({ name, email, password });
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) {
        setError(mode === "signup" ? "Account created, but sign-in failed. Try signing in." : "Invalid email or password.");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="relative w-full max-w-sm space-y-5 overflow-hidden rounded-2xl border border-sdc-border bg-white p-8 shadow-xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sdc-blue to-sdc-blue-dark" />
        <div className="flex flex-col items-center gap-2 pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sdc-navy">
            <Image src="/brand/sdc-logo-white.png" alt="SDC" width={28} height={16} unoptimized />
          </div>
          <h1 className="font-heading text-lg font-bold text-sdc-navy">
            {mode === "signin" ? "Sign in" : "Create your account"}
          </h1>
          <p className="text-xs text-sdc-gray-400">
            {mode === "signin" ? "Use your Steven Douglas Corp. account" : "Set up a new SDC Projects Reports account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "signup" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-sdc-gray-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
                autoComplete="name"
                required
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-sdc-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-sdc-gray-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
            />
            {mode === "signup" && <p className="text-[11px] text-sdc-gray-400">At least 8 characters.</p>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-sdc-blue py-2 text-sm font-medium text-white shadow-sm hover:bg-sdc-blue-dark disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="text-center text-xs text-sdc-gray-400">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button type="button" onClick={() => switchMode("signup")} className="font-medium text-sdc-blue hover:underline">
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("signin")} className="font-medium text-sdc-blue hover:underline">
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
