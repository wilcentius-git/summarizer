"use client";

import { ArrowLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/app/contexts/AuthContext";
import { useGroqApiKey } from "@/app/hooks/useGroqApiKey";

const MENU_ITEMS = [
  {
    href: "/admin/whitelist",
    title: "Kelola Whitelist",
    description:
      "Tambah atau hapus NIP yang diizinkan mengakses aplikasi, serta kelola satuan kerja.",
  },
  {
    href: "/admin/logs",
    title: "Audit Logs",
    description:
      "Lihat riwayat aktivitas login, pekerjaan ringkasan, dan tindakan administrasi.",
  },
] as const;

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { groqApiKey, setGroqApiKey } = useGroqApiKey();
  const [showGroqApiKey, setShowGroqApiKey] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.isAdmin) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user?.isAdmin) {
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
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center animate-fade-slide-in">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            aria-label="Kembali ke aplikasi"
            className="p-2 rounded-lg text-kemenkum-blue hover:opacity-80 shrink-0"
          >
            <ArrowLeft size={24} strokeWidth={2.5} />
          </Link>
          <h1 className="text-xl font-bold text-kemenkum-blue truncate">
            Pengaturan Admin
          </h1>
        </div>

        <div className="mb-6 pb-6 border-b border-gray-100 text-left">
          <p className="text-xs text-gray-500 mb-3">
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
            className="block text-sm font-medium text-gray-700 mb-1"
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

        <div className="space-y-4 text-left">
          {MENU_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-4 hover:border-kemenkum-blue hover:bg-kemenkum-blue/5 transition-colors"
            >
              <div>
                <h2 className="text-base font-semibold text-kemenkum-blue">
                  {item.title}
                </h2>
                <p className="mt-1 text-sm text-gray-600">{item.description}</p>
              </div>
              <ChevronRight
                size={20}
                strokeWidth={2.5}
                className="shrink-0 text-kemenkum-blue"
              />
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
