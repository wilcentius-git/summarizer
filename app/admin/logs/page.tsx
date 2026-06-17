"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/app/contexts/AuthContext";

const PAGE_SIZE = 50;

type AuditLogType = "JOB" | "AUTH" | "ADMIN" | "ERROR";

type AuditLogEntry = {
  id: string;
  type: AuditLogType;
  action: string;
  userId: string | null;
  metadata: unknown;
  createdAt: string;
};

const TYPE_OPTIONS: { value: "" | AuditLogType; label: string }[] = [
  { value: "", label: "Semua" },
  { value: "JOB", label: "JOB" },
  { value: "AUTH", label: "AUTH" },
  { value: "ADMIN", label: "ADMIN" },
  { value: "ERROR", label: "ERROR" },
];

const TYPE_BADGE_CLASS: Record<AuditLogType, string> = {
  JOB: "bg-blue-100 text-blue-800",
  AUTH: "bg-green-100 text-green-800",
  ADMIN: "bg-yellow-100 text-yellow-900",
  ERROR: "bg-red-100 text-red-800",
};

function formatLogDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));
}

function MetadataDetails({ metadata }: { metadata: unknown }) {
  if (metadata == null) {
    return <span className="text-gray-400">-</span>;
  }

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    const entries = Object.entries(metadata as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-gray-400">-</span>;
    }

    const isSimple = entries.every(
      ([, value]) =>
        value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );

    if (isSimple) {
      return (
        <div className="space-y-0.5 text-xs text-gray-600">
          {entries.map(([key, value]) => (
            <div key={key}>
              <span className="font-medium">{key}:</span>{" "}
              {value == null ? "-" : String(value)}
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <details className="text-xs text-left">
      <summary className="cursor-pointer text-kemenkum-blue hover:opacity-80">
        Lihat JSON
      </summary>
      <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-left text-gray-700">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}

function TypeBadge({ type }: { type: string }) {
  const badgeClass =
    TYPE_BADGE_CLASS[type as AuditLogType] ?? "bg-gray-100 text-gray-700";

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
    >
      {type}
    </span>
  );
}

export default function AdminLogsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<"" | AuditLogType>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchLogs = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("page", String(page));

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setListError(data.error || "Gagal memuat log audit");
        setLogs([]);
        setTotal(0);
        return;
      }
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setListError("Gagal memuat log audit");
      setLogs([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [typeFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.isAdmin) {
      router.replace("/");
      return;
    }
    void fetchLogs();
  }, [authLoading, user, router, fetchLogs]);

  function handleTypeChange(value: "" | AuditLogType) {
    setTypeFilter(value);
    setPage(1);
  }

  function handleDateFromChange(value: string) {
    setDateFrom(value);
    setPage(1);
  }

  function handleDateToChange(value: string) {
    setDateTo(value);
    setPage(1);
  }

  if (authLoading || !user?.isAdmin) {
    return (
      <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
        <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
          <p className="text-sm text-gray-600">Memuat…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-kemenkum-blue py-8 px-4 flex justify-center items-center overflow-y-auto">
      <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg px-4 sm:px-8 pt-4 pb-10 mx-auto overflow-x-hidden text-center">
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
            Log Audit
          </h1>
        </div>

        <section className="mb-6 text-left">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <label
                htmlFor="type-filter"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Tipe
              </label>
              <select
                id="type-filter"
                value={typeFilter}
                onChange={(e) =>
                  handleTypeChange(e.target.value as "" | AuditLogType)
                }
                className="w-full sm:w-auto min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="date-from"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Dari tanggal
              </label>
              <input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
              />
            </div>
            <div>
              <label
                htmlFor="date-to"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Sampai tanggal
              </label>
              <input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
                className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-kemenkum-blue focus:outline-none focus:ring-1 focus:ring-kemenkum-blue"
              />
            </div>
          </div>
        </section>

        <section className="text-left">
          {listError && (
            <div
              className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-red-700 text-sm"
              role="alert"
            >
              {listError}
            </div>
          )}

          {listLoading ? (
            <p className="text-sm text-gray-600">Memuat log…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-gray-600">Tidak ada log untuk filter ini.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-700">
                      <th className="px-0 py-3 pr-4 font-semibold whitespace-nowrap">
                        Waktu
                      </th>
                      <th className="px-0 py-3 pr-4 font-semibold">Type</th>
                      <th className="px-0 py-3 pr-4 font-semibold">Action</th>
                      <th className="px-0 py-3 pr-4 font-semibold">User</th>
                      <th className="px-0 py-3 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-gray-100 text-gray-900 align-top"
                      >
                        <td className="px-0 py-3 pr-4 text-gray-600 whitespace-nowrap">
                          {formatLogDate(log.createdAt)}
                        </td>
                        <td className="px-0 py-3 pr-4">
                          <TypeBadge type={log.type} />
                        </td>
                        <td className="px-0 py-3 pr-4 font-mono text-xs">
                          {log.action}
                        </td>
                        <td className="px-0 py-3 pr-4 font-medium">
                          {log.userId ?? "-"}
                        </td>
                        <td className="px-0 py-3">
                          <MetadataDetails metadata={log.metadata} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Menampilkan {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, total)} dari {total} log
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || listLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    <ChevronLeft size={16} />
                    Sebelumnya
                  </button>
                  <span className="text-sm text-gray-600">
                    Halaman {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={page >= totalPages || listLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Berikutnya
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
