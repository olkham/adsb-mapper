// Leaflet map view: plane markers, gradient track history, dead-reckoning
// interpolation loop, and selection handling.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { deadReckon, altitudeRGB, rgbCss } from './geo.js';

const DEFAULT_CENTER = [51.5, -0.1];
const DEFAULT_ZOOM = 8;
const MAX_INTERP_SECONDS = 30; // stop projecting after this long without a fix
const STALE_MS = 30000;        // grey out aircraft with no update for this long
const STALE_RGB = [140, 150, 162];

function planeSvg(colorCss) {
  // Plane pointing north (up). Rotated via the wrapper element.
  return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2 L13.4 9 L22 13 L22 15 L13.4 12.8 L13 19 L16 21 L16 22 L12 21 L8 22 L8 21 L11 19 L10.6 12.8 L2 15 L2 13 L10.6 9 Z"
      fill="${colorCss}" stroke="rgba(0,0,0,0.55)" stroke-width="0.6" stroke-linejoin="round"/>
  </svg>`;
}

function receiverSvg() {
  // Antenna mast with signal arcs.
  return `<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
    <g fill="none" stroke="#38f0d0" stroke-width="2" stroke-linecap="round">
      <path d="M15 7a8 8 0 0 1 8 8"/>
      <path d="M15 11a4 4 0 0 1 4 4"/>
    </g>
    <path d="M9 26 L15 14 L21 26 Z" fill="#0c1828" stroke="#38f0d0" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="15" cy="15" r="2.2" fill="#38f0d0"/>
  </svg>`;
}

function centerIconSvg() {
  // Crosshair / target.
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
  </svg>`;
}

