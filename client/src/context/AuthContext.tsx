import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthStatus, type AuthUser } from "@/lib/api";

interface AuthContextValue {
  loading: boolean;
  status: AuthStatus | null;
  user: AuthUser | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const refresh = async () => {
    const data = await api.status();
    setStatus(data);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ loading, status, user: status?.user ?? null, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
