// Geospatial helpers: dead-reckoning interpolation and colour scales.

const R = 6371000; // Earth radius (m)
const KT_TO_MS = 0.514444;
const DEG = Math.PI / 180;

/**
 * Project a position forward along a great circle.
 * @param {number} lat  degrees
 * @param {number} lon  degrees
 * @param {number} bearingDeg  direction of travel (degrees, true)
 * @param {number} distM  distance (metres)
 * @returns {{lat:number, lon:number}}
 */
export function destination(lat, lon, bearingDeg, distM) {
  if (distM === 0) return { lat, lon };
  const d = distM / R;
  const brng = bearingDeg * DEG;
  const phi1 = lat * DEG;
  const lam1 = lon * DEG;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(d) +
    Math.cos(phi1) * Math.sin(d) * Math.cos(brng);
  const phi2 = Math.asin(sinPhi2);
  const lam2 =
    lam1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(phi1),
      Math.cos(d) - Math.sin(phi1) * sinPhi2
    );

  return { lat: phi2 / DEG, lon: (((lam2 / DEG + 540) % 360) - 180) };
}

/**
 * Dead-reckon a position given speed (knots), track (deg) and elapsed time (s).
 */
export function deadReckon(lat, lon, speedKt, trackDeg, dtSeconds) {
  if (!Number.isFinite(speedKt) || !Number.isFinite(trackDeg) || speedKt <= 0) {
    return { lat, lon };
  }
  const distM = speedKt * KT_TO_MS * dtSeconds;
  return destination(lat, lon, trackDeg, distM);
}

/**
 * Great-circle distance in metres between two points.
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const dPhi = (lat2 - lat1) * DEG;
  const dLam = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Initial great-circle bearing from point 1 to point 2 (degrees, 0–360).
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dLam = (lon2 - lon1) * DEG;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

// ── Altitude colour scale (FlightRadar-style) ───────────────────────────────
const ALT_STOPS = [
  { ft: 0, c: [255, 77, 77] },     // red
  { ft: 10000, c: [255, 157, 0] }, // orange
  { ft: 20000, c: [255, 224, 0] }, // yellow
  { ft: 30000, c: [105, 216, 58] },// green
  { ft: 40000, c: [24, 179, 255] },// blue
  { ft: 45000, c: [155, 107, 255] },// violet
];

/** Returns an [r,g,b] array for a given altitude in feet. */
export function altitudeRGB(altFt) {
  if (altFt === 'ground' || altFt == null || !Number.isFinite(altFt)) {
    return [150, 160, 170]; // grey for ground / unknown
  }
  const stops = ALT_STOPS;
  if (altFt <= stops[0].ft) return stops[0].c.slice();
  if (altFt >= stops[stops.length - 1].ft) return stops[stops.length - 1].c.slice();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (altFt >= a.ft && altFt <= b.ft) {
      const t = (altFt - a.ft) / (b.ft - a.ft);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
      ];
    }
  }
  return [150, 160, 170];
}

export function rgbCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
