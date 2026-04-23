"use client";

import { useCallback, useState } from "react";

const GROQ_API_KEY_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const GROQ_API_KEY_CACHE_KEY = "groqApiKeyCache";

function loadCachedGroqApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = sessionStorage.getItem(GROQ_API_KEY_CACHE_KEY);
    if (!stored) return "";
    const { key, expiresAt } = JSON.parse(stored) as { key?: string; expiresAt?: number };
    if (key && expiresAt && Date.now() < expiresAt) return key;
    sessionStorage.removeItem(GROQ_API_KEY_CACHE_KEY);
  } catch {
    sessionStorage.removeItem(GROQ_API_KEY_CACHE_KEY);
  }
  return "";
}

function saveGroqApiKeyToCache(key: string) {
  if (typeof window === "undefined" || !key.trim()) return;
  const cache = { key: key.trim(), expiresAt: Date.now() + GROQ_API_KEY_CACHE_DURATION_MS };
  sessionStorage.setItem(GROQ_API_KEY_CACHE_KEY, JSON.stringify(cache));
}

export function useGroqApiKey() {
  const [groqApiKey, setGroqApiKey] = useState(loadCachedGroqApiKey);

  const updateKey = useCallback((key: string) => {
    setGroqApiKey(key);
    if (key.trim()) saveGroqApiKeyToCache(key);
    else if (typeof window !== "undefined") {
      sessionStorage.removeItem(GROQ_API_KEY_CACHE_KEY);
    }
  }, []);

  return { groqApiKey, setGroqApiKey: updateKey };
}
