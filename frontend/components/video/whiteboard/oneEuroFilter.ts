/**
 * 1€ Filter Algorithm
 * Ref: Casiez, G., Roussel, N., & Vogel, D. (2012). "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems".
 *
 * Author: Gery Casiez (Original C++ implementation), Adapted to TypeScript
 */

class LowPassFilter {
    y: number;
    s: number;
    initialized: boolean;

    constructor() {
        this.y = 0;
        this.s = 0;
        this.initialized = false;
    }

    setAlpha(alpha: number) {
        if (alpha <= 0.0 || alpha > 1.0) {
            console.warn("alpha should be in (0.0, 1.0]");
        }
        this.s = alpha;
    }

    filter(value: number, alpha: number): number {
        if (this.initialized) {
            const result = alpha * value + (1.0 - alpha) * this.y;
            this.y = result;
            this.s = alpha;
        } else {
            this.y = value;
            this.s = alpha;
            this.initialized = true;
        }
        return this.y;
    }

    lastValue(): number {
        return this.y;
    }

    reset() {
        this.initialized = false;
    }
}

export class OneEuroFilter {
    minCutoff: number;
    beta: number;
    dcutoff: number;
    x: LowPassFilter;
    dx: LowPassFilter;
    startTime: number;
    timestamp: number;

    constructor(minCutoff: number = 1.0, beta: number = 0.0, dcutoff: number = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dcutoff = dcutoff;
        this.x = new LowPassFilter();
        this.dx = new LowPassFilter();
        this.startTime = 0;
        this.timestamp = 0;
    }

    reset() {
        this.x.reset();
        this.dx.reset();
        this.startTime = 0;
        this.timestamp = 0;
    }

    filter(value: number, timestamp: number = Date.now()): number {
        // Update the sampling frequency based on timestamps
        if (this.startTime === 0) {
            this.startTime = timestamp;
        }

        // Avoid division by zero
        if (timestamp === this.timestamp) {
            return this.x.lastValue();
        }

        const dt = (timestamp - this.timestamp) / 1000.0; // Convert ms to seconds
        this.timestamp = timestamp;

        // Compute the cutoff frequency
        // The cutoff frequency of the filter increases with speed
        const dx = this.initialized() ? (value - this.x.lastValue()) / dt : 0;
        const edx = this.dx.filter(dx, this.alpha(dt, this.dcutoff));
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);

        // Filter the signal
        return this.x.filter(value, this.alpha(dt, cutoff));
    }

    private alpha(dt: number, cutoff: number): number {
        const tau = 1.0 / (2 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / dt);
    }

    private initialized(): boolean {
        return this.x.initialized;
    }
}
