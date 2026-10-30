const origins = (process.env.CORS_ORIGINS ?? "http://localhost:5560")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Browser origins allowed to call the API (and to authenticate against it). */
export const allowedOrigins = origins;

export const apiPort = Number(process.env.PORT ?? 5561);

/** Public origin of this API. Used by better-auth to build callback URLs. */
export const authBaseUrl =
  process.env.BETTER_AUTH_URL ?? `http://localhost:${apiPort}`;

export const authSecret =
  process.env.BETTER_AUTH_SECRET ??
  "higgs-proxy-dev-secret-change-in-production";

if (!process.env.BETTER_AUTH_SECRET) {
  console.warn(
    "[auth] BETTER_AUTH_SECRET is not set; using an insecure development secret. Set it before exposing this instance.",
  );
}
