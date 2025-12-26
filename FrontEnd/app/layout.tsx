import type { Metadata } from "next";
import "./globals.css";
import { AppProvider } from "@/providers/AppProvider";

export const metadata: Metadata = {
    title: "셈플 - Dashboard",
    description: "Modern workspace dashboard application",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ko" suppressHydrationWarning>
            <body suppressHydrationWarning>
                <AppProvider>
                    {children}
                </AppProvider>
            </body>
        </html>
    );
}
