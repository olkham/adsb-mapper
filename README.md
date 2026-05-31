# ADS-B Mapper

A local, FlightRadar24-style web app that subscribes to an MQTT broker carrying
ADS-B aircraft data (the [`adsb2mqtt`](./schema.yaml) schema) and plots aircraft
on a live, pan/zoom map.

- **Live map** (Leaflet + dark CARTO basemap), zoomable and pannable.
- **Realtime aircraft** from retained per-field MQTT topics.
- **Smooth interpolation** — positions are dead-reckoned between updates so
  planes glide instead of jumping.
- **Gradient track history** — paths fade from old to recent, newest segment
  highlighted white, with a dot at every reported fix.
- **Altitude colouring** (red = low → violet = high) with a legend.
- **Click an aircraft** for a live info panel; HUD shows `adsb/stats` counts.

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | Includes `npm`. Get it from <https://nodejs.org/>. |
| **MQTT broker with a WebSocket listener** | Browsers speak MQTT over WebSockets only — see [§5](#5-broker-websocket-setup). |
| **`adsb2mqtt` publishing** to that broker | Topics follow [`schema.yaml`](./schema.yaml). |

---

## 2. Install

The install step checks for Node, creates a `.env` from the template, and
installs npm dependencies.

### Windows

```bat
install.bat
```

### Linux / macOS

```bash
chmod +x install.sh start.sh   # first time only
./install.sh
```

### Manual (any OS)

```bash
npm install
copy .env.example .env      &:: Windows
cp .env.example .env        # Linux/macOS
```

---

## 3. Start / Stop

The app runs a local dev server at **<http://localhost:5188>**.

### Start

| Platform | Command |
|----------|---------|
| Windows | `start.bat` |
| Linux/macOS | `./start.sh` |
| Manual | `npm start` (alias for `npm run dev`) |

You can define the broker **inline** when starting (writes it to `.env`):

```bat
:: Windows
start.bat ws://192.168.1.50:9001
start.bat ws://192.168.1.50:9001 adsb      :: URL + topic prefix
```

```bash
# Linux/macOS
./start.sh ws://192.168.1.50:9001
./start.sh ws://192.168.1.50:9001 adsb      # URL + topic prefix
```

Then open <http://localhost:5188> in a browser.

### Stop

Press **Ctrl+C** in the terminal running the server.

---

## 4. Configure the MQTT broker

There are three ways to point the app at a broker, in order of precedence
(later overrides earlier):

1. **`.env` file** — edit and restart. This is the easiest persistent default:

   ```ini
   VITE_MQTT_URL=ws://localhost:9001
   VITE_MQTT_PREFIX=adsb
   VITE_MQTT_USERNAME=
   VITE_MQTT_PASSWORD=
   VITE_TRAIL_ALL=false
   ```

   See [`.env.example`](./.env.example) for the full list. Restart the server
   after editing (Vite reads env vars on start).

2. **Start-script argument** — `start.bat ws://host:9001` /
   `./start.sh ws://host:9001` writes the URL (and optional prefix) into `.env`
   for you.

3. **In-app settings panel** — click the ⚙ button. Changes here are saved in the
   browser's `localStorage` and override the `.env` defaults for that browser.
   Click **Reset** in the panel to clear them and fall back to the `.env`
   defaults.

> Settings precedence: **in-app panel (localStorage) → `.env` → built-in default
> (`ws://localhost:9001`, prefix `adsb`)**.

---

## 5. Broker WebSocket setup

ADS-B Mapper runs in a browser, which can only do MQTT **over WebSockets**, so
your broker needs a WebSocket listener in addition to the normal 1883 port that
`adsb2mqtt` publishes to.

For **Mosquitto**, add to `mosquitto.conf`:

```conf
listener 1883
listener 9001
protocol websockets
allow_anonymous true
```

Restart Mosquitto. `adsb2mqtt` keeps publishing to 1883; the web app connects to
`ws://<broker-host>:9001`. For TLS, use `wss://` and an `8884`/`443` listener.

---

## 6. Production build (optional)

To serve an optimised static build instead of the dev server:

```bash
npm run build       # outputs to dist/
npm run preview     # serves dist/ at http://localhost:5188
```

`dist/` is plain static files — you can host it on any web server. Env vars are
baked in at build time, so rebuild after changing `.env`.

---

## 7. Command reference

| Action | Windows | Linux/macOS | npm |
|--------|---------|-------------|-----|
| Install deps | `install.bat` | `./install.sh` | `npm install` |
| Start (dev) | `start.bat` | `./start.sh` | `npm start` |
| Start + set broker | `start.bat ws://host:9001` | `./start.sh ws://host:9001` | — |
| Stop | `Ctrl+C` | `Ctrl+C` | `Ctrl+C` |
| Build | — | — | `npm run build` |
| Preview build | — | — | `npm run preview` |

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Status dot stays red, console shows `ERR_CONNECTION_REFUSED` | Broker not reachable or no WebSocket listener. Check the URL (⚙) and [§5](#5-broker-websocket-setup). |
| Connects but no aircraft | Wrong **topic prefix**, or `adsb2mqtt` isn't publishing. Confirm with `mosquitto_sub -t 'adsb/#' -v`. |
| Changed `.env` but nothing happened | Restart the server, and click **Reset** in ⚙ to clear saved browser settings. |
| `node` / `npm` not found | Install Node.js 18+ from <https://nodejs.org/>. |
| Port 5188 in use | Edit `server.port` in [`vite.config.js`](./vite.config.js). |

---

## How it works

| Topic | Use |
|-------|-----|
| `adsb/aircraft/+/+` | Enriched per-field state → aircraft markers + tracks |
| `adsb/stats` | HUD counts |
| `adsb/events/disappeared` | Remove aircraft from the map |

Each field arrives as its own retained plain-string message; the store parses
values, records track points when the aircraft has moved far enough, and the map
interpolates positions every animation frame using ground speed and track.
