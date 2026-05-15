/**
 * Inferno-like color ramp, returns [r,g,b] in 0..255 from value 0..1.
 * Approximation good enough for waterfall plots.
 */
export function inferno(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  // Polynomial fit to matplotlib's "inferno" (Mike Bostock approximation).
  const r =
    -0.002136485053939 +
    0.2516605407371642 * x +
    8.353717279216625 * x ** 2 -
    27.66873308576866 * x ** 3 +
    52.17613981234068 * x ** 4 -
    50.76852536473588 * x ** 5 +
    18.65724182843277 * x ** 6;
  const g =
    0.000383941996020 -
    0.7088197034028518 * x +
    20.84313374537887 * x ** 2 -
    100.5645582646757 * x ** 3 +
    228.4290482228 * x ** 4 -
    253.4827092987 * x ** 5 +
    105.978768455 * x ** 6;
  const b =
    -0.005308419797284 +
    2.503176831775226 * x -
    13.74317054120318 * x ** 2 +
    44.73495862124111 * x ** 3 -
    78.7832833814771 * x ** 4 +
    72.2347585527 * x ** 5 -
    26.85692519487 * x ** 6;
  return [
    Math.round(255 * Math.max(0, Math.min(1, r))),
    Math.round(255 * Math.max(0, Math.min(1, g))),
    Math.round(255 * Math.max(0, Math.min(1, b)))
  ];
}

/** Build a 256-entry inferno LUT once. */
export function infernoLUT(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = inferno(i / 255);
    lut[i * 4 + 0] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
