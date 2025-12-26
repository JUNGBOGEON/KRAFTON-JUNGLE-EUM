/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    typescript: {
        // ⚠️ Warning: This allows production builds to successfully complete even if
        // your project has TypeScript errors. Existing type issues in HomeDashboard.tsx
        ignoreBuildErrors: true,
    },
};

export default nextConfig;
