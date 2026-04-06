"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-kemenkum-blue flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg px-6 py-8 text-center">
        <h2 className="text-xl font-bold text-red-700 mb-2">Terjadi Kesalahan</h2>
        <p className="text-gray-600 mb-4">
          {error.message || "Sesuatu yang tidak terduga terjadi."}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-kemenkum-blue text-white font-medium hover:opacity-90"
        >
          Coba Lagi
        </button>
      </div>
    </main>
  );
}
