import React from "react";

interface StatusIndicatorProps {
    status: string; // "online", "idle", "dnd", "offline"
    size?: "sm" | "md" | "lg";
    className?: string;
}

export default function StatusIndicator({ status, size = "md", className = "" }: StatusIndicatorProps) {
    let colorClass = "bg-gray-400"; // offline

    switch (status) {
        case "online":
            colorClass = "bg-green-500";
            break;
        case "idle":
            colorClass = "bg-yellow-500";
            break;
        case "dnd":
            colorClass = "bg-red-500";
            break;
        case "offline":
        default:
            colorClass = "bg-gray-400";
            break;
    }

    const sizeClass = {
        sm: "w-2 h-2",
        md: "w-3 h-3",
        lg: "w-4 h-4"
    }[size];

    return (
        <span
            className={`rounded-full border-2 border-white ${colorClass} ${sizeClass} ${className}`}
            title={status}
        />
    );
}
