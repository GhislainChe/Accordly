export function GET() {
  return Response.json(
    { status: "ok", service: "accordly", check: "liveness" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
