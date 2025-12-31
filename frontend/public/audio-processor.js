// AudioWorklet Processor for capturing audio samples
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) {
            return true;
        }

        const channelData = input[0];

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex++] = channelData[i];

            // 버퍼가 가득 차면 메인 스레드로 전송
            if (this.bufferIndex >= this.bufferSize) {
                this.port.postMessage({
                    audioData: this.buffer.slice(),
                });
                this.bufferIndex = 0;
            }
        }

        return true;
    }
}

registerProcessor('audio-processor', AudioProcessor);
