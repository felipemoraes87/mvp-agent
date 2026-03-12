import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, setCsrfToken } from "./api";
import type { SessionUser } from "./types";

type AuthCtx = {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const data = await apiGet<{ user: SessionUser }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiPost<{ user: SessionUser; csrfToken?: string }>("/api/auth/login", { email, password });
    if (data.csrfToken) setCsrfToken(data.csrfToken);
    setUser(data.user);
  };

  const logout = async () => {
    await apiPost<{ ok: boolean }>("/api/auth/logout", {});
    setCsrfToken("");
    setUser(null);
  };

  const value = useMemo(() => ({ user, loading, login, logout, reload }), [user, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
