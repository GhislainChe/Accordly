// Browser SDKs need readable cookies. Production transport must use HTTPS.
export const sessionCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
