"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";

type WhitelistEntry = {
  nip: string;
  createdAt: string;
};

function formatWhitelistDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function AdminWhitelistPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [nipInput, setNipInput] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingNip, setDeletingNip] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchEntries = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/admin/whitelist", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || "Gagal memuat whitelist");
        setEntries([]);
        return;
      }
      setEntries(data.entries ?? []);
    } catch {
      setListError("Gagal memuat whitelist");
      setEntries([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.isAdmin) {
      router.replace("/");
      return;
    }
    fetchEntries();
  }, [authLoading, user, router, fetchEntries]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const trimmed = nipInput.trim();
    if (!trimmed) {
      setAddError("NIP wajib diisi");
      return;
    }

    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nip: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Gagal menambahkan NIP");
        return;
      }
      setNipInput("");
      await fetchEntries({ silent: true });
    } catch {
      setAddError("Gagal menambahkan NIP");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleDelete(nip: string) {
    if (!window.confirm(`Hapus NIP ${nip} dari whitelist?`)) return;

    setDeleteError(null);
    setDeletingNip(nip);
    try {
      const res = await fetch(
        `/api/admin/whitelist/${encodeURIComponent(nip)}`,
        { method: "DELETE", credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Gagal menghapus NIP");
        return;
      }
      await fetchEntries({ silent: true });
    } catch {
      setDeleteError("Gagal menghapus NIP");
    } finally {
      setDeletingNip(null);
    }
  }

  if (authLoading || !user?.isAdmin) {
    return (
      <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
        <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
          <p className="text-sm text-gray-600">Memuat…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
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
            Kelola Whitelist
          </h1>
        </div>

        <section className="mb-8 text-left">
          <h2 className="text-base font-semibold text-kemenkum-blue mb-3">
            Tambah NIP
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={nipInput}
              onChange={(e) => {
                setNipInput(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="Masukkan NIP"
              disabled={addLoading}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={addLoading}
              className="px-6 py-2 rounded-lg bg-kemenkum-blue text-white font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
            >
              {addLoading ? "Menambahkan…" : "Tambah"}
            </button>
          </form>
          {addError && (
            <p className="mt-2 text-sm text-red-600" role="alert">
              {addError}
            </p>
          )}
        </section>

        <section className="text-left">
          <h2 className="text-base font-semibold text-kemenkum-blue mb-3">
            Daftar Whitelist
          </h2>
          {listError && (
            <div
              className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-red-700 text-sm"
              role="alert"
            >
              {listError}
            </div>
          )}
          {deleteError && (
            <div
              className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-red-700 text-sm"
              role="alert"
            >
              {deleteError}
            </div>
          )}
          {listLoading ? (
            <p className="text-sm text-gray-600">Memuat daftar…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-600">Belum ada NIP dalam whitelist.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th className="w-1/4 px-0 py-3 pr-4 font-semibold">NIP</th>
                    <th className="w-1/2 px-0 py-3 pr-4 font-semibold">
                      Tanggal Ditambahkan
                    </th>
                    <th className="w-1/4 px-0 py-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.nip} className="text-gray-900">
                      <td className="w-1/4 px-0 py-3 pr-4 font-medium">{entry.nip}</td>
                      <td className="w-1/2 px-0 py-3 pr-4 text-gray-600">
                        {formatWhitelistDate(entry.createdAt)}
                      </td>
                      <td className="w-1/4 px-0 py-3 text-center align-middle">
                        <div className="flex items-center justify-center">
                          <button
                            type="button"
                            onClick={() => handleDelete(entry.nip)}
                            disabled={deletingNip !== null}
                            className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 disabled:opacity-60 whitespace-nowrap"
                          >
                            {deletingNip === entry.nip ? "Menghapus…" : "Hapus"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
