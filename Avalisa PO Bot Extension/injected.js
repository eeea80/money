(function () {
  function isDebugLoggingEnabled() {
    try {
      return window.__AVALISA_DEBUG_LOGS__ === true || window.localStorage?.getItem('avalisaDebugLogs') === '1';
    } catch (_) {
      return window.__AVALISA_DEBUG_LOGS__ === true;
    }
  }

  function debugLog(...args) {
    if (isDebugLoggingEnabled()) console.log(...args);
  }

  function debugWarn(...args) {
    if (isDebugLoggingEnabled()) console.warn(...args);
  }

  function postDebugMessage(message) {
    if (!isDebugLoggingEnabled()) return;
    try { window.postMessage(message, '*'); } catch (_) {}
  }

  // ── WebSocket interceptor ──────────────────────────────────────────────────
  const _WS = window.WebSocket;
  let _latestWs = null;

  function AvalisaWS(url, proto) {
    const ws = proto ? new _WS(url, proto) : new _WS(url);
    // Socket.IO attachment state belongs to this connection, never another socket.
    let _expectHistoryBinary = false;
    let _pendingBinaryEvent = null;

    // Track the latest PO websocket for history requests
    if (url && (url.includes('po.market') || url.includes('pocketoption') || url.includes('po.cash') || url.includes('po.trade'))) {
      _latestWs = ws;
    }

    ws.addEventListener('message', function (e) {
      if (typeof e.data === 'string') {
        // Check for Socket.IO binary event placeholder containing history data
        if (/^45\d/.test(e.data) && (e.data.includes('updateHistoryNewFast') || e.data.includes('updateCharts'))) {
          _expectHistoryBinary = true;
          _pendingBinaryEvent = null;
          debugLog('[Avalisa] History binary expected next frame');
        } else if (/^45\d/.test(e.data)) {
          // Remember which event the NEXT binary frame belongs to. PO sends
          // nearly everything as binary — including successopenOrder and
          // successcloseOrder, the authoritative trade open/result events — and
          // without this the payload arrives anonymously and gets treated as a
          // price tick.
          _expectHistoryBinary = false;
          const m = e.data.match(/\["([^"]+)"/);
          _pendingBinaryEvent = m ? m[1] : null;
        }
        // Text frame — forward as-is
        try { window.postMessage({ type: 'AVALISA_WS', data: e.data }, '*'); } catch (_) {}
      } else if (e.data instanceof Blob) {
        // Binary frame as Blob (default binaryType)
        // Consume metadata before asynchronous Blob decoding; the next event may
        // arrive before text() resolves.
        const isHistory = _expectHistoryBinary;
        const binaryEvent = _pendingBinaryEvent;
        _expectHistoryBinary = false;
        _pendingBinaryEvent = null;
        e.data.text().then(text => {
          if (isHistory) {
            try { window.postMessage({ type: 'AVALISA_WS_HISTORY', data: text }, '*'); } catch (_) {}
          } else if (binaryEvent) {
            const ev = binaryEvent;
            try { window.postMessage({ type: 'AVALISA_WS_BINARY', event: ev, data: text }, '*'); } catch (_) {}
          } else {
            try { window.postMessage({ type: 'AVALISA_WS_TICK', data: text }, '*'); } catch (_) {}
          }
        }).catch(() => {});
      } else if (e.data instanceof ArrayBuffer) {
        // Binary frame as ArrayBuffer (PO sets ws.binaryType = 'arraybuffer')
        try {
          const text = new TextDecoder().decode(e.data);
          if (_expectHistoryBinary) {
            _expectHistoryBinary = false;
            window.postMessage({ type: 'AVALISA_WS_HISTORY', data: text }, '*');
          } else if (_pendingBinaryEvent) {
            const ev = _pendingBinaryEvent; _pendingBinaryEvent = null;
            window.postMessage({ type: 'AVALISA_WS_BINARY', event: ev, data: text }, '*');
          } else {
            window.postMessage({ type: 'AVALISA_WS_TICK', data: text }, '*');
          }
        } catch (_) {}
      }
    });

    // Intercept outgoing send() so we can see what PO requests
    const _send = ws.send.bind(ws);
    ws.send = function (data) {
      postDebugMessage({ type: 'AVALISA_WS_SEND', data: typeof data === 'string' ? data : '[binary]' });
      return _send(data);
    };

    return ws;
  }

  AvalisaWS.prototype = _WS.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => {
    Object.defineProperty(AvalisaWS, k, { value: _WS[k] });
  });
  // Lock the wrap so PO's webpack bundle / globals snapshot can't restore native WebSocket
  try {
    Object.defineProperty(window, 'WebSocket', {
      value: AvalisaWS,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    debugLog('[Avalisa] WebSocket interceptor locked via defineProperty');
  } catch (e) {
    // Fallback if PO already locked it themselves
    window.WebSocket = AvalisaWS;
    debugWarn('[Avalisa] WebSocket interceptor fallback assignment:', e?.message);
  }

  // Expose history request so content.js can call it.
  //
  // Verified live against demo-api-eu.po.market on 2026-08-17: PO silently
  // IGNORES "loadHistoryPeriod" — it never answers, at any index. This function
  // has therefore never fetched anything; the only reason the bot ever had
  // candles is that PO pushes a history frame as a side effect of "changeSymbol"
  // (which the favourite-scanner triggers when it clicks a pair).
  //
  // "changeSymbol" is the verb that actually works, and it lets us name the
  // period, which is what we need: PO always returns a fixed ~1300-1400 raw
  // ticks (~11 minutes), so the candle count we get is span/period —
  // ~22 candles at 30s, but only ~10 at 60s.
  window.avalisaRequestHistory = function (asset, periodSec) {
    if (!_latestWs || _latestWs.readyState !== 1) {
      debugWarn('[Avalisa] avalisaRequestHistory: no ready WS (state:', _latestWs?.readyState, ')');
      return false;
    }
    const msg = '42["changeSymbol",' + JSON.stringify({ asset, period: periodSec }) + ']';
    _latestWs.send(msg);
    debugLog('[Avalisa] History request sent:', msg);
    return true;
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data?.type === 'AVALISA_REQUEST_HISTORY') {
      window.avalisaRequestHistory(event.data.asset, event.data.period);
    } else if (event.data?.type === 'AVALISA_DEBUG_RESPONSE') {
      window.__AVALISA_DEBUG_SNAPSHOT__ = event.data.data;
    }
  });

  window.avDebug = function () {
    window.postMessage({ type: 'AVALISA_DEBUG_REQUEST' }, '*');
    const snapshot = window.__AVALISA_DEBUG_SNAPSHOT__ || {
      ready: false,
      message: 'Avalisa debug snapshot is not ready yet. Try again after the overlay loads.',
    };
    console.log('[Avalisa Debug]', snapshot);
    return snapshot;
  };

  // ── Fetch interceptor — capture PO AI HTTP calls ───────────────────────────
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('avalisa') && !url.includes('onrender')) {
      const body = init?.body || '';
      postDebugMessage({ type: 'AVALISA_FETCH', url, method: init?.method || 'GET', body: typeof body === 'string' ? body.substring(0, 500) : '[binary]' });
    }
    return _fetch.apply(this, arguments).then(res => {
      const clone = res.clone();
      if (!url.includes('avalisa') && !url.includes('onrender')) {
        clone.text().then(text => {
          postDebugMessage({ type: 'AVALISA_FETCH_RES', url, body: text.substring(0, 500) });
        }).catch(() => {});
      }
      return res;
    });
  };

  // ── XHR interceptor ───────────────────────────────────────────────────────
  const _XHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new _XHR();
    const _open = xhr.open.bind(xhr);
    let _url = '', _method = '';
    xhr.open = function (method, url, ...args) {
      _url = url; _method = method;
      return _open(method, url, ...args);
    };
    xhr.addEventListener('load', function () {
      if (!_url.includes('avalisa') && !_url.includes('onrender')) {
        // `responseText` THROWS InvalidStateError unless responseType is '' or 'text'.
        // Pocket Option issues arraybuffer XHRs, so the old unguarded read raised an
        // uncaught error on every one of them (11 in a single one-trade test run) and
        // spammed the console of every user on po.trade. `|| ''` never helped — the
        // getter itself throws. Found by the first working live run, 2026-08-26.
        let body = '';
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            body = (xhr.responseText || '').substring(0, 500);
          }
        } catch (_) { /* non-text response — nothing to trace */ }
        postDebugMessage({ type: 'AVALISA_XHR', url: _url, method: _method, response: body });
      }
    });
    return xhr;
  };

  debugLog('[Avalisa] Interceptors active (WS + Fetch + XHR)');
})();
