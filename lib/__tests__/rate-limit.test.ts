import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

function makeRequest(ip: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    const req = makeRequest("10.0.0.1");
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(req);
      expect(result).toBeNull();
    }
  });

  it("blocks requests over the limit", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 11; i++) {
      checkRateLimit(makeRequest(ip));
    }
    const result = checkRateLimit(makeRequest(ip));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("isolates different IPs", () => {
    for (let i = 0; i < 11; i++) {
      checkRateLimit(makeRequest("10.0.0.3"));
    }
    const result = checkRateLimit(makeRequest("10.0.0.4"));
    expect(result).toBeNull();
  });
});
