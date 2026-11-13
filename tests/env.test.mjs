import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSupabasePublicEnv } from "../src/lib/env/public.ts";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_URL", originalUrl],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", originalKey],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("missing configuration fails without exposing input", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.throws(getSupabasePublicEnv, /Set a valid Supabase URL/);
});

test("public configuration rejects secret and legacy JWT key formats", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  for (const key of ["sb_secret_test_only_not_a_real_key", "eyJ_test_only_not_a_real_jwt"]) {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
    assert.throws(getSupabasePublicEnv, (error) => {
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
});

test("malformed and non-HTTP URLs fail with a controlled error", () => {
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_only_not_a_real_key";
  for (const url of ["invalid", "javascript:alert(1)", "ftp://example.com", "http://example.com", "https://user:password@example.com"]) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    assert.throws(getSupabasePublicEnv, /Set a valid Supabase URL/);
  }
});

test("publishable configuration accepts hosted and local Supabase URLs", () => {
  const publishableKey = "sb_publishable_test_only_not_a_real_key";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  for (const url of ["https://example.supabase.co", "http://127.0.0.1:54321"]) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    assert.deepEqual(getSupabasePublicEnv(), { url, publishableKey });
  }
});
