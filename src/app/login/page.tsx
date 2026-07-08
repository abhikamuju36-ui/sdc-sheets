"use client";

import Image from "next/image";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm space-y-5 overflow-hidden rounded-2xl border border-sdc-border bg-white p-8 shadow-xl"
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sdc-blue to-sdc-blue-dark" />
        <div className="flex flex-col items-center gap-2 pb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sdc-navy">
            <Image src="/brand/sdc-logo-white.png" alt="SDC" width={28} height={16} unoptimized />
          </div>
          <h1 className="font-heading text-lg font-bold text-sdc-navy">Sign in</h1>
          <p className="text-xs text-sdc-gray-400">Use your Steven Douglas Corp. account</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-sdc-gray-700">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-sdc-border px-3 py-2 text-sm focus:border-sdc-blue focus:outline-none"
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
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded-lg bg-sdc-blue py-2 text-sm font-medium text-white shadow-sm hover:bg-sdc-blue-dark">
          Sign in
        </button>
      </form>
    </div>
  );
}
