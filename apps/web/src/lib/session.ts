import { api } from "./api";

export interface Capabilities {
  image: boolean;
  video: boolean;
  audio: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
}

export interface Session {
  user: SessionUser;
  capabilities: Capabilities;
}

const NO_CAPABILITIES: Capabilities = {
  image: false,
  video: false,
  audio: false,
};

let sessionCache: Session | null | undefined;
let sessionInFlight: Promise<Session | null> | undefined;
let setupNeedsCache: boolean | undefined;

/** Called after sign-in/sign-out/setup so the next navigation re-reads state. */
export function invalidateSession() {
  sessionCache = undefined;
  sessionInFlight = undefined;
}

export function rememberNeedsSetup(value: boolean) {
  setupNeedsCache = value;
}

export async function fetchNeedsSetup(): Promise<boolean> {
  if (setupNeedsCache !== undefined) return setupNeedsCache;

  try {
    const response = await api["setup-status"].$get();
    const body = (await response.json()) as { needsSetup?: boolean };
    setupNeedsCache = body.needsSetup === true;
  } catch {
    // If the API is unreachable, do not trap the user on the setup screen.
    setupNeedsCache = false;
  }

  return setupNeedsCache;
}

export async function fetchSession(force = false): Promise<Session | null> {
  if (!force && sessionCache !== undefined) return sessionCache;
  if (!force && sessionInFlight) return sessionInFlight;

  const pending = (async () => {
    try {
      const response = await api.me.$get();

      if (response.status === 401) {
        sessionCache = null;
        return null;
      }

      if (!response.ok)
        throw new Error(`Session request failed (${response.status})`);

      const body = (await response.json()) as {
        user: SessionUser;
        capabilities?: Capabilities;
      };

      const session: Session = {
        user: body.user,
        capabilities: body.capabilities ?? NO_CAPABILITIES,
      };

      sessionCache = session;
      return session;
    } catch (error) {
      if (error instanceof Error && error.message.includes("401")) {
        sessionCache = null;
        return null;
      }
      throw error;
    } finally {
      sessionInFlight = undefined;
    }
  })();

  sessionInFlight = pending;

  return pending;
}
