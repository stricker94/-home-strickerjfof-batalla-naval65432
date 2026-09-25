/**
 * Batalla Naval — Empresas
 * PvP hot-seat · vs CPU · partida rápida · separación · guardado · stats
 */
(function () {
  "use strict";

  // ——— Constantes ———
  const PREFS_KEY = "batalla-naval-prefs-v2";
  const SAVE_KEY = "batalla-naval-save-v2";
  const MUTE_KEY = "batalla-naval-muted";
  const MUSIC_KEY = "batalla-naval-music";

  const COLS_ALL = "ABCDEFGHIJ".split("");

  const COMPANY_COLORS = {
    apple: "#c5ccd3",
    microsoft: "#00a4ef",
    amazon: "#ff9900",
    google: "#4285f4",
    nvidia: "#76b900",
    aramco: "#00a3e0",
    tesla: "#e31937",
  };

  const FLEET_NORMAL = [
    { id: "apple", name: "Apple", length: 5 },
    { id: "microsoft", name: "Microsoft", length: 4 },
    { id: "amazon", name: "Amazon", length: 4 },
    { id: "google", name: "Google", length: 3 },
    { id: "nvidia", name: "NVIDIA", length: 3 },
    { id: "aramco", name: "Saudi Aramco", length: 3 },
    { id: "tesla", name: "Tesla", length: 2 },
  ];

  // Rapida 8x8: mismas 7 empresas, longitudes reducidas (total 18 casillas)
  const FLEET_RAPIDA = [
    { id: "apple", name: "Apple", length: 4 },
    { id: "microsoft", name: "Microsoft", length: 3 },
    { id: "amazon", name: "Amazon", length: 3 },
    { id: "google", name: "Google", length: 2 },
    { id: "nvidia", name: "NVIDIA", length: 2 },
    { id: "aramco", name: "Saudi Aramco", length: 2 },
    { id: "tesla", name: "Tesla", length: 2 },
  ];

  const prefs = {
    name1: "",
    name2: "",
    mode: "pvp",
    difficulty: "easy",
    boardMode: "normal",
    spacing: false,
    theme: "cyan",
    mute: false,
    music: false,
    largeText: false,
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        Object.keys(prefs).forEach(function (k) {
          if (p[k] !== undefined) prefs[k] = p[k];
        });
      }
      if (localStorage.getItem(MUTE_KEY) === "1") prefs.mute = true;
      if (localStorage.getItem(MUTE_KEY) === "0") prefs.mute = false;
      if (localStorage.getItem(MUSIC_KEY) === "1") prefs.music = true;
      if (localStorage.getItem(MUSIC_KEY) === "0") prefs.music = false;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      localStorage.setItem(MUTE_KEY, prefs.mute ? "1" : "0");
      localStorage.setItem(MUSIC_KEY, prefs.music ? "1" : "0");
    } catch (e) {}
  }

  function emptyStats() {
    return { shots: 0, hits: 0, shipsSunk: 0, turns: 0 };
  }

  function createPlayer(name, isCpu) {
    return {
      name: name,
      isCpu: !!isCpu,
      board: null,
      ships: [],
      shots: {},
      stats: emptyStats(),
    };
  }

  const state = {
    phase: "start",
    mode: "pvp",
    difficulty: "easy",
    boardSize: 10,
    boardMode: "normal",
    spacing: false,
    fleetTemplate: FLEET_NORMAL,
    players: [createPlayer("Jugador 1"), createPlayer("Jugador 2")],
    placing: {
      playerIndex: 0,
      selectedShipId: null,
      orientation: "H",
      ships: [],
      occupied: {},
    },
    handoff: { nextAction: null, title: "", message: "" },
    battle: {
      attacker: 0,
      awaitingHandoff: false,
      lastResult: null,
      inputLocked: false,
    },
    cpu: { huntQueue: [], huntHits: [], huntDir: null },
    winner: null,
    turnCount: 0,
  };

  let placePreview = { cells: null, valid: false };
  let theaterTimer = null;
  let cpuTimer = null;

  const $ = function (sel) { return document.querySelector(sel); };
  const screens = {
    start: $("#screen-start"),
    handoff: $("#screen-handoff"),
    placement: $("#screen-placement"),
    battle: $("#screen-battle"),
    win: $("#screen-win"),
  };

  function boardSize() { return state.boardSize; }
  function cols() { return COLS_ALL.slice(0, boardSize()); }
  function fleetTemplate() { return state.fleetTemplate; }
  function companyColor(id) { return COMPANY_COLORS[id] || "#67e8f9"; }

  function showScreen(name) {
    Object.values(screens).forEach(function (el) { el.classList.remove("active"); });
    screens[name].classList.add("active");
    state.phase = name === "placement" ? "place" : name;
    showHud(true);
  }

  function showHud(visible) {
    const hud = $("#hud-controls");
    if (!hud) return;
    if (visible) hud.removeAttribute("hidden");
    else hud.setAttribute("hidden", "");
  }

  function toast(msg, ms) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }

  function key(r, c) { return r + "," + c; }

  function cloneFleet() {
    return fleetTemplate().map(function (s) {
      return { id: s.id, name: s.name, length: s.length, cells: [], hits: 0, sunk: false };
    });
  }

  function emptyBoard() {
    var n = boardSize();
    return Array.from({ length: n }, function () {
      return Array.from({ length: n }, function () { return null; });
    });
  }

  function opponentOf(i) { return i === 0 ? 1 : 0; }
  function playerLabel(i) { return state.players[i].name; }
  function isCpuMode() { return state.mode === "cpu"; }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ——— Audio ———
  let audioCtx = null;
  let musicNodes = null;
  let musicPlaying = false;

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function setMuted(value) {
    prefs.mute = !!value;
    savePrefs();
    updateMuteButton();
  }

  function updateMuteButton() {
    var btn = $("#btn-mute");
    if (!btn) return;
    btn.classList.toggle("is-muted", prefs.mute);
    btn.setAttribute("aria-pressed", prefs.mute ? "true" : "false");
    btn.setAttribute("aria-label", prefs.mute ? "Activar efectos" : "Silenciar efectos");
    var icon = btn.querySelector(".mute-icon");
    var label = btn.querySelector(".mute-label");
    if (icon) icon.textContent = prefs.mute ? "🔇" : "🔊";
    if (label) label.textContent = prefs.mute ? "Silencio" : "Sonido";
  }

  function tone(ctx, freq, start, dur, type, gainPeak, dest) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gainPeak, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest || ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function noiseBurst(ctx, start, dur, gainPeak, bandFreq) {
    var sampleRate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(sampleRate * dur));
    var buffer = ctx.createBuffer(1, len, sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = bandFreq || 600;
    filter.Q.value = 0.8;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gainPeak, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  var SFX = {
    miss: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      var t = ctx.currentTime;
      noiseBurst(ctx, t, 0.28, 0.22, 480);
      tone(ctx, 220, t, 0.18, "sine", 0.08);
      tone(ctx, 160, t + 0.05, 0.2, "sine", 0.05);
    },
    hit: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      var t = ctx.currentTime;
      tone(ctx, 420, t, 0.08, "square", 0.12);
      tone(ctx, 180, t + 0.04, 0.14, "sawtooth", 0.1);
      noiseBurst(ctx, t, 0.12, 0.18, 1200);
    },
    sunk: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      var t = ctx.currentTime;
      tone(ctx, 196, t, 0.22, "triangle", 0.14);
      tone(ctx, 247, t + 0.12, 0.22, "triangle", 0.13);
      tone(ctx, 294, t + 0.24, 0.28, "triangle", 0.14);
      tone(ctx, 147, t + 0.4, 0.35, "sine", 0.12);
      noiseBurst(ctx, t, 0.2, 0.12, 400);
    },
    win: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      var t = ctx.currentTime;
      [262, 330, 392, 523].forEach(function (f, i) {
        tone(ctx, f, t + i * 0.12, 0.22, "triangle", 0.11);
      });
      tone(ctx, 659, t + 0.5, 0.35, "sine", 0.1);
    },
    place: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      var t = ctx.currentTime;
      tone(ctx, 520, t, 0.06, "sine", 0.05);
      tone(ctx, 680, t + 0.04, 0.07, "sine", 0.04);
    },
    click: function () {
      var ctx = ensureAudio();
      if (!ctx) return;
      tone(ctx, 880, ctx.currentTime, 0.04, "sine", 0.035);
    },
  };

  function playSfx(name) {
    if (prefs.mute) return;
    var fn = SFX[name];
    if (fn) {
      try { fn(); } catch (e) {}
    }
  }

  function stopMusicHard() {
    if (musicNodes) {
      try {
        musicNodes.oscs.forEach(function (o) {
          try { o.stop(); } catch (e) {}
        });
        if (musicNodes.lfo) {
          try { musicNodes.lfo.stop(); } catch (e) {}
        }
      } catch (e) {}
      musicNodes = null;
    }
    musicPlaying = false;
  }

  function startMusic() {
    var ctx = ensureAudio();
    if (!ctx || !prefs.music) return;
    stopMusicHard();
    var master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 1.2);

    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    filter.connect(master);

    var freqs = [110, 146.83, 164.81, 196];
    var oscs = freqs.map(function (f, i) {
      var osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      var g = ctx.createGain();
      g.gain.value = 0.18 - i * 0.03;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      return osc;
    });

    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.08;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    musicNodes = { oscs: oscs, lfo: lfo, gain: master };
    musicPlaying = true;
    updateMusicButton();
  }

  function setMusic(on) {
    prefs.music = !!on;
    savePrefs();
    if (prefs.music) {
      ensureAudio();
      startMusic();
    } else {
      stopMusicHard();
      updateMusicButton();
    }
  }

  function updateMusicButton() {
    var btn = $("#btn-music");
    if (!btn) return;
    btn.setAttribute("aria-pressed", prefs.music ? "true" : "false");
    var label = btn.querySelector(".hud-label");
    if (label) label.textContent = prefs.music ? "Música on" : "Música";
  }

  // ——— Animaciones ———
  function findEnemyCell(r, c) {
    return document.querySelector('#enemy-board .cell[data-r="' + r + '"][data-c="' + c + '"]');
  }
  function findOwnCell(r, c) {
    return document.querySelector('#own-board .cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function animateCell(el, className, ms) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(function () { el.classList.remove(className); }, ms || 600);
  }

  function clearTheater() {
    clearTimeout(theaterTimer);
    var overlay = $("#theater-overlay");
    if (overlay) {
      overlay.classList.remove("show");
      overlay.hidden = true;
    }
    document.querySelectorAll(".board-panel.theater-focus").forEach(function (p) {
      p.classList.remove("theater-focus");
    });
    document.querySelectorAll(".cell.theater-ship").forEach(function (c) {
      c.classList.remove("theater-ship");
    });
  }

  function showSunkBanner(shipName) {
    var el = $("#sunk-banner");
    if (!el) return;
    el.hidden = false;
    el.textContent = "¡Hundiste " + shipName + "!";
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(showSunkBanner._t);
    showSunkBanner._t = setTimeout(function () {
      el.classList.remove("show");
      el.hidden = true;
    }, 1100);
  }

  function playTheaterMode(shipCells, onEnemyBoard) {
    clearTheater();
    var overlay = $("#theater-overlay");
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add("show");
    }
    var boardSel = onEnemyBoard ? "#enemy-board" : "#own-board";
    var boardEl = document.querySelector(boardSel);
    var panel = boardEl && boardEl.closest(".board-panel");
    if (panel) panel.classList.add("theater-focus");

    (shipCells || []).forEach(function (cell) {
      var el = onEnemyBoard ? findEnemyCell(cell.r, cell.c) : findOwnCell(cell.r, cell.c);
      if (el) {
        el.classList.add("theater-ship");
        animateCell(el, "anim-sunk-glow", 900);
      }
    });
    theaterTimer = setTimeout(clearTheater, 1100);
  }

  function spawnWinConfetti() {
    var card = document.querySelector(".win-card");
    if (!card) return;
    card.classList.add("celebrate");
    var layer = card.querySelector(".win-confetti");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "win-confetti";
      layer.setAttribute("aria-hidden", "true");
      card.prepend(layer);
    }
    layer.innerHTML = "";
    var reduceMotion = false;
    try {
      reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    if (reduceMotion) {
      setTimeout(function () { card.classList.remove("celebrate"); }, 200);
      return;
    }
    var colors = ["#22d3ee", "#fbbf24", "#f43f5e", "#34d399", "#a78bfa", "#f8fafc", "#60a5fa"];
    for (var i = 0; i < 28; i++) {
      var s = document.createElement("span");
      s.style.left = 4 + Math.random() * 92 + "%";
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = Math.random() * 0.35 + "s";
      s.style.animationDuration = 0.9 + Math.random() * 0.45 + "s";
      s.style.width = 6 + Math.floor(Math.random() * 6) + "px";
      s.style.height = 10 + Math.floor(Math.random() * 8) + "px";
      s.style.transform = "rotate(" + Math.floor(Math.random() * 80) + "deg)";
      layer.appendChild(s);
    }
    setTimeout(function () {
      card.classList.remove("celebrate");
      layer.innerHTML = "";
    }, 1400);
  }

  // ——— Colocacion ———
  function getShipCells(r, c, length, orientation) {
    var cells = [];
    for (var i = 0; i < length; i++) {
      cells.push({
        r: orientation === "H" ? r : r + i,
        c: orientation === "H" ? c + i : c,
      });
    }
    return cells;
  }

  function canPlace(cells, occupied, ignoreShipId) {
    var n = boardSize();
    var i, j, r, c, occ, rr, cc;
    for (i = 0; i < cells.length; i++) {
      r = cells[i].r;
      c = cells[i].c;
      if (r < 0 || r >= n || c < 0 || c >= n) return false;
      occ = occupied[key(r, c)];
      if (occ && occ !== ignoreShipId) return false;
    }
    if (!state.spacing) return true;

    // Separacion: sin tocar incluyendo diagonales
    for (i = 0; i < cells.length; i++) {
      r = cells[i].r;
      c = cells[i].c;
      for (rr = r - 1; rr <= r + 1; rr++) {
        for (cc = c - 1; cc <= c + 1; cc++) {
          if (rr === r && cc === c) continue;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          var isSelf = false;
          for (j = 0; j < cells.length; j++) {
            if (cells[j].r === rr && cells[j].c === cc) {
              isSelf = true;
              break;
            }
          }
          if (isSelf) continue;
          occ = occupied[key(rr, cc)];
          if (occ && occ !== ignoreShipId) return false;
        }
      }
    }
    return true;
  }

  function placeShipOnPlacing(shipId, r, c) {
    var ship = state.placing.ships.find(function (s) { return s.id === shipId; });
    if (!ship || ship.cells.length) return false;
    var cells = getShipCells(r, c, ship.length, state.placing.orientation);
    if (!canPlace(cells, state.placing.occupied, null)) return false;
    ship.cells = cells;
    cells.forEach(function (cell) {
      state.placing.occupied[key(cell.r, cell.c)] = shipId;
    });
    return true;
  }

  function removeShipFromPlacing(shipId) {
    var ship = state.placing.ships.find(function (s) { return s.id === shipId; });
    if (!ship || !ship.cells.length) return;
    ship.cells.forEach(function (cell) {
      delete state.placing.occupied[key(cell.r, cell.c)];
    });
    ship.cells = [];
  }

  function allShipsPlaced() {
    return state.placing.ships.every(function (s) {
      return s.cells.length === s.length;
    });
  }

  function randomPlaceAll() {
    var attempts = 0;
    while (attempts < 80) {
      attempts++;
      state.placing.ships.forEach(function (s) { removeShipFromPlacing(s.id); });
      var order = state.placing.ships.slice().sort(function (a, b) {
        return b.length - a.length;
      });
      var ok = true;
      for (var si = 0; si < order.length; si++) {
        var ship = order[si];
        var placed = false;
        for (var attempt = 0; attempt < 500 && !placed; attempt++) {
          var orientation = Math.random() < 0.5 ? "H" : "V";
          var n = boardSize();
          var maxR = orientation === "H" ? n : n - ship.length + 1;
          var maxC = orientation === "H" ? n - ship.length + 1 : n;
          if (maxR < 1 || maxC < 1) break;
          var r = Math.floor(Math.random() * maxR);
          var c = Math.floor(Math.random() * maxC);
          state.placing.orientation = orientation;
          placed = placeShipOnPlacing(ship.id, r, c);
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) {
        state.placing.orientation = "H";
        state.placing.selectedShipId = null;
        return true;
      }
    }
    toast("No se pudo colocar al azar; prueba sin separación o reintenta");
    return false;
  }

  function commitPlacement(playerIndex) {
    var board = emptyBoard();
    var ships = state.placing.ships.map(function (s) {
      return {
        id: s.id,
        name: s.name,
        length: s.length,
        cells: s.cells.map(function (cell) { return { r: cell.r, c: cell.c }; }),
        hits: 0,
        sunk: false,
      };
    });
    ships.forEach(function (ship) {
      ship.cells.forEach(function (cell) {
        board[cell.r][cell.c] = ship.id;
      });
    });
    state.players[playerIndex].board = board;
    state.players[playerIndex].ships = ships;
    state.players[playerIndex].shots = {};
    if (!state.players[playerIndex].stats) {
      state.players[playerIndex].stats = emptyStats();
    }
  }

  function placeFleetRandomForPlayer(playerIndex) {
    state.placing = {
      playerIndex: playerIndex,
      selectedShipId: null,
      orientation: "H",
      ships: cloneFleet(),
      occupied: {},
    };
    if (!randomPlaceAll()) {
      var was = state.spacing;
      state.spacing = false;
      randomPlaceAll();
      state.spacing = was;
    }
    commitPlacement(playerIndex);
  }

  // ——— Disparos ———
  function fireShot(attackerIndex, r, c) {
    var defender = opponentOf(attackerIndex);
    var shotKey = key(r, c);
    var attackerShots = state.players[attackerIndex].shots;

    if (attackerShots[shotKey]) {
      return { ok: false, reason: "already" };
    }

    var shipId = state.players[defender].board[r][c];
    var stats = state.players[attackerIndex].stats;
    stats.shots += 1;

    if (!shipId) {
      attackerShots[shotKey] = "miss";
      return { ok: true, result: "miss", cell: { r: r, c: c } };
    }

    attackerShots[shotKey] = "hit";
    stats.hits += 1;
    var ship = state.players[defender].ships.find(function (s) { return s.id === shipId; });
    ship.hits += 1;

    if (ship.hits >= ship.length) {
      ship.sunk = true;
      stats.shipsSunk += 1;
      ship.cells.forEach(function (cell) {
        attackerShots[key(cell.r, cell.c)] = "sunk";
      });
      var allSunk = state.players[defender].ships.every(function (s) { return s.sunk; });
      return {
        ok: true,
        result: "sunk",
        shipName: ship.name,
        shipId: ship.id,
        cell: { r: r, c: c },
        cells: ship.cells.slice(),
        win: allSunk,
      };
    }

    return {
      ok: true,
      result: "hit",
      shipName: ship.name,
      shipId: shipId,
      cell: { r: r, c: c },
    };
  }

  // ——— CPU ———
  function resetCpuAi() {
    state.cpu = { huntQueue: [], huntHits: [], huntDir: null };
  }

  function neighbors4(r, c) {
    var n = boardSize();
    return [
      { r: r - 1, c: c },
      { r: r + 1, c: c },
      { r: r, c: c - 1 },
      { r: r, c: c + 1 },
    ].filter(function (p) {
      return p.r >= 0 && p.r < n && p.c >= 0 && p.c < n;
    });
  }

  function unshotCells(attackerIndex) {
    var shots = state.players[attackerIndex].shots;
    var n = boardSize();
    var list = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!shots[key(r, c)]) list.push({ r: r, c: c });
      }
    }
    return list;
  }

  function pickRandom(list) {
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  function enqueueHuntAround(r, c, attackerIndex) {
    var shots = state.players[attackerIndex].shots;
    neighbors4(r, c).forEach(function (p) {
      if (shots[key(p.r, p.c)]) return;
      var exists = state.cpu.huntQueue.some(function (q) {
        return q.r === p.r && q.c === p.c;
      });
      if (!exists) state.cpu.huntQueue.push(p);
    });
  }

  function updateCpuAfterShot(result, attackerIndex) {
    if (result.result === "sunk") {
      state.cpu.huntQueue = [];
      state.cpu.huntHits = [];
      state.cpu.huntDir = null;
      return;
    }
    if (state.difficulty === "easy") {
      if (result.result === "hit") {
        enqueueHuntAround(result.cell.r, result.cell.c, attackerIndex);
      }
      return;
    }

    if (result.result === "miss") {
      if (state.cpu.huntDir && state.cpu.huntHits.length) {
        var first = state.cpu.huntHits[0];
        state.cpu.huntDir = {
          dr: -state.cpu.huntDir.dr,
          dc: -state.cpu.huntDir.dc,
        };
        state.cpu.huntQueue = [
          { r: first.r + state.cpu.huntDir.dr, c: first.c + state.cpu.huntDir.dc },
        ].concat(state.cpu.huntQueue);
        state.cpu.huntQueue = state.cpu.huntQueue.filter(function (p) {
          var n = boardSize();
          return (
            p.r >= 0 && p.r < n && p.c >= 0 && p.c < n &&
            !state.players[attackerIndex].shots[key(p.r, p.c)]
          );
        });
      }
      return;
    }

    if (result.result === "hit") {
      state.cpu.huntHits.push({ r: result.cell.r, c: result.cell.c });
      if (state.difficulty === "hard" && state.cpu.huntHits.length >= 2) {
        var a = state.cpu.huntHits[state.cpu.huntHits.length - 2];
        var b = state.cpu.huntHits[state.cpu.huntHits.length - 1];
        var dr = b.r - a.r;
        var dc = b.c - a.c;
        if (Math.abs(dr) + Math.abs(dc) === 1) {
          state.cpu.huntDir = { dr: dr, dc: dc };
          var next = { r: b.r + dr, c: b.c + dc };
          state.cpu.huntQueue = [next].concat(
            state.cpu.huntQueue.filter(function (p) {
              return !(p.r === next.r && p.c === next.c);
            })
          );
        }
      }
      enqueueHuntAround(result.cell.r, result.cell.c, attackerIndex);
      return;
    }

  }

  function scoreHardTarget(cell, attackerIndex) {
    var shots = state.players[attackerIndex].shots;
    var score = (cell.r + cell.c) % 2 === 0 ? 2 : 0;
    var missAdj = 0;
    neighbors4(cell.r, cell.c).forEach(function (p) {
      if (shots[key(p.r, p.c)] === "miss") missAdj++;
    });
    score -= missAdj * 0.5;
    var open = neighbors4(cell.r, cell.c).filter(function (p) {
      return !shots[key(p.r, p.c)];
    }).length;
    score += open * 0.25;
    return score;
  }

  function chooseCpuShot(attackerIndex) {
    var shots = state.players[attackerIndex].shots;
    var open = unshotCells(attackerIndex);
    if (!open.length) return null;

    if (state.difficulty === "easy") {
      if (state.cpu.huntQueue.length && Math.random() < 0.1) {
        while (state.cpu.huntQueue.length) {
          var q = state.cpu.huntQueue.shift();
          if (!shots[key(q.r, q.c)]) return q;
        }
      }
      return pickRandom(open);
    }

    while (state.cpu.huntQueue.length) {
      var h = state.cpu.huntQueue.shift();
      if (!shots[key(h.r, h.c)]) return h;
    }

    if (state.difficulty === "hard" && state.cpu.huntHits.length) {
      var lastHit = state.cpu.huntHits[state.cpu.huntHits.length - 1];
      enqueueHuntAround(lastHit.r, lastHit.c, attackerIndex);
      while (state.cpu.huntQueue.length) {
        var h2 = state.cpu.huntQueue.shift();
        if (!shots[key(h2.r, h2.c)]) return h2;
      }
    }

    if (state.difficulty === "hard") {
      var best = null;
      var bestScore = -Infinity;
      open.forEach(function (cell) {
        var sc = scoreHardTarget(cell, attackerIndex) + Math.random() * 0.3;
        if (sc > bestScore) {
          bestScore = sc;
          best = cell;
        }
      });
      return best;
    }

    return pickRandom(open);
  }

  // ——— Guardar / reanudar ———
  function serializeState() {
    return {
      v: 2,
      mode: state.mode,
      difficulty: state.difficulty,
      boardSize: state.boardSize,
      boardMode: state.boardMode,
      spacing: state.spacing,
      phase: state.phase,
      players: state.players.map(function (p) {
        return {
          name: p.name,
          isCpu: p.isCpu,
          board: p.board,
          ships: p.ships,
          shots: p.shots,
          stats: p.stats,
        };
      }),
      placing: state.phase === "place" ? state.placing : null,
      battle: {
        attacker: state.battle.attacker,
        lastResult: state.battle.lastResult,
      },
      cpu: state.cpu,
      winner: state.winner,
      turnCount: state.turnCount,
    };
  }

  function saveGame() {
    try {
      if (state.phase === "place" || state.phase === "battle") {
        localStorage.setItem(SAVE_KEY, JSON.stringify(serializeState()));
      }
    } catch (e) {}
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    updateContinueUI();
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 2) return null;
      if (!data.players || data.players.length !== 2) return null;
      if (data.phase !== "place" && data.phase !== "battle") return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function hasValidSave() { return !!loadSave(); }

  function applySave(data) {
    state.mode = data.mode;
    state.difficulty = data.difficulty || "easy";
    state.boardSize = data.boardSize || 10;
    state.boardMode = data.boardMode || "normal";
    state.spacing = !!data.spacing;
    state.fleetTemplate = state.boardMode === "rapida" ? FLEET_RAPIDA : FLEET_NORMAL;
    state.players = data.players.map(function (p) {
      return {
        name: p.name,
        isCpu: !!p.isCpu,
        board: p.board,
        ships: p.ships || [],
        shots: p.shots || {},
        stats: p.stats || emptyStats(),
      };
    });
    state.cpu = data.cpu || { huntQueue: [], huntHits: [], huntDir: null };
    state.winner = data.winner;
    state.turnCount = data.turnCount || 0;
    state.battle.awaitingHandoff = false;
    state.battle.inputLocked = false;
    state.battle.attacker = (data.battle && data.battle.attacker) || 0;
    state.battle.lastResult = (data.battle && data.battle.lastResult) || null;

    if (data.phase === "place" && data.placing) {
      state.placing = data.placing;
      placePreview = { cells: null, valid: false };
      showScreen("placement");
      $("#placement-title").textContent = playerLabel(state.placing.playerIndex) + ": coloca tu flota";
      $("#placement-subtitle").textContent = "Selecciona un barco, gira (R) y haz clic en el tablero.";
      updatePlacementHint();
      renderPlacement();
    } else if (data.phase === "battle") {
      showBattleFor(state.battle.attacker);
      if (isCpuMode() && state.players[state.battle.attacker].isCpu) {
        scheduleCpuTurn();
      }
    }
  }

  function updateContinueUI() {
    var row = $("#continue-row");
    var form = $("#start-form");
    if (!row) return;
    if (hasValidSave()) {
      row.hidden = false;
      if (form) form.style.display = "none";
    } else {
      row.hidden = true;
      if (form) form.style.display = "";
    }
  }

  // ——— Render ———
  function renderFleetPreview() {
    var mode =
      (document.querySelector('input[name="board-size"]:checked') || {}).value ||
      prefs.boardMode;
    var fleet = mode === "rapida" ? FLEET_RAPIDA : FLEET_NORMAL;
    var ul = $("#fleet-preview-list");
    var title = $("#fleet-preview-title");
    if (title) {
      title.textContent =
        mode === "rapida" ? "Flota rápida 8×8 (ambos)" : "La flota (ambos jugadores)";
    }
    ul.innerHTML = fleet
      .map(function (s) {
        return (
          '<li><span><span class="chip" style="background:' +
          companyColor(s.id) +
          ';--chip-color:' +
          companyColor(s.id) +
          '"></span>' +
          escapeHtml(s.name) +
          '</span><span class="len">' +
          s.length +
          " casillas</span></li>"
        );
      })
      .join("");
  }

  function buildBoard(container, options) {
    var mode = options.mode;
    var occupied = options.occupied;
    var shots = options.shots;
    var interactive = options.interactive;
    var onCellClick = options.onCellClick;
    var onCellHover = options.onCellHover;
    var onCellLeave = options.onCellLeave;
    var previewCells = options.previewCells;
    var previewValid = options.previewValid;
    var n = boardSize();
    var letters = cols();

    container.innerHTML = "";
    container.style.setProperty("--board-n", String(n));
    container.style.setProperty(
      "--cell",
      "min(36px, " + (mode === "place" ? "7.2vw" : n <= 8 ? "7vw" : "6.2vw") + ")"
    );

    var corner = document.createElement("div");
    corner.className = "corner";
    container.appendChild(corner);

    letters.forEach(function (letter) {
      var lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = letter;
      container.appendChild(lab);
    });

    for (var r = 0; r < n; r++) {
      var rowLab = document.createElement("div");
      rowLab.className = "label";
      rowLab.textContent = String(r + 1);
      container.appendChild(rowLab);

      for (var c = 0; c < n; c++) {
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", letters[c] + (r + 1));

        var k = key(r, c);

        if (mode === "place") {
          if (occupied && occupied[k]) {
            cell.classList.add("ship");
            cell.style.setProperty("--ship-color", companyColor(occupied[k]));
          }
          if (previewCells) {
            var inPrev = previewCells.some(function (p) {
              return p.r === r && p.c === c;
            });
            if (inPrev) {
              cell.classList.add("ship-preview");
              if (!previewValid) cell.classList.add("invalid");
            }
          }
        }

        if (mode === "own") {
          if (occupied && occupied[k]) {
            cell.classList.add("ship");
            cell.style.setProperty("--ship-color", companyColor(occupied[k]));
          }
          if (shots && shots[k] === "miss") cell.classList.add("miss");
          if (shots && (shots[k] === "hit" || shots[k] === "sunk")) {
            cell.classList.add("hit");
            if (shots[k] === "sunk") cell.classList.add("sunk");
          }
        }

        if (mode === "enemy") {
          if (shots && shots[k] === "miss") cell.classList.add("miss");
          if (shots && shots[k] === "hit") cell.classList.add("hit");
          if (shots && shots[k] === "sunk") cell.classList.add("hit", "sunk");
        }

        if (interactive && !(shots && shots[k])) {
          cell.classList.add("interactive");
          cell.tabIndex = 0;
          (function (rr, cc) {
            if (onCellClick) {
              cell.addEventListener("click", function () { onCellClick(rr, cc); });
              cell.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCellClick(rr, cc);
                }
              });
            }
            if (onCellHover) {
              cell.addEventListener("mouseenter", function () { onCellHover(rr, cc); });
            }
          })(r, c);
          if (onCellLeave) {
            cell.addEventListener("mouseleave", function () { onCellLeave(); });
          }
        } else {
          if (onCellHover) {
            (function (rr, cc) {
              cell.addEventListener("mouseenter", function () { onCellHover(rr, cc); });
            })(r, c);
          }
          if (onCellLeave) {
            cell.addEventListener("mouseleave", function () { onCellLeave(); });
          }
        }

        container.appendChild(cell);
      }
    }
  }

  function updatePlacementHint() {
    var hint = $("#placement-hint");
    if (!hint) return;
    hint.textContent = state.spacing
      ? "Selecciona un barco, gira (R) y haz clic. Sin solapar ni tocar (incluye diagonales)."
      : "Selecciona un barco, gira si hace falta y haz clic en el tablero. No se pueden solapar.";
  }

  function startPlacement(playerIndex) {
    state.placing = {
      playerIndex: playerIndex,
      selectedShipId: fleetTemplate()[0].id,
      orientation: "H",
      ships: cloneFleet(),
      occupied: {},
    };
    placePreview = { cells: null, valid: false };
    showScreen("placement");
    $("#placement-title").textContent = playerLabel(playerIndex) + ": coloca tu flota";
    $("#placement-subtitle").textContent =
      "Selecciona un barco, gira (R) y haz clic en el tablero.";
    updatePlacementHint();
    renderPlacement();
    saveGame();
  }

  function renderPlacement() {
    var list = $("#ship-list");
    list.innerHTML = "";

    state.placing.ships.forEach(function (ship) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ship-item";
      btn.style.setProperty("--ship-color", companyColor(ship.id));
      if (ship.cells.length) btn.classList.add("placed");
      if (state.placing.selectedShipId === ship.id && !ship.cells.length) {
        btn.classList.add("selected");
      }
      if (ship.cells.length) btn.disabled = true;

      var dots = Array.from({ length: ship.length })
        .map(function () {
          return (
            '<span class="ship-cell-dot" style="background:' +
            companyColor(ship.id) +
            '"></span>'
          );
        })
        .join("");

      btn.innerHTML =
        '<span class="ship-name-row"><span class="ship-chip" style="background:' +
        companyColor(ship.id) +
        '"></span><span class="ship-name">' +
        escapeHtml(ship.name) +
        '</span></span><span class="ship-cells">' +
        dots +
        "</span>";

      if (!ship.cells.length) {
        btn.addEventListener("click", function () {
          playSfx("click");
          state.placing.selectedShipId = ship.id;
          placePreview = { cells: null, valid: false };
          renderPlacement();
        });
      }
      list.appendChild(btn);
    });

    buildBoard($("#placement-board"), {
      mode: "place",
      occupied: state.placing.occupied,
      previewCells: placePreview.cells,
      previewValid: placePreview.valid,
      interactive: true,
      onCellClick: onPlaceClick,
      onCellHover: onPlaceHover,
      onCellLeave: function () {
        placePreview = { cells: null, valid: false };
        renderPlacementBoardOnly();
      },
    });

    $("#btn-confirm-placement").disabled = !allShipsPlaced();
  }

  function renderPlacementBoardOnly() {
    buildBoard($("#placement-board"), {
      mode: "place",
      occupied: state.placing.occupied,
      previewCells: placePreview.cells,
      previewValid: placePreview.valid,
      interactive: true,
      onCellClick: onPlaceClick,
      onCellHover: onPlaceHover,
      onCellLeave: function () {
        placePreview = { cells: null, valid: false };
        renderPlacementBoardOnly();
      },
    });
  }

  function onPlaceHover(r, c) {
    var id = state.placing.selectedShipId;
    if (!id) {
      placePreview = { cells: null, valid: false };
      renderPlacementBoardOnly();
      return;
    }
    var ship = state.placing.ships.find(function (s) { return s.id === id; });
    if (!ship || ship.cells.length) return;
    var cells = getShipCells(r, c, ship.length, state.placing.orientation);
    placePreview = { cells: cells, valid: canPlace(cells, state.placing.occupied, null) };
    renderPlacementBoardOnly();
  }

  function onPlaceClick(r, c) {
    var id = state.placing.selectedShipId;
    if (!id) {
      toast("Selecciona un barco de la lista");
      return;
    }
    var ship = state.placing.ships.find(function (s) { return s.id === id; });
    if (!ship || ship.cells.length) return;
    if (!placeShipOnPlacing(id, r, c)) {
      toast(
        state.spacing
          ? "No cabe — gira, deja espacio o elige otra casilla"
          : "No cabe ahí — gira o elige otra casilla"
      );
      return;
    }
    playSfx("place");
    var next = state.placing.ships.find(function (s) { return !s.cells.length; });
    state.placing.selectedShipId = next ? next.id : null;
    placePreview = { cells: null, valid: false };
    renderPlacement();
    saveGame();
  }

  function toggleOrientation() {
    state.placing.orientation = state.placing.orientation === "H" ? "V" : "H";
    toast(
      state.placing.orientation === "H" ? "Orientación: horizontal" : "Orientación: vertical",
      1200
    );
    placePreview = { cells: null, valid: false };
    renderPlacementBoardOnly();
  }

  function showHandoff(title, message, nextAction) {
    state.handoff = { title: title, message: message, nextAction: nextAction };
    $("#handoff-title").textContent = title;
    $("#handoff-msg").innerHTML = message;
    showScreen("handoff");
  }

  // ——— Batalla ———
  function fleetStatusHtml(ships, showHits) {
    return ships
      .map(function (s) {
        return (
          '<li class="' +
          (s.sunk ? "sunk-ship" : "") +
          '"><span class="status-left"><span class="ship-chip" style="background:' +
          companyColor(s.id) +
          '"></span><span>' +
          escapeHtml(s.name) +
          '</span></span><span class="status-tag">' +
          (s.sunk ? "Hundido" : showHits ? s.hits + "/" + s.length : "En juego") +
          "</span></li>"
        );
      })
      .join("");
  }

  function renderPvpBoards(attackerIndex) {
    var defender = opponentOf(attackerIndex);
    var ownOccupied = {};
    state.players[attackerIndex].ships.forEach(function (ship) {
      ship.cells.forEach(function (cell) {
        ownOccupied[key(cell.r, cell.c)] = ship.id;
      });
    });
    var canShoot =
      !state.battle.awaitingHandoff &&
      !state.battle.inputLocked &&
      !state.players[attackerIndex].isCpu;

    buildBoard($("#own-board"), {
      mode: "own",
      occupied: ownOccupied,
      shots: state.players[defender].shots,
      interactive: false,
    });
    buildBoard($("#enemy-board"), {
      mode: "enemy",
      shots: state.players[attackerIndex].shots,
      interactive: canShoot,
      onCellClick: onFireClick,
    });
    $("#own-fleet-status").innerHTML = fleetStatusHtml(state.players[attackerIndex].ships, true);
    $("#enemy-fleet-status").innerHTML = fleetStatusHtml(state.players[defender].ships, false);
  }

  function renderCpuHumanView(canShoot) {
    var human = 0;
    var cpu = 1;
    var ownOccupied = {};
    state.players[human].ships.forEach(function (ship) {
      ship.cells.forEach(function (cell) {
        ownOccupied[key(cell.r, cell.c)] = ship.id;
      });
    });
    buildBoard($("#own-board"), {
      mode: "own",
      occupied: ownOccupied,
      shots: state.players[cpu].shots,
      interactive: false,
    });
    buildBoard($("#enemy-board"), {
      mode: "enemy",
      shots: state.players[human].shots,
      interactive: !!canShoot,
      onCellClick: onFireClick,
    });
    $("#own-fleet-status").innerHTML = fleetStatusHtml(state.players[human].ships, true);
    $("#enemy-fleet-status").innerHTML = fleetStatusHtml(state.players[cpu].ships, false);
  }

  function startBattle() {
    state.battle.attacker = 0;
    state.battle.awaitingHandoff = false;
    state.battle.inputLocked = false;
    state.battle.lastResult = null;
    state.turnCount = 0;
    resetCpuAi();
    showBattleFor(0);
    saveGame();
  }

  function showBattleFor(attackerIndex) {
    state.battle.attacker = attackerIndex;
    state.battle.inputLocked = !!state.players[attackerIndex].isCpu;
    state.players[attackerIndex].stats.turns += 1;
    state.turnCount += 1;
    showScreen("battle");

    var attacker = state.players[attackerIndex];
    $("#battle-title").textContent = "Turno de " + attacker.name;
    $("#turn-badge").textContent = attacker.name;

    var log = $("#battle-log");
    log.className = "battle-log";

    if (isCpuMode()) {
      var human = 0;
      var cpu = 1;
      $("#battle-subtitle").textContent = attacker.isCpu
        ? "La CPU está disparando…"
        : "Haz clic en el tablero enemigo para disparar.";
      $("#enemy-board-label").textContent = "Tablero de " + state.players[cpu].name;
      $("#own-board-label").textContent = "Tu flota (" + state.players[human].name + ")";
      $("#own-fleet-label").textContent = "Tu flota";
      $("#enemy-fleet-label").textContent = "Flota de " + state.players[cpu].name;
      log.textContent = state.battle.lastResult
        ? state.battle.lastResult
        : attacker.isCpu
          ? "Esperando disparo de la CPU…"
          : "Elige una casilla para atacar.";
      renderCpuHumanView(!attacker.isCpu);
    } else {
      var defender = state.players[opponentOf(attackerIndex)];
      $("#battle-subtitle").textContent =
        "Haz clic en una casilla del tablero enemigo para disparar.";
      $("#enemy-board-label").textContent = "Tablero de " + defender.name;
      $("#own-board-label").textContent = "Tu flota (" + attacker.name + ")";
      $("#own-fleet-label").textContent = "Tu flota";
      $("#enemy-fleet-label").textContent = "Flota de " + defender.name;
      log.textContent = state.battle.lastResult
        ? state.battle.lastResult
        : "Elige una casilla para atacar.";
      renderPvpBoards(attackerIndex);
    }
  }

  function applyShotFeedback(attacker, result) {
    var letters = cols();
    var r = result.cell.r;
    var c = result.cell.c;
    var coord = letters[c] + (r + 1);
    var log = $("#battle-log");
    log.className = "battle-log";

    var msg = "";
    if (result.result === "miss") {
      msg = "¡Agua! (" + coord + ")";
      log.classList.add("miss-msg");
      playSfx("miss");
    } else if (result.result === "hit") {
      msg = "¡Tocado! (" + coord + ")";
      log.classList.add("hit-msg");
      playSfx("hit");
    } else if (result.result === "sunk") {
      msg = "¡Hundido! Destruiste a " + result.shipName + " (" + coord + ")";
      log.classList.add("sunk-msg");
      playSfx("sunk");
      showSunkBanner(result.shipName);
      toast("¡Hundiste " + result.shipName + "!", 2800);
    }

    if (state.players[attacker].isCpu) {
      msg = state.players[attacker].name + ": " + msg;
      log.classList.add("cpu-msg");
    }

    log.textContent = msg;
    state.battle.lastResult = msg;

    if (isCpuMode()) {
      renderCpuHumanView(false);
      // Animations: human shots on enemy board; CPU shots on own board
      if (attacker === 0) {
        if (result.result === "miss") animateCell(findEnemyCell(r, c), "anim-splash", 550);
        else if (result.result === "hit") animateCell(findEnemyCell(r, c), "anim-boom", 450);
        else if (result.result === "sunk") playTheaterMode(result.cells, true);
      } else {
        if (result.result === "miss") animateCell(findOwnCell(r, c), "anim-splash", 550);
        else if (result.result === "hit") animateCell(findOwnCell(r, c), "anim-boom", 450);
        else if (result.result === "sunk") playTheaterMode(result.cells, false);
        updateCpuAfterShot(result, attacker);
      }
    } else {
      renderPvpBoards(attacker);
      if (result.result === "miss") animateCell(findEnemyCell(r, c), "anim-splash", 550);
      else if (result.result === "hit") animateCell(findEnemyCell(r, c), "anim-boom", 450);
      else if (result.result === "sunk") playTheaterMode(result.cells, true);
    }

    saveGame();
  }

  function afterShot(attacker, result) {
    if (result.win) {
      state.winner = attacker;
      clearSave();
      setTimeout(function () { showWin(); }, 1000);
      return;
    }

    if (isCpuMode()) {
      var next = opponentOf(attacker);
      state.battle.awaitingHandoff = false;
      setTimeout(function () {
        clearTheater();
        state.battle.lastResult = null;
        showBattleFor(next);
        saveGame();
        if (state.players[next].isCpu) scheduleCpuTurn();
      }, result.result === "sunk" ? 1200 : 750);
      return;
    }

    state.battle.awaitingHandoff = true;
    var nextP = opponentOf(attacker);
    setTimeout(function () {
      clearTheater();
      showHandoff(
        "Pasa el dispositivo",
        "Turno terminado.<br><br>Entrega el dispositivo a <strong>" +
          escapeHtml(playerLabel(nextP)) +
          "</strong>.<br>Cuando esté listo/a, pulsa <strong>Listo</strong>.",
        function () {
          state.battle.awaitingHandoff = false;
          state.battle.lastResult = null;
          showBattleFor(nextP);
          saveGame();
        }
      );
    }, result.result === "sunk" ? 1200 : 1100);
  }

  function onFireClick(r, c) {
    if (state.phase !== "battle" || state.battle.awaitingHandoff || state.battle.inputLocked) return;
    var attacker = state.battle.attacker;
    if (state.players[attacker].isCpu) return;

    clearTheater();
    var result = fireShot(attacker, r, c);
    if (!result.ok) {
      if (result.reason === "already") toast("Ya disparaste ahí");
      return;
    }

    state.battle.inputLocked = true;
    applyShotFeedback(attacker, result);
    afterShot(attacker, result);
  }

  function scheduleCpuTurn() {
    clearTimeout(cpuTimer);
    state.battle.inputLocked = true;
    var delay = 650 + Math.random() * 450;
    cpuTimer = setTimeout(function () {
      if (state.phase !== "battle") return;
      var attacker = state.battle.attacker;
      if (!state.players[attacker].isCpu) return;

      var target = chooseCpuShot(attacker);
      if (!target) return;
      var result = fireShot(attacker, target.r, target.c);
      if (!result.ok) {
        target = chooseCpuShot(attacker);
        if (!target) return;
        result = fireShot(attacker, target.r, target.c);
      }
      if (!result.ok) return;

      applyShotFeedback(attacker, result);
      afterShot(attacker, result);
    }, delay);
  }

  function showWin() {
    clearTheater();
    var w = state.players[state.winner];
    $("#win-title").textContent = "¡Victoria!";
    $("#win-msg").innerHTML =
      "<strong>" + escapeHtml(w.name) + "</strong> hundió toda la flota enemiga.";

    function block(p) {
      var st = p.stats || emptyStats();
      var prec = st.shots > 0 ? Math.round((st.hits / st.shots) * 1000) / 10 : 0;
      return (
        '<div class="stat-block"><h4>' +
        escapeHtml(p.name) +
        "</h4><dl>" +
        "<dt>Disparos</dt><dd>" + st.shots + "</dd>" +
        "<dt>Aciertos</dt><dd>" + st.hits + "</dd>" +
        "<dt>Precisión</dt><dd>" + prec + "%</dd>" +
        "<dt>Barcos hundidos</dt><dd>" + st.shipsSunk + "</dd>" +
        "<dt>Turnos</dt><dd>" + st.turns + "</dd>" +
        "</dl></div>"
      );
    }

    var statsEl = $("#win-stats");
    statsEl.innerHTML = block(state.players[0]) + block(state.players[1]);

    showScreen("win");
    playSfx("win");
    spawnWinConfetti();
  }

  // ——— Flujo ———
  function readStartOptions() {
    var mode =
      (document.querySelector('input[name="game-mode"]:checked') || {}).value || "pvp";
    var diff =
      (document.querySelector('input[name="cpu-diff"]:checked') || {}).value || "easy";
    var board =
      (document.querySelector('input[name="board-size"]:checked') || {}).value || "normal";
    var theme =
      (document.querySelector('input[name="theme"]:checked') || {}).value || "cyan";
    var spacing = $("#opt-spacing").checked;
    var n1 = $("#name-p1").value.trim();
    var n2 = $("#name-p2").value.trim();

    prefs.mode = mode;
    prefs.difficulty = diff;
    prefs.boardMode = board;
    prefs.theme = theme;
    prefs.spacing = spacing;
    prefs.name1 = n1;
    prefs.name2 = n2;
    savePrefs();
    applyTheme(theme);

    return {
      mode: mode,
      difficulty: diff,
      boardMode: board,
      spacing: spacing,
      name1: n1 || "Jugador 1",
      name2: mode === "cpu" ? n2 || "CPU" : n2 || "Jugador 2",
    };
  }

  function beginGame(opts) {
    clearTimeout(cpuTimer);
    clearTheater();
    clearSave();

    state.mode = opts.mode;
    state.difficulty = opts.difficulty;
    state.boardMode = opts.boardMode;
    state.boardSize = opts.boardMode === "rapida" ? 8 : 10;
    state.spacing = !!opts.spacing;
    state.fleetTemplate = opts.boardMode === "rapida" ? FLEET_RAPIDA : FLEET_NORMAL;
    state.winner = null;
    state.turnCount = 0;
    resetCpuAi();

    state.players[0] = createPlayer(opts.name1, false);
    state.players[1] = createPlayer(opts.name2, opts.mode === "cpu");

    if (opts.mode === "cpu") {
      startPlacement(0);
    } else {
      showHandoff(
        "Pasa el dispositivo",
        "Es el turno de colocar la flota de <strong>" +
          escapeHtml(state.players[0].name) +
          "</strong>.<br>El otro jugador no debe mirar.<br><br>Pulsa <strong>Listo</strong> para continuar.",
        function () { startPlacement(0); }
      );
    }
  }

  function onConfirmPlacement() {
    if (!allShipsPlaced()) return;
    var idx = state.placing.playerIndex;
    commitPlacement(idx);
    saveGame();

    if (isCpuMode()) {
      placeFleetRandomForPlayer(1);
      toast("La CPU colocó su flota");
      setTimeout(function () { startBattle(); }, 400);
      return;
    }

    if (idx === 0) {
      showHandoff(
        "Pasa el dispositivo",
        "Flota de <strong>" +
          escapeHtml(state.players[0].name) +
          "</strong> lista.<br><br>Entrega el dispositivo a <strong>" +
          escapeHtml(state.players[1].name) +
          "</strong> para que coloque sus barcos.<br>Pulsa <strong>Listo</strong> cuando esté preparado/a.",
        function () { startPlacement(1); }
      );
    } else {
      showHandoff(
        "¡A la batalla!",
        "Ambas flotas están listas.<br><br>Empieza <strong>" +
          escapeHtml(state.players[0].name) +
          "</strong>.<br>Pasa el dispositivo y pulsa <strong>Listo</strong>.",
        function () { startBattle(); }
      );
    }
  }

  function resetToStart() {
    clearTimeout(cpuTimer);
    clearTheater();
    showScreen("start");
    state.phase = "start";
    updateContinueUI();
    applyStartFormFromPrefs();
    renderFleetPreview();
  }

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme || "cyan");
  }

  function applyLargeText(on) {
    document.body.classList.toggle("large-text", !!on);
    var btn = $("#btn-large-text");
    if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function applyStartFormFromPrefs() {
    var modeInput = document.querySelector(
      'input[name="game-mode"][value="' + prefs.mode + '"]'
    );
    if (modeInput) modeInput.checked = true;
    var diffInput = document.querySelector(
      'input[name="cpu-diff"][value="' + prefs.difficulty + '"]'
    );
    if (diffInput) diffInput.checked = true;
    var boardInput = document.querySelector(
      'input[name="board-size"][value="' + prefs.boardMode + '"]'
    );
    if (boardInput) boardInput.checked = true;
    var themeInput = document.querySelector(
      'input[name="theme"][value="' + prefs.theme + '"]'
    );
    if (themeInput) themeInput.checked = true;
    $("#opt-spacing").checked = !!prefs.spacing;
    $("#name-p1").value = prefs.name1 || "";
    $("#name-p2").value = prefs.name2 || "";
    applyTheme(prefs.theme);
    updateModeUI();
    renderFleetPreview();
  }

  function updateModeUI() {
    var mode =
      (document.querySelector('input[name="game-mode"]:checked') || {}).value || "pvp";
    var wrap = $("#cpu-difficulty-wrap");
    var labelP2 = $("#label-p2");
    if (wrap) wrap.hidden = mode !== "cpu";
    if (labelP2) {
      var input = $("#name-p2");
      if (mode === "cpu") {
        labelP2.firstChild.textContent = "Nombre CPU (opcional) ";
        if (input && !input.value) input.placeholder = "CPU";
      } else {
        labelP2.firstChild.textContent = "Jugador 2 ";
        if (input) input.placeholder = "Capitán 2";
      }
    }
  }

  function toggleFullscreen() {
    var doc = document;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      var el = doc.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) req.call(el);
    } else {
      var exit = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (exit) exit.call(doc);
    }
  }

  function bindEvents() {
    $("#start-form").addEventListener("submit", function (e) {
      e.preventDefault();
      ensureAudio();
      if (prefs.music) startMusic();
      playSfx("click");
      beginGame(readStartOptions());
    });

    document.querySelectorAll('input[name="game-mode"]').forEach(function (el) {
      el.addEventListener("change", function () {
        updateModeUI();
        prefs.mode = el.value;
        savePrefs();
      });
    });

    document.querySelectorAll('input[name="board-size"]').forEach(function (el) {
      el.addEventListener("change", function () {
        prefs.boardMode = el.value;
        savePrefs();
        renderFleetPreview();
      });
    });

    document.querySelectorAll('input[name="theme"]').forEach(function (el) {
      el.addEventListener("change", function () {
        prefs.theme = el.value;
        applyTheme(el.value);
        savePrefs();
      });
    });

    document.querySelectorAll('input[name="cpu-diff"]').forEach(function (el) {
      el.addEventListener("change", function () {
        prefs.difficulty = el.value;
        savePrefs();
      });
    });

    $("#opt-spacing").addEventListener("change", function () {
      prefs.spacing = $("#opt-spacing").checked;
      savePrefs();
    });

    $("#btn-continue").addEventListener("click", function () {
      ensureAudio();
      if (prefs.music) startMusic();
      playSfx("click");
      var data = loadSave();
      if (!data) {
        toast("No hay partida guardada");
        updateContinueUI();
        return;
      }
      applySave(data);
    });

    $("#btn-new-game").addEventListener("click", function () {
      playSfx("click");
      clearSave();
      updateContinueUI();
      applyStartFormFromPrefs();
    });

    $("#btn-mute").addEventListener("click", function () {
      setMuted(!prefs.mute);
      if (!prefs.mute) {
        ensureAudio();
        playSfx("click");
      }
    });

    $("#btn-music").addEventListener("click", function () {
      ensureAudio();
      setMusic(!prefs.music);
      if (prefs.music) playSfx("click");
    });

    $("#btn-large-text").addEventListener("click", function () {
      prefs.largeText = !prefs.largeText;
      applyLargeText(prefs.largeText);
      savePrefs();
      playSfx("click");
    });

    $("#btn-fullscreen").addEventListener("click", function () {
      playSfx("click");
      toggleFullscreen();
    });

    $("#btn-handoff-ready").addEventListener("click", function () {
      playSfx("click");
      var fn = state.handoff.nextAction;
      state.handoff.nextAction = null;
      if (typeof fn === "function") fn();
    });

    $("#btn-rotate").addEventListener("click", function () {
      if (state.phase === "place") {
        playSfx("click");
        toggleOrientation();
      }
    });

    $("#btn-random").addEventListener("click", function () {
      if (state.phase !== "place") return;
      playSfx("place");
      randomPlaceAll();
      renderPlacement();
      saveGame();
      toast("Flota colocada al azar");
    });

    $("#btn-confirm-placement").addEventListener("click", function () {
      playSfx("click");
      onConfirmPlacement();
    });

    $("#btn-rematch").addEventListener("click", function () {
      playSfx("click");
      beginGame({
        mode: state.mode,
        difficulty: state.difficulty,
        boardMode: state.boardMode,
        spacing: state.spacing,
        name1: state.players[0].name,
        name2: state.players[1].name,
      });
    });

    $("#btn-home").addEventListener("click", function () {
      playSfx("click");
      clearSave();
      resetToStart();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "r" || e.key === "R") {
        if (state.phase === "place" && !e.metaKey && !e.ctrlKey && !e.altKey) {
          var tag = (e.target && e.target.tagName) || "";
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          e.preventDefault();
          toggleOrientation();
        }
      }
      if (e.key === "Escape") clearTheater();
    });
  }

  function init() {
    loadPrefs();
    applyTheme(prefs.theme);
    applyLargeText(prefs.largeText);
    updateMuteButton();
    updateMusicButton();
    applyStartFormFromPrefs();
    renderFleetPreview();
    bindEvents();
    updateContinueUI();
    showScreen("start");
    showHud(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