export class MapView {
  constructor(store, { onSelect } = {}) {
    this.store = store;
    this.onSelect = onSelect;
    this.trailAll = false;
    this.selected = null;

    /** @type {Map<string, object>} icao24 -> entry (marker, layers, state) */
    this.entries = new Map();
    this.receiverMarker = null;

    this.map = L.map('map', {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      worldCopyJump: true,
      preferCanvas: true,
    });

    const dark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    );
    const light = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        maxZoom: 19,
        className: 'light-tiles',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }
    );
    dark.addTo(this.map);

    // Map controls grouped together in the lower-right corner.
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    const self = this;
    const CenterControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control center-control');
        const a = L.DomUtil.create('a', '', div);
        a.href = '#';
        a.title = 'Centre on receiver';
        a.setAttribute('role', 'button');
        a.innerHTML = centerIconSvg();
        L.DomEvent.on(a, 'click', (e) => {
          L.DomEvent.stop(e);
          self.centerOnReceiver();
        });
        return div;
      },
    });
    this.map.addControl(new CenterControl());

    L.control
      .layers(
        {
          'Dark': dark,
          'Light': light,
        },
        {},
        { position: 'bottomright', collapsed: true }
      )
      .addTo(this.map);

    // Canvas renderer for the (potentially many) track segments.
    this.trackRenderer = L.canvas({ padding: 0.5 });
    this.trackPane = this.map.createPane('tracks');
    this.trackPane.style.zIndex = 410;

    this.map.on('click', () => this.select(null));

    store.on('update', (ac) => this._syncAircraft(ac));
    store.on('remove', (ac) => this._removeAircraft(ac.icao24));

    this._startLoop();
  }

  setTrailAll(v) {
    this.trailAll = v;
    for (const ac of this.store.all()) this._renderTrack(ac, true);
  }

  /** Place (or move/clear) the receiver marker. Pass nulls to remove it. */
  setReceiver(lat, lon) {
    if (this.receiverMarker) {
      this.map.removeLayer(this.receiverMarker);
      this.receiverMarker = null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const icon = L.divIcon({
      className: '',
      html: `<div class="receiver-icon">${receiverSvg()}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 26],
    });
    this.receiverMarker = L.marker([lat, lon], { icon, zIndexOffset: -100 })
      .bindTooltip('Receiver', { direction: 'top', offset: [0, -20] })
      .addTo(this.map);
  }

  /** Smoothly centre the map on an aircraft. */
  focusOn(icao24) {
    const e = this.entries.get(icao24);
    if (!e) return;
    const ll = e.marker.getLatLng();
    this.map.flyTo(ll, Math.max(this.map.getZoom(), 10), { duration: 0.6 });
  }

  /** Recentre on the receiver (or the default centre if none is set). */
  centerOnReceiver() {
    if (this.receiverMarker) {
      this.map.flyTo(this.receiverMarker.getLatLng(), Math.max(this.map.getZoom(), 9), {
        duration: 0.6,
      });
    } else {
      this.map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.6 });
    }
  }

  // ── Aircraft sync ──────────────────────────────────────────────────────────
  _syncAircraft(ac) {
    const { lat, lon } = ac.fields;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    let e = this.entries.get(ac.icao24);
    if (!e) {
      const marker = L.marker([lat, lon], {
        icon: this._buildIcon(ac, {
          selected: false,
          colorCss: rgbCss(this._colorOf(ac)),
          heading: this._headingOf(ac),
        }),
        keyboard: false,
        riseOnHover: true,
      });
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        this.select(ac.icao24);
      });
      marker.addTo(this.map);
      e = {
        marker, trackLayer: null, predLine: null,
        heading: null, appearanceKey: null, stale: false, _predStale: null,
        drawnLen: -1,
      };
      this.entries.set(ac.icao24, e);
    }

    this._updateAppearance(ac, e);
    this._renderTrack(ac);
  }

  _removeAircraft(icao24) {
    const e = this.entries.get(icao24);
    if (!e) return;
    if (e.marker) this.map.removeLayer(e.marker);
    if (e.trackLayer) this.map.removeLayer(e.trackLayer);
    if (e.predLine) this.map.removeLayer(e.predLine);
    this.entries.delete(icao24);
    if (this.selected === icao24) this.select(null);
  }

  // ── Icon ────────────────────────────────────────────────────────────────────
  _headingOf(ac) {
    // Prefer reported heading, then track, then a heading inferred from
    // movement. Returns null when nothing is known (keep the last value).
    const h = ac.fields.true_heading ?? ac.fields.track ?? ac.movedHeading;
    return Number.isFinite(h) ? h : null;
  }

  _colorOf(ac) {
    return altitudeRGB(ac.fields.altitude_ft);
  }

  _isStale(ac) {
    return Date.now() - ac.lastUpdate > STALE_MS;
  }

  _buildIcon(ac, { selected, colorCss, heading }) {
    const h = Number.isFinite(heading) ? heading : 0;
    const label = ac.fields.callsign || ac.icao24;
    const cls = selected ? 'plane-icon selected' : 'plane-icon';
    return L.divIcon({
      className: '',
      html:
        `<div class="${cls}" style="transform: rotate(${h}deg)">${planeSvg(colorCss)}</div>` +
        `<span class="plane-label">${escapeHtml(label)}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  /**
   * Rebuild the icon only when colour (incl. staleness), label or selection
   * changes. Rotation is applied directly to the DOM in the render loop.
   */
  _updateAppearance(ac, e) {
    const stale = this._isStale(ac);
    const colorCss = stale ? rgbCss(STALE_RGB) : rgbCss(this._colorOf(ac));
    const selected = this.selected === ac.icao24;
    const label = ac.fields.callsign || ac.icao24;
    const key = `${colorCss}|${selected ? 1 : 0}|${label}`;

    if (e.appearanceKey !== key) {
      const heading = this._headingOf(ac);
      const baked = Number.isFinite(heading) ? heading : (e.heading ?? 0);
      e.marker.setIcon(this._buildIcon(ac, { selected, colorCss, heading: baked }));
      e.appearanceKey = key;
      e.heading = baked; // matches the rotation baked into the new icon
      e.stale = stale;
    }

    if (e.predLine && e._predStale !== stale) {
      e.predLine.setStyle({
        color: stale ? rgbCss(STALE_RGB) : '#ffffff',
        opacity: stale ? 0.4 : 0.55,
      });
      e._predStale = stale;
    }
  }

  // ── Gradient track ───────────────────────────────────────────────────────────
  _renderTrack(ac, force = false) {
    const e = this.entries.get(ac.icao24);
    if (!e) return;

    const show = this.trailAll || this.selected === ac.icao24;
    if (!show) {
      if (e.trackLayer) {
        this.map.removeLayer(e.trackLayer);
        e.trackLayer = null;
        e.drawnLen = -1;
      }
      if (e.predLine) {
        this.map.removeLayer(e.predLine);
        e.predLine = null;
      }
      return;
    }

    // Live "prediction" segment from the last confirmed fix to the
    // interpolated marker position. Coordinates are updated every frame in
    // the render loop; here we just make sure the layer exists.
    if (!e.predLine) {
      e.predLine = L.polyline([], {
        color: '#ffffff',
        weight: 2,
        opacity: 0.55,
        dashArray: '4 5',
        renderer: this.trackRenderer,
        pane: 'tracks',
        interactive: false,
      }).addTo(this.map);
    }

    if (!force && e.drawnLen === ac.track.length) return;
    e.drawnLen = ac.track.length;

    if (e.trackLayer) this.map.removeLayer(e.trackLayer);

    const pts = ac.track;
    if (pts.length < 1) { e.trackLayer = null; return; }

    const group = L.layerGroup();
    const n = pts.length;

    for (let i = 0; i < n - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ageT = n > 1 ? i / (n - 1) : 1; // 0 = oldest, 1 = newest
      const opacity = 0.15 + 0.75 * ageT;
      const isLatest = i === n - 2;
      const rgb = altitudeRGB(b.alt);
      L.polyline(
        [[a.lat, a.lon], [b.lat, b.lon]],
        {
          color: isLatest ? '#ffffff' : rgbCss(rgb),
          weight: isLatest ? 3 : 2,
          opacity: isLatest ? 0.95 : opacity,
          renderer: this.trackRenderer,
          pane: 'tracks',
          interactive: false,
        }
      ).addTo(group);
    }

    // Update dots: a marker at each reported fix.
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      L.circleMarker([p.lat, p.lon], {
        radius: i === n - 1 ? 3 : 2,
        color: i === n - 1 ? '#ffffff' : rgbCss(altitudeRGB(p.alt)),
        weight: 1,
        fillColor: rgbCss(altitudeRGB(p.alt)),
        fillOpacity: 0.9,
        renderer: this.trackRenderer,
        pane: 'tracks',
        interactive: false,
      }).addTo(group);
    }

    group.addTo(this.map);
    e.trackLayer = group;
  }

  // ── Selection ────────────────────────────────────────────────────────────────
  select(icao24) {
    if (this.selected === icao24) return;
    const prev = this.selected;
    this.selected = icao24;

    if (prev) {
      const ac = this.store.get(prev);
      const e = this.entries.get(prev);
      if (ac && e) { this._updateAppearance(ac, e); this._renderTrack(ac, true); }
    }
    if (icao24) {
      const ac = this.store.get(icao24);
      const e = this.entries.get(icao24);
      if (ac && e) { this._updateAppearance(ac, e); this._renderTrack(ac, true); }
    }
    this.onSelect?.(icao24 ? this.store.get(icao24) : null);
  }

  // ── Interpolation loop ───────────────────────────────────────────────────────
  _startLoop() {
    const frame = () => {
      const now = performance.now();
      for (const [icao24, e] of this.entries) {
        const ac = this.store.get(icao24);
        if (!ac || ac.baseLat == null) continue;

        const dt = Math.min((now - ac.baseTime) / 1000, MAX_INTERP_SECONDS);
        const speed = ac.fields.ground_speed_kt;
        const course = ac.fields.track ?? ac.movedHeading ?? ac.fields.true_heading;
        const pos = ac.fields.on_ground
          ? { lat: ac.baseLat, lon: ac.baseLon }
          : deadReckon(ac.baseLat, ac.baseLon, speed, course, dt);

        e.marker.setLatLng([pos.lat, pos.lon]);

        // Extend the trail from the last confirmed fix to the predicted point.
        if (e.predLine && ac.baseLat != null) {
          e.predLine.setLatLngs([
            [ac.baseLat, ac.baseLon],
            [pos.lat, pos.lon],
          ]);
        }

        // Keep colour/staleness/label/selection in sync.
        this._updateAppearance(ac, e);

        // Cheap rotation update directly on the DOM (skip when unknown).
        const heading = this._headingOf(ac);
        if (heading != null && e.heading !== heading) {
          const el = e.marker.getElement();
          if (el) {
            const inner = el.querySelector('.plane-icon');
            if (inner) inner.style.transform = `rotate(${heading}deg)`;
            e.heading = heading;
          }
        }
      }
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
