export default function Loading() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
            <img
                src="/kor_eum_black.png"
                alt="Loading"
                className="w-12 h-12 animate-pulse"
            />
            <p className="text-black/50 text-sm">Global Loading...</p>
        </div>
    );
}
