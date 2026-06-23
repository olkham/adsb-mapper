// App entry point: wires together config UI, MQTT client, store, map and panels.

import './styles.css';
import { AircraftStore } from './store.js';
import { AdsbMqtt } from './mqtt.js';
import { MapView } from './map.js';
import { rgbCss, altitudeRGB } from './geo.js';
import { iconSvgForCategory } from './map.js';

const CONFIG_KEY = 'adsb-mapper.config';

// Build/dev-time defaults, overridable via a .env file (see .env.example).
// The in-app settings panel overrides these and is persisted in localStorage.
const DEFAULT_CONFIG = {
  url: import.meta.env.VITE_MQTT_URL || 'ws://localhost:9001',
  prefix: import.meta.env.VITE_MQTT_PREFIX || 'adsb',
  username: import.meta.env.VITE_MQTT_USERNAME || '',
  password: import.meta.env.VITE_MQTT_PASSWORD || '',
  trailAll: String(import.meta.env.VITE_TRAIL_ALL).toLowerCase() === 'true',
  showReceiver: true,
  receiver:
    import.meta.env.VITE_STATION_LAT && import.meta.env.VITE_STATION_LON
      ? `${import.meta.env.VITE_STATION_LAT}, ${import.meta.env.VITE_STATION_LON}`
      : '',
};

const STALE_MS = 30000;

