"use client";

import { ArrowLeft, ChevronRight, Eye, EyeOff, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";

type SatuanKerjaOption = {
  id: string;
  name: string;
  createdAt: string;
  groqApiKeyMasked?: string | null;
};

type WhitelistEntry = {
  nip: string;
  createdAt: string;
  satuanKerjaId: string | null;
  satuanKerja: { id: string; name: string } | null;
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

  const [units, setUnits] = useState<SatuanKerjaOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [unitsError, setUnitsError] = useState<string | null>(null);

  const [satuanKerjaExpanded, setSatuanKerjaExpanded] = useState(false);
  const [unitNameInput, setUnitNameInput] = useState("");
  const [unitGroqKeyInput, setUnitGroqKeyInput] = useState("");
  const [showUnitGroqKey, setShowUnitGroqKey] = useState(false);
  const [showEditGroqKey, setShowEditGroqKey] = useState(false);
  const [unitAddLoading, setUnitAddLoading] = useState(false);
  const [unitAddError, setUnitAddError] = useState<string | null>(null);
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [unitDeleteError, setUnitDeleteError] = useState<string | null>(null);
  const [groqKeyInputs, setGroqKeyInputs] = useState<Record<string, string>>({});
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [savingGroqKeyUnitId, setSavingGroqKeyUnitId] = useState<string | null>(null);
  const [groqKeySaveError, setGroqKeySaveError] = useState<string | null>(null);

  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [nipInput, setNipInput] = useState("");
  const [addSatuanKerjaId, setAddSatuanKerjaId] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingNip, setDeletingNip] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [updatingNip, setUpdatingNip] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const fetchUnits = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setUnitsLoading(true);
    setUnitsError(null);
    try {
      const res = await fetch("/api/admin/satuan-kerja", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setUnitsError(data.error || "Gagal memuat satuan kerja");
        setUnits([]);
        return;
      }
      setUnits(data.units ?? []);
    } catch {
      setUnitsError("Gagal memuat satuan kerja");
      setUnits([]);
    } finally {
      setUnitsLoading(false);
    }
  }, []);

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
    fetchUnits();
    fetchEntries();
  }, [authLoading, user, router, fetchUnits, fetchEntries]);

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    setUnitAddError(null);
    const trimmed = unitNameInput.trim();
    const groqKeyTrimmed = unitGroqKeyInput.trim();
    if (!trimmed) {
      setUnitAddError("Nama satuan kerja wajib diisi");
      return;
    }
    if (!groqKeyTrimmed) {
      setUnitAddError("Groq API key wajib diisi");
      return;
    }

    setUnitAddLoading(true);
    try {
      const res = await fetch("/api/admin/satuan-kerja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed, groqApiKey: groqKeyTrimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUnitAddError(data.error || "Gagal menambahkan satuan kerja");
        return;
      }
      setUnitNameInput("");
      setUnitGroqKeyInput("");
      if (data.unit) {
        setUnits((prev) =>
          [...prev, data.unit].sort((a, b) => a.name.localeCompare(b.name))
        );
      } else {
        await fetchUnits({ silent: true });
      }
    } catch {
      setUnitAddError("Gagal menambahkan satuan kerja");
    } finally {
      setUnitAddLoading(false);
    }
  }

  async function handleSaveGroqApiKey(unit: SatuanKerjaOption) {
    setGroqKeySaveError(null);
    setSavingGroqKeyUnitId(unit.id);
    try {
      const rawKey = groqKeyInputs[unit.id] ?? "";
      const res = await fetch(
        `/api/admin/satuan-kerja/${encodeURIComponent(unit.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ groqApiKey: rawKey.trim() || null }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setGroqKeySaveError(data.error || "Gagal menyimpan kunci API");
        return;
      }
      setUnits((prev) =>
        prev.map((u) =>
          u.id === unit.id
            ? { ...u, groqApiKeyMasked: data.unit.groqApiKeyMasked }
            : u
        )
      );
      setGroqKeyInputs((prev) => {
        const next = { ...prev };
        delete next[unit.id];
        return next;
      });
    } catch {
      setGroqKeySaveError("Gagal menyimpan kunci API");
    } finally {
      setSavingGroqKeyUnitId(null);
    }
  }

  async function handleDeleteUnit(unit: SatuanKerjaOption) {
    if (!window.confirm(`Hapus satuan kerja "${unit.name}"?`)) return;

    setUnitDeleteError(null);
    setDeletingUnitId(unit.id);
    try {
      const res = await fetch(
        `/api/admin/satuan-kerja/${encodeURIComponent(unit.id)}`,
        { method: "DELETE", credentials: "include" }
      );
      const data = await res.json();
      if (!res.ok) {
        setUnitDeleteError(data.error || "Gagal menghapus satuan kerja");
        return;
      }
      await fetchUnits({ silent: true });
      await fetchEntries({ silent: true });
    } catch {
      setUnitDeleteError("Gagal menghapus satuan kerja");
    } finally {
      setDeletingUnitId(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const trimmed = nipInput.trim();
    if (!trimmed) {
      setAddError("NIP wajib diisi");
      return;
    }
    if (!/^\d{18}$/.test(trimmed)) {
      setAddError("NIP harus terdiri dari 18 digit angka");
      return;
    }
    if (!addSatuanKerjaId) {
      setAddError("Satuan kerja wajib dipilih");
      return;
    }

    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nip: trimmed,
          satuanKerjaId: addSatuanKerjaId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Gagal menambahkan NIP");
        return;
      }
      setNipInput("");
      setAddSatuanKerjaId("");
      await fetchEntries({ silent: true });
    } catch {
      setAddError("Gagal menambahkan NIP");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleSatuanKerjaChange(nip: string, satuanKerjaId: string) {
    if (!satuanKerjaId) return;

    setUpdateError(null);
    setUpdatingNip(nip);
    try {
      const res = await fetch(
        `/api/admin/whitelist/${encodeURIComponent(nip)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ satuanKerjaId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setUpdateError(data.error || "Gagal memperbarui satuan kerja");
        await fetchEntries({ silent: true });
        return;
      }
      await fetchEntries({ silent: true });
    } catch {
      setUpdateError("Gagal memperbarui satuan kerja");
      await fetchEntries({ silent: true });
    } finally {
      setUpdatingNip(null);
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
          <button
            type="button"
            onClick={() => setSatuanKerjaExpanded(!satuanKerjaExpanded)}
            aria-expanded={satuanKerjaExpanded}
            className="flex items-center justify-start gap-2 w-full py-2 text-base font-semibold text-kemenkum-blue rounded-lg"
          >
            <ChevronRight
              size={20}
              strokeWidth={2.5}
              className={`transition-transform duration-300 ${satuanKerjaExpanded ? "rotate-90" : "rotate-0"}`}
            />
            Kelola Satuan Kerja
          </button>
          <div
            className={`mt-3 overflow-hidden transition-all duration-300 ease-in-out ${satuanKerjaExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}
          >
              <form onSubmit={handleAddUnit} className="flex flex-col gap-3 mb-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={unitNameInput}
                    onChange={(e) => {
                      setUnitNameInput(e.target.value);
                      if (unitAddError) setUnitAddError(null);
                    }}
                    placeholder="Nama satuan kerja"
                    disabled={unitAddLoading}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                  />
                  <div className="relative flex-1">
                    <input
                      type={showUnitGroqKey ? "text" : "password"}
                      value={unitGroqKeyInput}
                      onChange={(e) => {
                        setUnitGroqKeyInput(e.target.value);
                        if (unitAddError) setUnitAddError(null);
                      }}
                      placeholder="Groq API key (gsk_...)"
                      disabled={unitAddLoading}
                      autoComplete="off"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowUnitGroqKey((v) => !v)}
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showUnitGroqKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={
                    unitAddLoading ||
                    !unitNameInput.trim() ||
                    !unitGroqKeyInput.trim()
                  }
                  className="self-start px-6 py-2 rounded-lg bg-kemenkum-blue text-white font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                >
                  {unitAddLoading ? "Menambahkan…" : "Tambah Satuan Kerja"}
                </button>
              </form>
              {unitAddError && (
                <p className="mb-3 text-sm text-red-600" role="alert">
                  {unitAddError}
                </p>
              )}
              {unitDeleteError && (
                <p className="mb-3 text-sm text-red-600" role="alert">
                  {unitDeleteError}
                </p>
              )}
              {unitsError && (
                <p className="mb-3 text-sm text-red-600" role="alert">
                  {unitsError}
                </p>
              )}
              {unitsLoading ? (
                <p className="text-sm text-gray-600">Memuat satuan kerja…</p>
              ) : units.length === 0 ? (
                <p className="text-sm text-gray-600">
                  Belum ada satuan kerja. Tambahkan satuan kerja sebelum menetapkan NIP.
                </p>
              ) : (
                <div className="space-y-3">
                  {groqKeySaveError && (
                    <p className="text-sm text-red-600" role="alert">
                      {groqKeySaveError}
                    </p>
                  )}
                  {units.map((unit, index) => (
                    <div
                      key={unit.id}
                      className={
                        index < units.length - 1
                          ? "border-b border-gray-100 pb-3"
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-3 py-2 text-left">
                        <span className="text-sm font-medium text-gray-800 shrink-0">
                          {unit.name}
                        </span>
                        {unit.groqApiKeyMasked ? (
                          <span className="flex-1 min-w-0 font-mono text-xs text-gray-500 truncate">
                            {unit.groqApiKeyMasked}
                          </span>
                        ) : (
                          <span className="flex-1 min-w-0 text-xs text-gray-400 italic">
                            Belum ada kunci
                          </span>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setEditingUnitId(unit.id)}
                            disabled={savingGroqKeyUnitId !== null}
                            aria-label={`Edit kunci ${unit.name}`}
                            className="rounded-full p-0.5 text-kemenkum-blue hover:bg-kemenkum-blue/15 disabled:opacity-60"
                          >
                            <Pencil size={14} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUnit(unit)}
                            disabled={deletingUnitId !== null}
                            aria-label={`Hapus ${unit.name}`}
                            className="rounded-full p-0.5 text-kemenkum-blue hover:bg-kemenkum-blue/15 disabled:opacity-60"
                          >
                            {deletingUnitId === unit.id ? (
                              <span className="text-xs px-0.5">…</span>
                            ) : (
                              <X size={14} strokeWidth={2.5} />
                            )}
                          </button>
                        </div>
                      </div>
                      {editingUnitId === unit.id && (
                        <div className="flex flex-col sm:flex-row gap-2 pb-2 text-left">
                          <div className="relative flex-1">
                            <input
                              type={showEditGroqKey ? "text" : "password"}
                              value={groqKeyInputs[unit.id] ?? ""}
                              onChange={(e) => {
                                setGroqKeyInputs((prev) => ({
                                  ...prev,
                                  [unit.id]: e.target.value,
                                }));
                                if (groqKeySaveError) setGroqKeySaveError(null);
                              }}
                              placeholder="gsk_..."
                              disabled={savingGroqKeyUnitId !== null}
                              autoComplete="off"
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditGroqKey((v) => !v)}
                              tabIndex={-1}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {showEditGroqKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void (async () => {
                                await handleSaveGroqApiKey(unit);
                                setTimeout(() => {
                                  setGroqKeyInputs((inputs) => {
                                    if (!(unit.id in inputs)) {
                                      setEditingUnitId((id) =>
                                        id === unit.id ? null : id
                                      );
                                    }
                                    return inputs;
                                  });
                                }, 0);
                              })();
                            }}
                            disabled={savingGroqKeyUnitId !== null}
                            className="px-4 py-2 rounded-lg bg-kemenkum-blue text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                          >
                            {savingGroqKeyUnitId === unit.id
                              ? "Menyimpan…"
                              : "Simpan"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUnitId(null);
                              setGroqKeyInputs((prev) => {
                                const next = { ...prev };
                                delete next[unit.id];
                                return next;
                              });
                            }}
                            disabled={savingGroqKeyUnitId !== null}
                            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 whitespace-nowrap"
                          >
                            Batal
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
        </section>

        <section className="mb-8 text-left">
          <h2 className="text-base font-semibold text-kemenkum-blue mb-3">
            Tambah NIP
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              maxLength={18}
              value={nipInput}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "");
                setNipInput(val);
                if (addError) setAddError(null);
              }}
              placeholder="Masukkan NIP"
              disabled={addLoading}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            />
            <select
              value={addSatuanKerjaId}
              onChange={(e) => setAddSatuanKerjaId(e.target.value)}
              disabled={addLoading || units.length === 0}
              className="w-fit max-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
            >
              <option value="" disabled>
                Pilih Satuan Kerja
              </option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={addLoading || !nipInput.trim() || !addSatuanKerjaId}
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
          {updateError && (
            <div
              className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-red-700 text-sm"
              role="alert"
            >
              {updateError}
            </div>
          )}
          {listLoading ? (
            <p className="text-sm text-gray-600">Memuat daftar…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-600">Belum ada NIP dalam whitelist.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-700">
                    <th className="px-0 py-3 pr-4 font-semibold">NIP</th>
                    <th className="px-0 py-3 pr-4 font-semibold">Satuan Kerja</th>
                    <th className="px-0 py-3 pr-4 font-semibold">
                      Tanggal Ditambahkan
                    </th>
                    <th className="px-0 py-3 font-semibold text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.nip} className="text-gray-900 border-b border-gray-100">
                      <td className="px-0 py-3 pr-4 font-medium align-middle">
                        {entry.nip}
                      </td>
                      <td className="px-0 py-3 pr-4 align-middle">
                        <select
                          value={entry.satuanKerjaId ?? ""}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next && next !== entry.satuanKerjaId) {
                              void handleSatuanKerjaChange(entry.nip, next);
                            }
                          }}
                          disabled={updatingNip !== null || units.length === 0}
                          className="w-fit max-w-[180px] rounded-lg border border-gray-300 px-2 py-1.5 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue disabled:opacity-60"
                        >
                          {!entry.satuanKerjaId && (
                            <option value="" disabled>
                              Pilih Satuan Kerja
                            </option>
                          )}
                          {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-0 py-3 pr-4 text-gray-600 align-middle">
                        {formatWhitelistDate(entry.createdAt)}
                      </td>
                      <td className="px-0 py-3 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.nip)}
                          disabled={deletingNip !== null}
                          className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 text-sm font-medium hover:bg-rose-50 disabled:opacity-60 whitespace-nowrap"
                        >
                          {deletingNip === entry.nip ? "Menghapus…" : "Hapus"}
                        </button>
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
