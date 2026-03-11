"use client";

import { useAuth } from "@/app/contexts/AuthContext";

export function AuthHeader() {
  const { user, loading, logout } = useAuth();

  if (loading || !user) return null;

  return (
    <header className="bg-kemenkum-blue text-white py-2 px-4">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <span className="text-sm truncate">{user.email}</span>
        <button
          type="button"
          onClick={logout}
          className="text-sm font-medium px-3 py-1 rounded hover:bg-white/10"
        >
          Keluar
        </button>
      </div>
    </header>
  );
}
