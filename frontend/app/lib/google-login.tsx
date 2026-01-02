"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import { useAuth } from "./auth-context";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleInitConfig) => void;
          renderButton: (element: HTMLElement, config: GoogleButtonConfig) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface GoogleInitConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GoogleButtonConfig {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}

interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

interface GoogleLoginButtonProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  buttonText?: "signin_with" | "signup_with" | "continue_with" | "signin";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  width?: number;
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export function GoogleLoginButton({
  onSuccess,
  onError,
  buttonText = "continue_with",
  theme = "filled_black",
  size = "large",
  width = 280,
}: GoogleLoginButtonProps) {
  const { loginWithGoogle } = useAuth();
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      try {
        await loginWithGoogle(response.credential);
        onSuccess?.();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("Login failed"));
      }
    },
    [loginWithGoogle, onSuccess, onError]
  );

  useEffect(() => {
    let isMounted = true;

    // 스크립트 로드 확인 (비동기로 상태 업데이트하여 cascade 방지)
    if (window.google) {
      Promise.resolve().then(() => {
        if (isMounted) setIsScriptLoaded(true);
      });
      return () => { isMounted = false; };
    }

    // Google Identity Services 스크립트 로드
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (isMounted) {
        setIsScriptLoaded(true);
      }
    };
    document.body.appendChild(script);

    return () => {
      isMounted = false;
      // 스크립트 제거하지 않음 (다른 컴포넌트에서 사용할 수 있음)
    };
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !window.google || !GOOGLE_CLIENT_ID) return;

    const buttonContainer = document.getElementById("google-login-button");
    if (!buttonContainer) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(buttonContainer, {
      type: "standard",
      theme,
      size,
      text: buttonText,
      shape: "rectangular",
      logo_alignment: "left",
      width,
      locale: "ko",
    });
  }, [isScriptLoaded, handleCredentialResponse, buttonText, theme, size, width]);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="text-red-500 text-sm">
        Google Client ID가 설정되지 않았습니다.
      </div>
    );
  }

  return <div id="google-login-button" className="flex justify-center" />;
}

// 커스텀 스타일 버튼 (Google 버튼 대신 사용 가능)
export function CustomGoogleLoginButton({
  onSuccess,
  onError,
  className = "",
  children,
}: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const { loginWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const hiddenButtonRef = useRef<HTMLDivElement>(null);
  const buttonId = useRef(`google-btn-${Math.random().toString(36).substr(2, 9)}`);

  // Google Identity Services 스크립트 로드 및 숨겨진 버튼 렌더링
  useEffect(() => {
    let isMounted = true;

    const initializeGoogle = () => {
      if (!isMounted || !window.google || !GOOGLE_CLIENT_ID || !hiddenButtonRef.current) return;

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: GoogleCredentialResponse) => {
          if (!isMounted) return;
          try {
            setIsLoading(true);
            await loginWithGoogle(response.credential);
            onSuccess?.();
          } catch (error) {
            onError?.(error instanceof Error ? error : new Error("Login failed"));
          } finally {
            if (isMounted) {
              setIsLoading(false);
            }
          }
        },
        auto_select: false,
      });

      // 숨겨진 Google 버튼 렌더링
      window.google.accounts.id.renderButton(hiddenButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: 200,
      });

      if (isMounted) {
        setIsScriptLoaded(true);
      }
    };

    if (window.google) {
      initializeGoogle();
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initializeGoogle;
      document.body.appendChild(script);
    }

    return () => {
      isMounted = false;
    };
  }, [loginWithGoogle, onSuccess, onError]);

  const handleClick = useCallback(() => {
    // 숨겨진 Google 버튼 클릭
    const googleButton = hiddenButtonRef.current?.querySelector('div[role="button"]') as HTMLElement;
    if (googleButton) {
      // Chrome 호환성: dispatchEvent 사용
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      googleButton.dispatchEvent(clickEvent);
    }
  }, []);

  return (
    <div className="relative inline-block">
      {/* 숨겨진 Google 버튼 - 실제 클릭 영역 */}
      <div
        ref={hiddenButtonRef}
        id={buttonId.current}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: 0.01,
          zIndex: 1,
        }}
      />
      {/* 커스텀 버튼 - 시각적 표시 */}
      <button
        onClick={handleClick}
        disabled={isLoading || !isScriptLoaded}
        className={`flex items-center justify-center gap-3 ${className}`}
        style={{ position: 'relative', zIndex: 0 }}
      >
        {isLoading ? (
          <img
            src="/kor_eum_black.png"
            alt="Loading"
            className="w-5 h-5 animate-pulse"
          />
        ) : (
          <>
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {children || "Google로 계속하기"}
          </>
        )}
      </button>
    </div>
  );
}
