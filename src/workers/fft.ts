/**
 * Cooley–Tukey radix-2 FFT for in-worker spectrogram refinement.
 *
 * Current filterbank inputs already arrive as channelized power (time × freq).
 * This FFT is exposed for cases where the analysis pipeline would transform
 * raw voltage chunks from a future adapter (e.g. GUPPI RAW slices).
 */
export function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n !== imag.length) throw new Error('fft: real/imag length mismatch');
  if ((n & (n - 1)) !== 0) throw new Error('fft: length must be power of two');

  // Bit-reverse permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  // Butterflies.
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const tableStep = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = tableStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = i + k;
        const b = a + half;
        const tr = wr * real[b] - wi * imag[b];
        const ti = wr * imag[b] + wi * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
      }
    }
  }
}

/** Compute power spectrum |X|^2 from a real signal (zero imag). */
export function powerSpectrum(signal: Float32Array): Float32Array {
  const n = signal.length;
  const real = new Float32Array(signal);
  const imag = new Float32Array(n);
  fftInPlace(real, imag);
  const out = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    out[i] = real[i] * real[i] + imag[i] * imag[i];
  }
  return out;
}
