import { Point } from './utils';
import { DrawEvent } from './types';

// SHAPE RECOGNITION UTILITIES (Proposal Section 6.1)

interface ShapeResult {
    type: 'circle' | 'rectangle' | 'triangle' | 'none';
    score: number;
    correctedPoints?: Point[]; // If recognized, return perfect shape points
}

// 1. Geometric Helpers

const getBoundingBox = (points: Point[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

const getDistance = (p1: Point, p2: Point) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const getPolygonLength = (points: Point[]) => {
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
        length += getDistance(points[i], points[i + 1]);
    }
    // Close the loop for calculation
    length += getDistance(points[points.length - 1], points[0]);
    return length;
};

// Shoelace Formula
const getPolygonArea = (points: Point[]) => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
};

// Monotone Chain Algorithm for Convex Hull
const getConvexHull = (points: Point[]): Point[] => {
    if (points.length < 3) return points;

    const sorted = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

    const cross = (o: Point, a: Point, b: Point) => {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    };

    const lower: Point[] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }

    const upper: Point[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }

    upper.pop();
    lower.pop();
    return [...lower, ...upper];
};

// 2. Shape Generators

const generatePerfectCircle = (box: ReturnType<typeof getBoundingBox>, pointsCount: number = 60): Point[] => {
    const centerX = box.minX + box.width / 2;
    const centerY = box.minY + box.height / 2;
    const radiusX = box.width / 2;
    const radiusY = box.height / 2; // Support Ellipse

    const points: Point[] = [];
    for (let i = 0; i <= pointsCount; i++) {
        const theta = (i / pointsCount) * 2 * Math.PI;
        points.push({
            x: centerX + radiusX * Math.cos(theta),
            y: centerY + radiusY * Math.sin(theta)
        });
    }
    return points;
};

const generatePerfectRectangle = (box: ReturnType<typeof getBoundingBox>): Point[] => {
    return [
        { x: box.minX, y: box.minY }, // Top-Left
        { x: box.maxX, y: box.minY }, // Top-Right
        { x: box.maxX, y: box.maxY }, // Bottom-Right
        { x: box.minX, y: box.maxY }, // Bottom-Left
        { x: box.minX, y: box.minY }  // Close Loop
    ];
};

// 3. Main Recognition Function

export const detectShape = (points: Point[]): ShapeResult => {
    if (points.length < 10) return { type: 'none', score: 0 };

    // A. Check Closure
    // REMOVED STRICT CLOSURE CHECK to allow "C" shapes, "U" shapes, and spirals to be recognized as Circles/Rectangles.
    // We rely on Hull/Box Ratio to filter out straight lines (Ratio ~ 0).
    /*
    const start = points[0];
    const end = points[points.length - 1];
    const distance = getDistance(start, end);
    const box = getBoundingBox(points);
    const maxDim = Math.max(box.width, box.height);
    if (distance > maxDim * 0.4) {
        return { type: 'none', score: 0 };
    }
    */

    const box = getBoundingBox(points);
    const hull = getConvexHull(points);
    const hullArea = getPolygonArea(hull);
    const hullPerimeter = getPolygonLength(hull);
    const boxArea = box.width * box.height;

    // Avoid division by zero or tiny shapes (safeguard against straight lines)
    if (hullArea < 50) return { type: 'none', score: 0 };

    // B. Ratio Analysis
    const boxRatio = hullArea / boxArea;
    // Rectangle: Hull is Box => Ratio ~ 1.0
    // Ellipse: Ratio = pi/4 ~= 0.785
    // Triangle: Ratio ~= 0.5 (Ideal), usually 0.4 ~ 0.6

    // Decision Logic with Relaxed Thresholds

    // 1. Rectangle (Box-like)
    if (boxRatio > 0.79) {
        return {
            type: 'rectangle',
            score: boxRatio,
            correctedPoints: generatePerfectRectangle(box)
        };
    }
    // 2. Circle/Ellipse (Rounded: pi/4 ~= 0.785)
    // Squeezed range to 0.68-0.79 based on user feedback
    else if (boxRatio > 0.68) {
        return {
            type: 'circle',
            score: boxRatio,
            correctedPoints: generatePerfectCircle(box)
        };
    }
    // 3. Triangle (Pointy: 0.5)
    // Extended range to 0.68 to catch "fat" triangles
    else if (boxRatio > 0.35 && boxRatio <= 0.68) {
        // Generate Triangle (Top-center, Bottom-right, Bottom-left)
        // Note: Simple "Tent" shape for now.
        const trianglePoints = [
            { x: box.minX + box.width / 2, y: box.minY }, // Top Middle
            { x: box.maxX, y: box.maxY },                 // Bottom Right
            { x: box.minX, y: box.maxY },                 // Bottom Left
            { x: box.minX + box.width / 2, y: box.minY }  // Close
        ];
        return {
            type: 'triangle',
            score: boxRatio,
            correctedPoints: trianglePoints
        };
    }

    return { type: 'none', score: 0 };
};
