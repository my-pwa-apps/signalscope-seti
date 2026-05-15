/**
 * A small bright-star catalog used for the 3D Space Map. Coordinates are
 * approximate (J2000) and intended for visualization only. The full Hipparcos
 * dataset is too heavy to ship; this curated set keeps the scene legible.
 */
export interface CatalogStar {
  name: string;
  raHours: number;
  decDeg: number;
  /** Apparent magnitude. Lower = brighter. */
  mag: number;
  color: string;
}

export const BRIGHT_STARS: CatalogStar[] = [
  { name: 'Sirius', raHours: 6.752, decDeg: -16.716, mag: -1.46, color: '#cfe6ff' },
  { name: 'Canopus', raHours: 6.399, decDeg: -52.696, mag: -0.74, color: '#fff8dc' },
  { name: 'Arcturus', raHours: 14.261, decDeg: 19.182, mag: -0.05, color: '#ffd8a3' },
  { name: 'Vega', raHours: 18.616, decDeg: 38.784, mag: 0.03, color: '#dfeaff' },
  { name: 'Capella', raHours: 5.278, decDeg: 45.998, mag: 0.08, color: '#fff1c4' },
  { name: 'Rigel', raHours: 5.242, decDeg: -8.202, mag: 0.13, color: '#cde0ff' },
  { name: 'Procyon', raHours: 7.655, decDeg: 5.225, mag: 0.34, color: '#ffeede' },
  { name: 'Betelgeuse', raHours: 5.919, decDeg: 7.407, mag: 0.42, color: '#ffb38a' },
  { name: 'Achernar', raHours: 1.629, decDeg: -57.237, mag: 0.46, color: '#cfe6ff' },
  { name: 'Hadar', raHours: 14.064, decDeg: -60.373, mag: 0.61, color: '#cdd9ff' },
  { name: 'Altair', raHours: 19.846, decDeg: 8.868, mag: 0.77, color: '#ffeede' },
  { name: 'Acrux', raHours: 12.443, decDeg: -63.099, mag: 0.81, color: '#dde9ff' },
  { name: 'Aldebaran', raHours: 4.598, decDeg: 16.509, mag: 0.85, color: '#ffb37a' },
  { name: 'Antares', raHours: 16.49, decDeg: -26.432, mag: 1.06, color: '#ff9b6a' },
  { name: 'Spica', raHours: 13.42, decDeg: -11.161, mag: 1.04, color: '#cfe2ff' },
  { name: 'Pollux', raHours: 7.755, decDeg: 28.026, mag: 1.14, color: '#ffd9a3' },
  { name: 'Fomalhaut', raHours: 22.961, decDeg: -29.622, mag: 1.16, color: '#fff5dc' },
  { name: 'Deneb', raHours: 20.690, decDeg: 45.28, mag: 1.25, color: '#dfeaff' },
  { name: 'Mimosa', raHours: 12.795, decDeg: -59.689, mag: 1.25, color: '#cfdfff' },
  { name: 'Regulus', raHours: 10.139, decDeg: 11.967, mag: 1.40, color: '#ddeaff' },
  { name: 'Adhara', raHours: 6.977, decDeg: -28.972, mag: 1.50, color: '#cfe6ff' },
  { name: 'Castor', raHours: 7.577, decDeg: 31.888, mag: 1.58, color: '#e5edff' },
  { name: 'Bellatrix', raHours: 5.418, decDeg: 6.350, mag: 1.64, color: '#cfdfff' },
  { name: 'Elnath', raHours: 5.438, decDeg: 28.608, mag: 1.65, color: '#cfe6ff' },
  { name: 'Alnilam', raHours: 5.604, decDeg: -1.202, mag: 1.69, color: '#cfe2ff' },
  { name: 'Alnair', raHours: 22.137, decDeg: -46.961, mag: 1.74, color: '#cfe6ff' },
  { name: 'Alioth', raHours: 12.900, decDeg: 55.960, mag: 1.76, color: '#e5edff' },
  { name: 'Mirfak', raHours: 3.405, decDeg: 49.861, mag: 1.79, color: '#fff1c4' },
  { name: 'Dubhe', raHours: 11.062, decDeg: 61.751, mag: 1.81, color: '#ffd9a3' },
  { name: 'Wezen', raHours: 7.140, decDeg: -26.393, mag: 1.83, color: '#fff8dc' },
  { name: 'Alkaid', raHours: 13.792, decDeg: 49.313, mag: 1.85, color: '#cfdfff' },
  { name: 'Polaris', raHours: 2.530, decDeg: 89.264, mag: 1.97, color: '#fff1c4' }
];
