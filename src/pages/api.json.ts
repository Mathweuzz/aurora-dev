// src/pages/api.json.ts
// Endpoint estático com informações mínimas de build/cache.
import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const cachePath = path.join("src", "data", "github.cache.json");
  let payload: any = {
    name: "Aurora.dev",
    builtAt: new Date().toISOString(),
    cache: { exists: false }
  };
  if (fs.existsSync(cachePath)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      payload.cache = {
        exists: true,
        user: cache.user,
        fetchedAt: cache.fetchedAt,
        repos: cache.repos?.length ?? 0,
        events: cache.events?.length ?? 0,
        prs: cache.prs?.length ?? 0
      };
    } catch {
      payload.cache = { exists: false, error: "invalid_json" };
    }
  }
  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}