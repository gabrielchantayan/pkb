'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from '@/lib/api';

interface User {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: User | null;
  is_loading: boolean;
  is_authenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'pkb_auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, set_user] = useState<User | null>(null);
  const [is_loading, set_is_loading] = useState(true);

  useEffect(() => {
    const stored_token = localStorage.getItem(TOKEN_KEY);
    if (stored_token) {
      api.set_token(stored_token);
      api.get_me()
        .then((user_data) => {
          set_user(user_data);
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          api.set_token(null);
        })
        .finally(() => {
          set_is_loading(false);
        });
    } else {
      set_is_loading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    api.set_token(response.token);
    localStorage.setItem(TOKEN_KEY, response.token);
    set_user(response.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore logout errors
    }
    api.set_token(null);
    localStorage.removeItem(TOKEN_KEY);
    set_user(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        is_loading,
        is_authenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
