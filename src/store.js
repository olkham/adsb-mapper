// Aircraft data store: parses per-field MQTT updates into aircraft records,
// maintains track history, and notifies listeners of changes.

import { haversine, bearing } from './geo.js';

// Fields that should be coerced to numbers when they arrive as strings.
const NUMERIC_FIELDS = new Set([
  'lat', 'lon', 'altitude_geom_ft', 'altitude_m',
  'ground_speed_kt', 'ground_speed_ms', 'ground_speed_kmh',
  'true_heading', 'track', 'vertical_rate_fpm',
  'nic', 'nac_p', 'messages', 'rssi', 'seen',
  'range_km', 'bearing_deg',
]);

const ARRAY_FIELDS = new Set(['mlat', 'tisb']);
const BOOL_FIELDS = new Set(['on_ground']);

// Minimum movement (metres) before a new track point is recorded.
const MIN_TRACK_MOVE_M = 30;
// Maximum number of history points kept per aircraft.
const MAX_TRACK_POINTS = 400;
// lat and lon arrive as separate retained messages; wait this long after the
// last one before committing a position, so we always use a coherent pair.
const POSITION_DEBOUNCE_MS = 60;

function parseValue(field, raw) {
  if (raw === '' || raw == null) return undefined;
  if (field === 'altitude_ft') {
    return raw === 'ground' ? 'ground' : Number(raw);
  }
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (BOOL_FIELDS.has(field)) return raw === 'true';
  if (ARRAY_FIELDS.has(field)) {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw; // plain string (icao24, callsign, squawk, category, etc.)
}

export class AircraftStore {
  constructor() {
    /** @type {Map<string, object>} icao24 -> record */
    this.aircraft = new Map();
    this.listeners = { update: [], remove: [] };
  }

  on(evt, fn) {
    this.listeners[evt]?.push(fn);
  }

  _emit(evt, ...args) {
    for (const fn of this.listeners[evt] || []) fn(...args);
  }

  get(icao24) {
    return this.aircraft.get(icao24);
  }

  all() {
    return this.aircraft.values();
  }

  count() {
    return this.aircraft.size;
  }

  _ensure(icao24) {
    let ac = this.aircraft.get(icao24);
    if (!ac) {
      ac = {
        icao24,
        fields: {},        // latest parsed enriched fields
        track: [],         // [{lat, lon, alt, t}]
        lastUpdate: 0,     // wall-clock ms of last field update
        // interpolation base
        baseLat: null,
        baseLon: null,
        baseTime: 0,       // performance.now() at last position fix
        _posTimer: null,   // debounce timer for lat/lon coalescing
        movedHeading: null,// heading inferred from movement (fallback)
      };
      this.aircraft.set(icao24, ac);
    }
    return ac;
  }

  /**
   * Apply a single enriched field update.
   * @param {string} icao24
   * @param {string} field
   * @param {string} rawPayload  empty string clears the field
   */
  applyField(icao24, field, rawPayload) {
    // Empty payload on a core field => field cleared. We keep the record but
    // drop the value; removal is handled by disappeared events / sweep.
    if (rawPayload === '') {
      const ac = this.aircraft.get(icao24);
      if (ac) delete ac.fields[field];
      return;
    }

    const value = parseValue(field, rawPayload);
    if (value === undefined) return;

    const ac = this._ensure(icao24);
    ac.fields[field] = value;
    ac.lastUpdate = Date.now();

    // lat/lon arrive as separate retained messages; debounce so we commit a
    // coherent lat+lon pair together (avoids stair-stepped L-shaped motion).
    if (field === 'lat' || field === 'lon') {
      this._schedulePositionCommit(ac);
    }

    this._emit('update', ac);
  }

  _schedulePositionCommit(ac) {
    clearTimeout(ac._posTimer);
    ac._posTimer = setTimeout(() => {
      ac._posTimer = null;
      this._commitPosition(ac);
    }, POSITION_DEBOUNCE_MS);
  }

  _commitPosition(ac) {
    const { lat, lon } = ac.fields;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const now = performance.now();
    const alt = ac.fields.altitude_ft;

    // Infer a heading from the movement vector so the icon never snaps to
    // north when track/true_heading are absent.
    if (ac.baseLat != null) {
      const moved = haversine(ac.baseLat, ac.baseLon, lat, lon);
      if (moved >= 15) {
        ac.movedHeading = bearing(ac.baseLat, ac.baseLon, lat, lon);
      }
    }

    // Reset interpolation base to the freshly reported fix.
    ac.baseLat = lat;
    ac.baseLon = lon;
    ac.baseTime = now;

    const last = ac.track[ac.track.length - 1];
    if (!last) {
      ac.track.push({ lat, lon, alt, t: Date.now() });
    } else {
      // Only record a new point once the aircraft has moved enough.
      const moved = haversine(last.lat, last.lon, lat, lon);
      if (moved >= MIN_TRACK_MOVE_M) {
        ac.track.push({ lat, lon, alt, t: Date.now() });
        if (ac.track.length > MAX_TRACK_POINTS) ac.track.shift();
      } else {
        // Refine the latest point in place (don't spam history).
        last.lat = lat;
        last.lon = lon;
        last.alt = alt;
        last.t = Date.now();
      }
    }

    this._emit('update', ac);
  }

  remove(icao24) {
    const ac = this.aircraft.get(icao24);
    if (!ac) return;
    clearTimeout(ac._posTimer);
    this.aircraft.delete(icao24);
    this._emit('remove', ac);
  }

  /** Remove aircraft not heard from in `timeoutMs`. */
  sweep(timeoutMs = 120000) {
    const cutoff = Date.now() - timeoutMs;
    for (const [icao24, ac] of this.aircraft) {
      if (ac.lastUpdate < cutoff) this.remove(icao24);
    }
  }
}