/** Parse a "lat, lon" string into {lat, lon}, or null if invalid. */
function parseLatLon(str) {
  if (!str) return null;
  const m = String(str).split(/[ ,]+/).filter(Boolean);
  if (m.length < 2) return null;
  const lat = Number(m[0]);
  const lon = Number(m[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── State ─────────────────────────────────────────────────────────────────────
let config = loadConfig();
let mqttClient = null;
let trackedIcao = null;

function setTracked(icao24) {
  trackedIcao = icao24 || null;
  map.setTracking(trackedIcao);
  renderList();
}

const store = new AircraftStore();
const map = new MapView(store, {
  onSelect: handleSelect,
  onTrackRelease: (icao24) => {
    if (trackedIcao === icao24) setTracked(null);
  },
});
map.setTrailAll(config.trailAll);
applyReceiver();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const connDot = $('conn-dot');
const settingsPanel = $('settings');
const infoPanel = $('info');
const connMsg = $('conn-msg');
const aircraftList = $('aircraft-list');
const listCount = $('list-count');
const listFilter = $('list-filter');

function applyReceiver() {
  const p = parseLatLon(config.receiver);
  map.setReceiverVisible(config.showReceiver);
  map.setReceiver(p?.lat, p?.lon);
  map.centerOnReceiver();
}

function handleSelect(ac) {
  renderInfo(ac);
  renderList();
}

// ── Connection settings UI ────────────────────────────────────────────────────
function fillSettings() {
  $('cfg-url').value = config.url;
  $('cfg-prefix').value = config.prefix;
  $('cfg-user').value = config.username;
  $('cfg-pass').value = config.password;
  $('cfg-trail-all').checked = config.trailAll;
  $('cfg-show-receiver').checked = config.showReceiver;
  $('cfg-receiver').value = config.receiver || '';
}

function openSettings() {
  fillSettings();
  connMsg.textContent = '';
  settingsPanel.classList.remove('hidden');
}
function closeSettings() {
  settingsPanel.classList.add('hidden');
}

$('settings-btn').addEventListener('click', openSettings);
$('cfg-cancel').addEventListener('click', closeSettings);
$('cfg-close').addEventListener('click', closeSettings);

// Build legend icons from the same SVG functions used on the map
const LEGEND_ICON_ITEMS = [
  { category: 'A1', label: '<strong>Fixed-wing</strong>', desc: 'A1 Light &bull; A2 Small &bull; A3 Large &bull; A4 High-vortex &bull; A5 Heavy &bull; A6 High-perf' },
  { category: 'A7', label: '<strong>Helicopter / Rotorcraft</strong>', desc: 'A7' },
  { category: 'B1', label: '<strong>Glider / Ultralight</strong>', desc: 'B1 &bull; B4' },
  { category: 'B2', label: '<strong>Balloon / Airship</strong>', desc: 'B2 Lighter-than-air' },
  { category: 'B3', label: '<strong>Parachutist</strong>', desc: 'B3' },
  { category: 'B6', label: '<strong>UAV / Drone</strong>', desc: 'B6' },
  { category: 'C1', label: '<strong>Surface vehicle</strong>', desc: 'C1 Emergency &bull; C2 Service' },
  { category: 'C3', label: '<strong>Obstacle</strong>', desc: 'C3 Point &bull; C4 Cluster &bull; C5 Line' },
];
$('legend-icons').innerHTML = LEGEND_ICON_ITEMS.map(({ category, label, desc }) => {
  const svg = iconSvgForCategory(category, '#38bdf8').replace(/width="24"/, 'width="22"').replace(/height="24"/, 'height="22"');
  return `<div class="legend-icon-row">${svg}<span>${label} \u2014 ${desc}</span></div>`;
}).join('');

// Legend toggle
const legendBtn = $('legend-btn');
const legendPanel = $('legend-panel');
legendBtn.addEventListener('click', () => {
  const open = legendPanel.classList.toggle('open');
  legendPanel.classList.toggle('hidden', false); // remove hidden so transition works
  legendBtn.classList.toggle('active', open);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsPanel.classList.contains('hidden')) closeSettings();
});

$('cfg-reset').addEventListener('click', () => {
  localStorage.removeItem(CONFIG_KEY);
  config = { ...DEFAULT_CONFIG };
  fillSettings();
  map.setTrailAll(config.trailAll);
  applyReceiver();
  connMsg.textContent = 'Reset to .env defaults.';
});

$('cfg-trail-all').addEventListener('change', (e) => {
  config.trailAll = e.target.checked;
  saveConfig(config);
  map.setTrailAll(config.trailAll);
});

$('cfg-show-receiver').addEventListener('change', (e) => {
  config.showReceiver = e.target.checked;
  saveConfig(config);
  map.setReceiverVisible(config.showReceiver);
});

$('cfg-connect').addEventListener('click', () => {
  config = {
    ...config,
    url: $('cfg-url').value.trim() || DEFAULT_CONFIG.url,
    prefix: ($('cfg-prefix').value.trim() || DEFAULT_CONFIG.prefix).replace(/\/+$/, ''),
    username: $('cfg-user').value,
    password: $('cfg-pass').value,
    trailAll: $('cfg-trail-all').checked,
    showReceiver: $('cfg-show-receiver').checked,
    receiver: $('cfg-receiver').value.trim(),
  };
  saveConfig(config);
  map.setTrailAll(config.trailAll);
  applyReceiver();
  connect();
  closeSettings();
});

// ── Connection status ─────────────────────────────────────────────────────────
function setStatus(state, msg) {
  connDot.className = 'dot ' +
    (state === 'connected' ? 'dot-on' : state === 'connecting' ? 'dot-wait' : 'dot-off');
  connDot.title = msg || state;
  if (state === 'error' || state === 'connecting') connMsg.textContent = msg || '';
  if (state === 'connected') connMsg.textContent = '';
}

// ── MQTT lifecycle ────────────────────────────────────────────────────────────
function connect() {
  if (mqttClient) mqttClient.disconnect();

  mqttClient = new AdsbMqtt(
    {
      url: config.url,
      prefix: config.prefix,
      username: config.username,
      password: config.password,
    },
    {
      onField: (icao24, field, payload) => store.applyField(icao24, field, payload),
      onDisappeared: (data) => data?.icao24 && store.remove(data.icao24),
      onStatus: setStatus,
    }
  );
  mqttClient.connect();
}

// Remove stale aircraft periodically.
setInterval(() => store.sweep(120000), 15000);

// Release tracking when the tracked aircraft goes stale.
setInterval(() => {
  if (!trackedIcao) return;
  const ac = store.get(trackedIcao);
  if (!ac || Date.now() - ac.lastUpdate > STALE_MS) setTracked(null);
}, 5000);

// Keep the selected aircraft's info panel fresh.
setInterval(() => {
  if (map.selected) {
    const ac = store.get(map.selected);
    if (ac) renderInfo(ac);
  }
}, 1000);

// ── Aircraft list panel ───────────────────────────────────────────────────────
function renderList() {
  const filter = (listFilter.value || '').trim().toUpperCase();
  const items = [];
  for (const ac of store.all()) {
    const f = ac.fields;
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    const call = f.callsign || ac.icao24;
    if (filter && !call.toUpperCase().includes(filter) && !ac.icao24.toUpperCase().includes(filter)) {
      continue;
    }
    items.push(ac);
  }
  items.sort((a, b) =>
    (a.fields.callsign || a.icao24).localeCompare(b.fields.callsign || b.icao24)
  );
  listCount.textContent = items.length;

  if (!items.length) {
    aircraftList.innerHTML = '<div class="list-empty">No aircraft</div>';
    return;
  }

  const now = Date.now();
  aircraftList.innerHTML = items
    .map((ac) => {
      const f = ac.fields;
      const stale = now - ac.lastUpdate > STALE_MS;
      const rgb = stale ? [140, 150, 162] : altitudeRGB(f.altitude_ft);
      const alt =
        f.altitude_ft === 'ground'
          ? 'GND'
          : Number.isFinite(f.altitude_ft)
          ? `${Math.round(f.altitude_ft)}ft`
          : '–';
      const spd = Number.isFinite(f.ground_speed_kt) ? `${Math.round(f.ground_speed_kt)}kt` : '';
      const sel = map.selected === ac.icao24 ? ' selected' : '';
      const st = stale ? ' stale' : '';
      const tracked = trackedIcao === ac.icao24;
      const trackTitle = tracked ? 'Stop tracking' : 'Track aircraft';
      const trackActive = tracked ? ' active' : '';
      return (
        `<div class="list-row${sel}${st}" data-icao="${ac.icao24}">` +
        `<span class="row-dot" style="background:${rgbCss(rgb)}"></span>` +
        `<span class="row-call">${escapeHtml(f.callsign || ac.icao24)}</span>` +
        `<span class="row-meta">${alt} ${spd}</span>` +
        `<button class="row-track${trackActive}" data-track-icao="${ac.icao24}" title="${trackTitle}">` +
        `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="1" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="15"/><line x1="1" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="15" y2="8"/></svg>` +
        `</button>` +
        `</div>`
      );
    })
    .join('');
}

aircraftList.addEventListener('click', (e) => {
  // Track button takes priority.
  const trackBtn = e.target.closest('.row-track');
  if (trackBtn) {
    e.stopPropagation();
    const icao = trackBtn.dataset.trackIcao;
    setTracked(trackedIcao === icao ? null : icao);
    return;
  }
  const row = e.target.closest('.list-row');
  if (!row) return;
  const icao = row.dataset.icao;
  map.select(icao);
  map.focusOn(icao);
});
listFilter.addEventListener('input', renderList);

setInterval(renderList, 1000);

// ── Info panel ────────────────────────────────────────────────────────────────
function fmt(v, unit = '', digits) {
  if (v == null || v === '') return '–';
  if (typeof v === 'number' && digits != null) return `${v.toFixed(digits)}${unit}`;
  return `${v}${unit}`;
}

const COPY_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<rect x="5" y="5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
  '<path d="M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
  '</svg>';

let infoRowKeys = [];

/** Build the ordered [label, value] rows for the selected aircraft. */
function infoData(ac) {
  const f = ac.fields;
  const alt = f.altitude_ft === 'ground' ? 'On ground' : fmt(f.altitude_ft, ' ft', 0);
  const rows = [
    ['Callsign', f.callsign || '–'],
    ['ICAO24', ac.icao24],
    ['Squawk', f.squawk || '–'],
    ['Altitude', alt],
    ['Speed', fmt(f.ground_speed_kt, ' kt', 0)],
    ['Heading', fmt(f.true_heading ?? f.track, '°', 0)],
    ['Vert. rate', fmt(f.vertical_rate_fpm, ' fpm', 0)],
    ['Position', Number.isFinite(f.lat) ? `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}` : '–'],
    ['Range', fmt(f.range_km, ' km', 1)],
    ['Category', f.category || '–'],
    ['Messages', fmt(f.messages)],
    ['RSSI', fmt(f.rssi, ' dBFS', 1)],
  ];
  if (f.emergency) rows.unshift(['⚠ Emergency', f.emergency]);
  return rows;
}

function renderInfo(ac) {
  if (!ac) {
    infoPanel.classList.add('hidden');
    infoPanel.innerHTML = '';
    infoPanel.dataset.icao = '';
    infoRowKeys = [];
    return;
  }
  if (infoPanel.dataset.icao !== ac.icao24) buildInfo(ac);
  else updateInfo(ac);
  infoPanel.classList.remove('hidden');
}

// Build the panel skeleton once per selection so live updates don't wipe the
// user's text selection.
function buildInfo(ac) {
  const f = ac.fields;
  const color = rgbCss(altitudeRGB(f.altitude_ft));
  const title = f.callsign || ac.icao24;
  const rows = infoData(ac);
  infoRowKeys = rows.map((r) => r[0]);
  infoPanel.dataset.icao = ac.icao24;

  infoPanel.innerHTML =
    `<h3><span class="swatch" style="background:${color}"></span>` +
    `<span class="info-title">${escapeHtml(title)}</span>` +
    `<button class="close" title="Close">×</button></h3>` +
    '<table>' +
    rows
      .map(
        ([k]) =>
          `<tr><td class="k">${escapeHtml(k)}</td>` +
          `<td class="v"><div class="vwrap"><span class="vtext"></span>` +
          `<button class="copy" title="Copy">${COPY_SVG}</button></div></td></tr>`
      )
      .join('') +
    '</table>' +
    `<div class="info-foot"><button class="copy-all" title="Copy all details">` +
    `${COPY_SVG}<span>Copy all</span></button></div>`;

  updateInfo(ac);
}

// Update values in place; rebuild only if the set of rows changed.
function updateInfo(ac) {
  const rows = infoData(ac);
  if (rows.length !== infoRowKeys.length || rows.some((r, i) => r[0] !== infoRowKeys[i])) {
    buildInfo(ac);
    return;
  }
  const f = ac.fields;
  const sw = infoPanel.querySelector('.swatch');
  if (sw) sw.style.background = rgbCss(altitudeRGB(f.altitude_ft));

  const titleEl = infoPanel.querySelector('.info-title');
  const title = f.callsign || ac.icao24;
  if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;

  const trs = infoPanel.querySelectorAll('table tr');
  rows.forEach(([, v], i) => {
    const tr = trs[i];
    if (!tr) return;
    const vtext = tr.querySelector('.vtext');
    const copy = tr.querySelector('.copy');
    const sval = String(v);
    if (vtext && vtext.textContent !== sval) vtext.textContent = sval;
    if (copy && copy.dataset.copy !== sval) copy.dataset.copy = sval;
  });
}

function buildCopyAll() {
  const ac = store.get(map.selected);
  if (!ac) return '';
  return infoData(ac)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

async function copyText(text, btn) {
  if (!text) return;
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    // Fallback for non-secure (http LAN) contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
  }
  if (ok && btn) {
    const prev = btn.title;
    btn.classList.add('copied');
    btn.title = 'Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.title = prev;
    }, 1200);
  }
}

// Delegated handlers (attached once; the panel element persists).
infoPanel.addEventListener('click', (e) => {
  if (e.target.closest('.close')) {
    map.select(null);
    return;
  }
  const copyAll = e.target.closest('.copy-all');
  if (copyAll) {
    copyText(buildCopyAll(), copyAll);
    return;
  }
  const copy = e.target.closest('.copy');
  if (copy) copyText(copy.dataset.copy || '', copy);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────
fillSettings();renderList();connect();
