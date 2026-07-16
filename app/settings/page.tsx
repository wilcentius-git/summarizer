"use client";

import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/app/contexts/AuthContext";
import { useGroqApiKey } from "@/app/hooks/useGroqApiKey";

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { groqApiKey, setGroqApiKey } = useGroqApiKey();
  const [showGroqApiKey, setShowGroqApiKey] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/");
    } else if (user.isAdmin) {
      router.replace("/admin/settings");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user || user.isAdmin) {
    return (
      <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
        <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center animate-fade-slide-in">
          <p className="text-sm text-gray-600">Memuat…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden animate-fade-slide-in">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            aria-label="Kembali ke aplikasi"
            className="p-2 rounded-lg text-kemenkum-blue hover:opacity-80 shrink-0"
          >
            <ArrowLeft size={24} strokeWidth={2.5} />
          </Link>
          <h1 className="text-xl font-bold text-kemenkum-blue truncate">Pengaturan</h1>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Bawa sendiri hanya jika server belum mengatur{" "}
            <code className="text-gray-600">GROQ_API_KEY</code>. Kunci gratis di{" "}
            <a
              href="https://console.groq.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-kemenkum-blue hover:underline"
            >
              console.groq.com
            </a>{" "}
            (disimpan selama sesi peramban).
          </p>
          <label
            htmlFor="groq-api-key"
            className="block text-sm font-medium text-gray-700 mt-3 mb-1"
          >
            Groq API Key
          </label>
          <div className="relative">
            <input
              id="groq-api-key"
              type={showGroqApiKey ? "text" : "password"}
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="Kosongkan jika memakai kunci server"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
            />
            <button
              type="button"
              onClick={() => setShowGroqApiKey((v) => !v)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showGroqApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
