"use client";

import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/contexts/AuthContext";

type GlossaryTermItem = {
  id: string;
  term: string;
  commonMistakes: string[];
  definition?: string;
  createdAt: string;
};

function formatGlossaryDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

function formatMistakes(mistakes: string[]): string {
  if (mistakes.length === 0) return "—";
  return mistakes.join(", ");
}

export default function AdminGlossaryPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [terms, setTerms] = useState<GlossaryTermItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [termInput, setTermInput] = useState("");
  const [mistakesInput, setMistakesInput] = useState("");
  const [definitionInput, setDefinitionInput] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTermInput, setEditTermInput] = useState("");
  const [editMistakesInput, setEditMistakesInput] = useState("");
  const [editDefinitionInput, setEditDefinitionInput] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchTerms = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const res = await fetch(`/api/admin/glossary?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || "Gagal memuat glosarium");
        setTerms([]);
        return;
      }
      setTerms(data.terms ?? []);
    } catch {
      setListError("Gagal memuat glosarium");
      setTerms([]);
    } finally {
      setListLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.isAdmin) {
      router.replace("/");
      return;
    }
    void fetchTerms({ silent: false });
  }, [authLoading, user, router]);

  useEffect(() => {
    if (authLoading || !user?.isAdmin) return;
    const timer = setTimeout(() => {
      void fetchTerms({ silent: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function startEdit(item: GlossaryTermItem) {
    setEditingId(item.id);
    setEditTermInput(item.term);
    setEditMistakesInput(item.commonMistakes.join(", "));
    setEditDefinitionInput(item.definition?.trim() ?? "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTermInput("");
    setEditMistakesInput("");
    setEditDefinitionInput("");
    setEditError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const term = termInput.trim();
    if (!term) {
      setAddError("Istilah wajib diisi");
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          term,
          commonMistakes: mistakesInput.trim(),
          definition: definitionInput.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Gagal menambahkan istilah");
        return;
      }
      setTermInput("");
      setMistakesInput("");
      setDefinitionInput("");
      await fetchTerms({ silent: true });
    } catch {
      setAddError("Gagal menambahkan istilah");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    setEditError(null);
    const term = editTermInput.trim();
    if (!term) {
      setEditError("Istilah wajib diisi");
      return;
    }
    setEditLoading(true);
    try {
      const res = await fetch(`/api/admin/glossary/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          term,
          commonMistakes: editMistakesInput.trim(),
          definition: editDefinitionInput.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || "Gagal memperbarui istilah");
        return;
      }
      cancelEdit();
      await fetchTerms({ silent: true });
    } catch {
      setEditError("Gagal memperbarui istilah");
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete(id: string, term: string) {
    if (!window.confirm(`Hapus istilah "${term}" dari glosarium?`)) return;

    setDeleteError(null);
    setDeletingId(id);
    if (editingId === id) cancelEdit();
    try {
      const res = await fetch(`/api/admin/glossary/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error || "Gagal menghapus istilah");
        return;
      }
      await fetchTerms({ silent: true });
    } catch {
      setDeleteError("Gagal menghapus istilah");
    } finally {
      setDeletingId(null);
    }
  }

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
          <button
            type="button"
            onClick={() => router.push("/admin/settings")}
            aria-label="Kembali ke pengaturan admin"
            className="p-2 rounded-lg text-kemenkum-blue hover:opacity-80 shrink-0"
          >
            <ArrowLeft size={24} strokeWidth={2.5} />
          </button>
          <h1 className="text-xl font-bold text-kemenkum-blue truncate">
            Glosarium Transkripsi
          </h1>
        </div>

        <section className="mb-8 text-left">
          <h2 className="text-base font-semibold text-kemenkum-blue mb-3">
            Tambah Istilah
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <input
              type="text"
              value={termInput}
              onChange={(e) => {
                setTermInput(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="Ejaan benar (contoh: Pak Sekjen)"
              disabled={addLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            />
            <input
              type="text"
              value={mistakesInput}
              onChange={(e) => {
                setMistakesInput(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="Kesalahan transkripsi (opsional, pisahkan koma)"
              disabled={addLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            />
            <input
              type="text"
              value={definitionInput}
              onChange={(e) => {
                setDefinitionInput(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="Definisi / konteks (opsional)"
              disabled={addLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={addLoading || !termInput.trim()}
              className="self-start px-6 py-2 rounded-lg bg-kemenkum-blue text-white font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
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
            Daftar Glosarium
          </h2>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari istilah, definisi, atau kesalahan…"
            className="w-full mb-4 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
          />
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
          ) : terms.length === 0 ? (
            <p className="text-sm text-gray-600">
              {searchQuery.trim()
                ? "Tidak ada istilah yang cocok dengan pencarian."
                : "Belum ada istilah dalam glosarium."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th className="px-0 py-3 pr-4 font-semibold">Term</th>
                    <th className="px-0 py-3 pr-4 font-semibold">Common Mistakes</th>
                    <th className="px-0 py-3 pr-4 font-semibold">Definition</th>
                    <th className="px-0 py-3 pr-4 font-semibold">Date Added</th>
                    <th className="px-0 py-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((item) => (
                    <Fragment key={item.id}>
                      <tr className="text-gray-900 border-b border-gray-100">
                        <td className="px-0 py-3 pr-4 font-medium align-middle">
                          {item.term}
                        </td>
                        <td className="px-0 py-3 pr-4 text-gray-600 align-middle">
                          {formatMistakes(item.commonMistakes)}
                        </td>
                        <td className="px-0 py-3 pr-4 text-gray-600 align-middle">
                          {item.definition?.trim() || "—"}
                        </td>
                        <td className="px-0 py-3 pr-4 text-gray-600 align-middle">
                          {formatGlossaryDate(item.createdAt)}
                        </td>
                        <td className="px-0 py-3 text-center align-middle">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                editingId === item.id ? cancelEdit() : startEdit(item)
                              }
                              disabled={deletingId !== null || editLoading}
                              title="Edit"
                              aria-label={`Edit ${item.term}`}
                              className="rounded-full p-1.5 text-kemenkum-blue hover:bg-kemenkum-blue/15 disabled:opacity-60"
                            >
                              <Pencil size={16} strokeWidth={2.5} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id, item.term)}
                              disabled={deletingId !== null || editLoading}
                              title="Hapus"
                              aria-label={`Hapus ${item.term}`}
                              className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50 disabled:opacity-60 inline-flex items-center"
                            >
                              {deletingId === item.id ? (
                                <span className="text-xs">…</span>
                              ) : (
                                <>
                                  <span className="sm:hidden">
                                    <Trash2 size={16} />
                                  </span>
                                  <span className="hidden sm:block">
                                    <Trash2 size={20} />
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === item.id && (
                        <tr className="border-b border-gray-100">
                          <td colSpan={5} className="px-0 py-3">
                            <form
                              onSubmit={(e) => handleEdit(e, item.id)}
                              className="flex flex-col gap-3 text-left"
                            >
                              <input
                                type="text"
                                value={editTermInput}
                                onChange={(e) => {
                                  setEditTermInput(e.target.value);
                                  if (editError) setEditError(null);
                                }}
                                placeholder="Ejaan benar"
                                disabled={editLoading}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                              />
                              <input
                                type="text"
                                value={editMistakesInput}
                                onChange={(e) => {
                                  setEditMistakesInput(e.target.value);
                                  if (editError) setEditError(null);
                                }}
                                placeholder="Kesalahan transkripsi (opsional, pisahkan koma)"
                                disabled={editLoading}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                              />
                              <input
                                type="text"
                                value={editDefinitionInput}
                                onChange={(e) => {
                                  setEditDefinitionInput(e.target.value);
                                  if (editError) setEditError(null);
                                }}
                                placeholder="Definisi / konteks (opsional)"
                                disabled={editLoading}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="submit"
                                  disabled={editLoading || !editTermInput.trim()}
                                  className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                                >
                                  {editLoading ? "Menyimpan…" : "Simpan"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  disabled={editLoading}
                                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 whitespace-nowrap"
                                >
                                  Batal
                                </button>
                              </div>
                              {editError && (
                                <p className="text-sm text-red-600" role="alert">
                                  {editError}
                                </p>
                              )}
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
