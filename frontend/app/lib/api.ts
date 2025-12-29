const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface AuthResponse {
  user: {
    id: number;
    email: string;
    nickname: string;
    profile_img?: string;
    provider?: string;
  };
  expires_in: number;
}

interface UserSearchResult {
  id: number;
  email: string;
  nickname: string;
  profile_img?: string;
}

interface SearchUsersResponse {
  users: UserSearchResult[];
  total: number;
}

// HTTP-only 쿠키 기반 인증 (XSS 방지)
class ApiClient {
  private isLoggedIn: boolean = false;

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include', // 쿠키 자동 전송
    });

    if (response.status === 401) {
      // 토큰 만료 시 갱신 시도
      const refreshed = await this.refreshToken();
      if (refreshed) {
        // 재시도
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include',
        });
        if (!retryResponse.ok) {
          throw new Error('Request failed after token refresh');
        }
        return retryResponse.json();
      }
      this.isLoggedIn = false;
      throw new Error('Authentication required');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
    this.isLoggedIn = true;
    return response;
  }

  async refreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.isLoggedIn = false;
        return false;
      }

      this.isLoggedIn = true;
      return true;
    } catch {
      this.isLoggedIn = false;
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.isLoggedIn = false;
    }
  }

  async getMe(): Promise<AuthResponse['user']> {
    return this.request<AuthResponse['user']>('/auth/me');
  }

  // 서버에 인증 상태 확인 (쿠키 기반)
  async checkAuth(): Promise<boolean> {
    try {
      await this.getMe();
      this.isLoggedIn = true;
      return true;
    } catch {
      this.isLoggedIn = false;
      return false;
    }
  }

  // 유저 검색 (닉네임 또는 이메일)
  async searchUsers(query: string): Promise<SearchUsersResponse> {
    if (query.length < 2) {
      return { users: [], total: 0 };
    }
    return this.request<SearchUsersResponse>(
      `/api/users/search?q=${encodeURIComponent(query)}`
    );
  }
}

export const apiClient = new ApiClient();
export type { AuthResponse, UserSearchResult, SearchUsersResponse };
