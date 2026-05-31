// MQTT-over-WebSocket client that subscribes to the adsb2mqtt topic tree and
// routes messages to the store and event handlers.

import mqtt from 'mqtt';

export class AdsbMqtt {
  /**
   * @param {object} opts
   * @param {string} opts.url       ws:// or wss:// broker URL
   * @param {string} opts.prefix    topic prefix (default "adsb")
   * @param {string} [opts.username]
   * @param {string} [opts.password]
   * @param {object} handlers       { onField, onStats, onAppeared, onDisappeared, onStatus }
   */
  constructor(opts, handlers) {
    this.opts = opts;
    this.handlers = handlers;
    this.client = null;
  }

  connect() {
    const { url, prefix, username, password } = this.opts;
    this._status('connecting', 'Connecting…');

    const client = mqtt.connect(url, {
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
      clean: true,
    });
    this.client = client;

    const topics = [
      `${prefix}/aircraft/+/+`,    // enriched per-field (4 segments only)
      `${prefix}/stats`,
      `${prefix}/events/appeared`,
      `${prefix}/events/disappeared`,
    ];

    client.on('connect', () => {
      client.subscribe(topics, { qos: 0 }, (err) => {
        if (err) this._status('error', `Subscribe failed: ${err.message}`);
        else this._status('connected', 'Connected');
      });
    });

    client.on('reconnect', () => this._status('connecting', 'Reconnecting…'));
    client.on('close', () => this._status('disconnected', 'Disconnected'));
    client.on('error', (err) => this._status('error', err.message || 'Connection error'));

    client.on('message', (topic, payload) => this._route(topic, payload));
  }

  _route(topic, payloadBuf) {
    const parts = topic.split('/');
    const prefix = this.opts.prefix;
    // parts[0] === prefix
    const text = payloadBuf.toString();

    if (parts[1] === 'aircraft' && parts.length === 4) {
      // prefix/aircraft/{icao24}/{field}
      const icao24 = parts[2];
      const field = parts[3];
      this.handlers.onField?.(icao24, field, text);
      return;
    }
    if (parts[1] === 'stats') {
      this.handlers.onStats?.(safeJson(text));
      return;
    }
    if (parts[1] === 'events') {
      const data = safeJson(text);
      if (parts[2] === 'appeared') this.handlers.onAppeared?.(data);
      else if (parts[2] === 'disappeared') this.handlers.onDisappeared?.(data);
    }
  }

  _status(state, msg) {
    this.handlers.onStatus?.(state, msg);
  }

  disconnect() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
