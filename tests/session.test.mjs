import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server");

// Exercise the actual adapter with a simulated Auth refresh; no credentials/network.
test("refresh forwards new request cookies, response cookies, and cache headers per request", async () => {
  let clients = 0;
  const source = readFileSync(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(compiled, {
    exports, Headers,
    require(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/env/public") return { getSupabasePublicEnv: () => ({ url: "https://example.supabase.co", publishableKey: "test-only" }) };
      if (name === "@/lib/supabase/cookie-options") return { sessionCookieOptions: { secure: true, sameSite: "lax" } };
      if (name === "@supabase/ssr") return {
        createServerClient(_url, _key, options) {
          const clientNumber = ++clients;
          return { auth: { async getClaims() {
            assert.equal(options.cookies.getAll()[0].value, "old");
            options.cookies.setAll([{ name: "session", value: `new-${clientNumber}`, options: { secure: true, sameSite: "lax", path: "/" } }], {
              "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
              Pragma: "no-cache",
            });
            // Later SDK writes may supply no additional cache headers.
            options.cookies.setAll([{ name: "verifier", value: "", options: { maxAge: 0, path: "/" } }], {});
            return { data: null, error: null };
          } } };
        },
      };
      return require(name);
    },
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const request = new NextRequest("https://example.com/app", { headers: { cookie: "session=old" } });
    const response = await exports.refreshSession(request);
    assert.equal(response.cookies.get("session").value, `new-${attempt}`);
    assert.equal(response.cookies.get("session").secure, true);
    assert.equal(response.cookies.get("verifier").maxAge, 0);
    assert.match(response.headers.get("x-middleware-request-cookie"), new RegExp(`session=new-${attempt}`));
    assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
    assert.equal(response.headers.get("Pragma"), "no-cache");
  }
  assert.equal(clients, 2);
});
