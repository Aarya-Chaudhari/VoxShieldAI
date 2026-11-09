class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(512);
    this.offset = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      this.samples[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.energy += sample * sample;
      this.offset += 1;
      if (this.offset === this.samples.length) {
        const frame = this.samples.buffer;
        const rms = Math.sqrt(this.energy / this.samples.length);
        this.port.postMessage({ frame, rms }, [frame]);
        this.samples = new Int16Array(512);
        this.offset = 0;
        this.energy = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
