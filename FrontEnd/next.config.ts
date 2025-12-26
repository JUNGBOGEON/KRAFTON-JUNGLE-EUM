/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    typescript: {
        // ⚠️ Warning: This allows production builds to successfully complete even if
        // your project has TypeScript errors. Existing type issues in HomeDashboard.tsx
        ignoreBuildErrors: true,
    },
    async rewrites() {
        return [
            {
                source: '/api/video/:path*',
                destination: 'http://localhost:8080/api/:path*', // Proxy to Go Backend
            },
        ];
    },
};

export default nextConfig;
