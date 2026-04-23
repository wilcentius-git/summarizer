"use client";

import { useEffect, useState } from "react";

/**
 * Seconds since `active` became true; resets to 0 when `active` is false.
 */
export function useElapsedTimer(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}
