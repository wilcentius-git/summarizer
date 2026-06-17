"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/app/contexts/AuthContext";

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

  useEffect(() => {
    if (authLoading) return;
    if (!user?.isAdmin) {
      router.replace("/");
    }
  }, [authLoading, user, router]);

  if (authLoading || !user?.isAdmin) {
    return (
      <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
        <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
          <p className="text-sm text-gray-600">Memuat…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => router.push("/")}
            aria-label="Kembali ke aplikasi"
            className="p-2 rounded-lg text-kemenkum-blue hover:opacity-80 shrink-0"
          >
            <ArrowLeft size={24} strokeWidth={2.5} />
          </button>
          <h1 className="text-xl font-bold text-kemenkum-blue truncate">
            Pengaturan Admin
          </h1>
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
