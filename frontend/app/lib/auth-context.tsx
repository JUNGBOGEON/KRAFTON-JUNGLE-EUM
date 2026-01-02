"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { apiClient, AuthResponse } from "./api";

interface User {
  id: number;
  email: string;
  nickname: string;
  profileImg?: string;
  provider?: string;
  default_status?: string;
  custom_status_text?: string;
  custom_status_emoji?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 재시도 헬퍼 함수
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 500
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        // 지수 백오프: 500ms, 1000ms, 2000ms...
        await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isLoginInProgress = useRef(false);

  const refreshUser = useCallback(async () => {
    console.log("[AuthProvider] refreshUser calling getMe...");
    try {
      const userData = await apiClient.getMe();
      console.log("[AuthProvider] getMe success:", userData);
      setUser({
        id: userData.id,
        email: userData.email,
        nickname: userData.nickname,
        profileImg: userData.profile_img,
        provider: userData.provider,
        default_status: userData.default_status,
        custom_status_text: userData.custom_status_text,
        custom_status_emoji: userData.custom_status_emoji,
      });
    } catch (e: any) {
      if (e.message === 'Authentication required') {
        // Not logged in - this is expected behavior for guests
        console.log("[AuthProvider] User is not logged in (Session check completed)");
      } else {
        console.error("[AuthProvider] getMe failed:", e);
      }
      setUser(null);
    } finally {
      console.log("[AuthProvider] refreshUser finally. Setting isLoading false.");
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();

    // Safety timeout: Should be sufficient time for backend to respond.
    // Reduced to 3000ms (3s) to improve UX in case of failure.
    const timer = setTimeout(() => {
      setIsLoading(prev => {
        if (prev) {
          console.warn("[AuthProvider] Safety timeout triggered (3s). Forcing isLoading to false.");
          return false;
        }
        return prev;
      });
    }, 10000);

    return () => clearTimeout(timer);
  }, [refreshUser]);

  const loginWithGoogle = async (idToken: string) => {
    // 중복 로그인 요청 방지
    if (isLoginInProgress.current) {
      console.warn("Login already in progress");
      return;
    }

    isLoginInProgress.current = true;
    setIsLoading(true);

    try {
      // 재시도 로직으로 일시적 실패 대응
      const response: AuthResponse = await retryWithBackoff(
        () => apiClient.loginWithGoogle(idToken),
        3,
        500
      );

      setUser({
        id: response.user.id,
        email: response.user.email,
        nickname: response.user.nickname,
        profileImg: response.user.profile_img,
        provider: response.user.provider,
        default_status: response.user.default_status,
        custom_status_text: response.user.custom_status_text,
        custom_status_emoji: response.user.custom_status_emoji,
      });
    } catch (error) {
      console.error("Google login failed:", error);
      throw error; // 에러를 다시 던져서 호출자가 처리할 수 있게 함
    } finally {
      isLoginInProgress.current = false;
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiClient.logout();
      await apiClient.checkAuth(); // 쿠키 삭제 등을 확실히 하기 위해 (선택적)
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        loginWithGoogle,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
