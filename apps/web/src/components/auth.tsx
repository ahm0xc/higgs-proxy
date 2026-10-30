import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { Session } from "~/lib/session";

const AuthContext = createContext<Session | null | undefined>(undefined);

export function AuthProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}

/** The current session, or `null` when signed out. */
export function useAuth(): Session | null {
  const session = useContext(AuthContext);

  if (session === undefined) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  return session;
}

type AuthChildren = ReactNode | ((session: Session) => ReactNode);

/**
 * Renders its children only for signed-in users. Pass a function to receive
 * the session without a null check: `<SignedIn>{(s) => s.user.name}</SignedIn>`.
 */
export function SignedIn({ children }: { children: AuthChildren }) {
  const session = useAuth();

  if (!session) return null;

  return <>{typeof children === "function" ? children(session) : children}</>;
}

/** Renders its children only when there is no session. */
export function SignedOut({ children }: { children: ReactNode }) {
  const session = useAuth();

  return session ? null : <>{children}</>;
}
