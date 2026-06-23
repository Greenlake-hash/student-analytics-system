import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, getDevUserEmail, isFirebaseEnabled, setDevUserEmail } from "@/lib/api-client";
import type { Me } from "@/lib/types";

interface AuthContextValue {
  user: Me | null;
  isLoading: boolean;
  /** Dev mode only: switches identity by email and re-fetches /me. No-op (logs a warning) in real-auth mode. */
  signInAsDevUser: (email: string) => Promise<void>;
  signOut: () => void;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    setIsLoading(true);
    try {
      const me = await api.get<Me>("/me");
      setUser(me);
    } catch (error) {
      // 401 just means "not signed in yet" -- not an error worth surfacing.
      // Anything else (network failure, 500) we still treat as signed-out
      // rather than crash the app shell, since every page already handles
      // user === null by showing a sign-in prompt.
      if (!(error instanceof ApiError) || error.status !== 401) {
        console.error("Failed to resolve current user:", error);
      }
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // In dev mode, only attempt /me if a dev identity was already chosen
    // (otherwise every page load would 401-log on first visit, which is
    // expected but noisy). In real mode, Firebase's own session
    // persistence determines whether there's anything to resolve.
    if (!isFirebaseEnabled && !getDevUserEmail()) {
      setIsLoading(false);
      return;
    }
    void fetchMe();
  }, [fetchMe]);

  const signInAsDevUser = useCallback(
    async (email: string) => {
      if (isFirebaseEnabled) {
        console.warn("signInAsDevUser called while Firebase auth is enabled -- this is a no-op outside dev mode.");
        return;
      }
      setDevUserEmail(email);
      await fetchMe();
    },
    [fetchMe],
  );

  const signOut = useCallback(() => {
    setDevUserEmail(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, signInAsDevUser, signOut, refetch: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
