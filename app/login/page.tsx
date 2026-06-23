"use client";

import { version } from "../../package.json";
import { Eye, EyeOff } from "lucide-react";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import kemenkumLogo from "@/assets/kemenkum_logo.png";
import { useAuth } from "@/app/contexts/AuthContext";

function LoginForm() {
  const [nip, setNip] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from") || "/";
  const from = rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : "/";
  const { refresh } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nip, pass: password }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setError(
            data.error ||
              "Akun Anda tidak terdaftar dalam daftar akses. Hubungi administrator."
          );
        } else if (res.status === 401) {
          setError("NIP atau kata sandi tidak valid.");
        } else {
          setError(data.error || "Login failed");
        }
        return;
      }
      await refresh();
      router.push(from);
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-kemenkum-blue flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg px-6 py-8 animate-fade-slide-in">
        <div className="flex items-center justify-center gap-3 mb-6">
          <Image
            src={kemenkumLogo}
            alt="Kemenkum"
            width={kemenkumLogo.width}
            height={kemenkumLogo.height}
            style={{ width: "auto", height: "3rem" }}
          />
          <h1 className="text-2xl font-bold text-kemenkum-blue">Kemenkum Summarizer</h1>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">Masuk</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="nip" className="block text-sm font-medium text-gray-700 mb-1">
              NIP
            </label>
            <input
              id="nip"
              type="text"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
              placeholder="Masukkan NIP Anda"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-kemenkum-blue text-white font-medium hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Memproses…" : "Masuk"}
          </button>
          <p className="text-center text-xs text-gray-400 mt-3">v{version}</p>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-kemenkum-blue flex items-center justify-center py-12 px-4">
          <div className="text-white">Memuat…</div>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
