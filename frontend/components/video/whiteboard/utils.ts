import { CURSOR_COLORS } from './constants';

/**
 * Get consistent cursor color based on participant ID
 */
export function getCursorColor(participantId: string): string {
    let hash = 0;
    for (let i = 0; i < participantId.length; i++) {
        hash = participantId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

/**
 * Convert hex color string to number
 */
export function hexToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Convert screen coordinates to world/canvas coordinates
 */
export function screenToWorld(
    clientX: number,
    clientY: number,
    canvasRect: DOMRect,
    panOffset: { x: number; y: number },
    scale: number
): { x: number; y: number } {
    return {
        x: (clientX - canvasRect.left - panOffset.x) / scale,
        y: (clientY - canvasRect.top - panOffset.y) / scale,
    };
}

/**
 * Convert world/canvas coordinates to screen coordinates
 */
export function worldToScreen(
    worldX: number,
    worldY: number,
    panOffset: { x: number; y: number },
    scale: number
): { x: number; y: number } {
    return {
        x: worldX * scale + panOffset.x,
        y: worldY * scale + panOffset.y,
    };
}

/**
 * Generate custom cursor SVG for pen tool
 */
export function generatePenCursor(size: number, color: string): string {
    const r = Math.max(2, size / 2);
    const svgSize = Math.max(16, r * 2 + 4);
    const cx = svgSize / 2;
    const svg = `
        <svg xmlns='http://www.w3.org/2000/svg' height='${svgSize}' width='${svgSize}'>
            <circle cx='${cx}' cy='${cx}' r='${r}' fill='${color}' />
            <circle cx='${cx}' cy='${cx}' r='${r + 0.5}' stroke='white' stroke-width='1' fill='none' opacity='0.5'/>
        </svg>
    `.trim().replace(/\s+/g, ' ');
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${cx} ${cx}, crosshair`;
}

/**
 * Generate custom cursor SVG for eraser tool
 */
export function generateEraserCursor(size: number): string {
    const r = Math.max(4, size / 2);
    const svgSize = Math.max(16, r * 2 + 4);
    const cx = svgSize / 2;
    const svg = `
        <svg xmlns='http://www.w3.org/2000/svg' height='${svgSize}' width='${svgSize}'>
            <circle cx='${cx}' cy='${cx}' r='${r}' stroke='black' stroke-width='1' fill='white' opacity='0.8'/>
        </svg>
    `.trim().replace(/\s+/g, ' ');
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${cx} ${cx}, cell`;
}
