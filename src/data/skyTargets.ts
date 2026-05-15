import type { SkyTarget } from '../types/domain';

/**
 * Small curated catalog of well-known nearby SETI targets used **purely for
 * the 3D space-map visualization**. These coordinates are approximate and do
 * not drive any analysis — they only place icons in the immersive sky view so
 * the user has familiar landmarks (Proxima Centauri, TRAPPIST-1, etc.) while
 * navigating.
 *
 * No telescope is being pointed by this app. No synthetic work units are
 * generated from these targets — all analysis runs against real Berkeley
 * SETI / Breakthrough Listen filterbank data (see `src/data/realCatalog.ts`)
 * or against user-uploaded `.fil` files.
 */
export const TARGET_CATALOG: SkyTarget[] = [
  { name: 'TRAPPIST-1', raHours: 23.106, decDeg: -5.041, distanceLy: 40.7, note: '7-planet ultracool dwarf system' },
  { name: 'Proxima Centauri', raHours: 14.495, decDeg: -62.679, distanceLy: 4.24, note: 'Nearest star to the Sun' },
  { name: 'Tau Ceti', raHours: 1.734, decDeg: -15.937, distanceLy: 11.9, note: 'Sun-like G-type star' },
  { name: 'Kepler-442', raHours: 19.027, decDeg: 39.279, distanceLy: 1206, note: 'Habitable-zone exoplanet host' },
  { name: 'HD 164595', raHours: 18.014, decDeg: 29.392, distanceLy: 94.4, note: 'Solar analog, past SETI interest' },
  { name: 'Ross 128', raHours: 11.788, decDeg: 0.804, distanceLy: 11.0, note: 'Quiet red dwarf' },
  { name: 'Gliese 581', raHours: 15.328, decDeg: -7.722, distanceLy: 20.4, note: 'Multi-planet M dwarf' },
  { name: 'Barnard\u2019s Star', raHours: 17.963, decDeg: 4.693, distanceLy: 5.96, note: 'High proper motion red dwarf' },
  { name: 'Wolf 359', raHours: 10.906, decDeg: 7.014, distanceLy: 7.86, note: 'Faint flare star' },
  { name: 'Galactic Center sweep', raHours: 17.761, decDeg: -29.008, distanceLy: 26000, note: 'Sgr A* region' }
];
