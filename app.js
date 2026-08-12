/* Scavenger Hunt — game logic.
   Progress lives in localStorage; clue text arrives scrambled in data.js. */

(function () {
  'use strict';

  var HUNT = window.HUNT;

  // --- unscrambling -------------------------------------------------------
  // Mirror of Protect-Text in tools/build.ps1. Not security — just enough to
  // make "View Source" useless to a curious kid.

  var KEY = Array.prototype.map.call('a-star-in-the-east-2026', function (ch) {
    return ch.charCodeAt(0);
  });

  function reveal(encoded) {
    var binary = atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ KEY[i % KEY.length];
    }
    return new TextDecoder().decode(bytes);
  }

  // --- storage ------------------------------------------------------------

  var STORE = 'scavengerHunt.v1';

  // { f1: { clues: 2, found: false }, ... }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw === null) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {}; // private browsing, corrupted value — start fresh rather than break
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch (err) {
      // Quota full or storage blocked. The round still plays; it just won't
      // survive a refresh. Better than dropping the player out of the game.
    }
  }

  var state = loadState();

  function progressOf(id) {
    var entry = state[id];
    if (!entry || typeof entry !== 'object') return { clues: 0, found: false };
    return {
      clues: typeof entry.clues === 'number' && entry.clues > 0 ? entry.clues : 0,
      found: entry.found === true
    };
  }

  function setProgress(id, next) {
    state[id] = next;
    saveState(state);
  }

  // --- scoring ------------------------------------------------------------

  // Every clue taken costs 2.5 minutes of reading time. Clue counts accumulate as
  // whole numbers and are multiplied out once at display time, so no float
  // arithmetic ever accumulates.
  var MINUTES_PER_CLUE = 2.5;

  function starsFor(p) {
    return Math.max(1, 5 - p.clues);
  }

  function formatMinutes(clues) {
    var minutes = clues * MINUTES_PER_CLUE;
    return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  }

  // Thresholds are a percentage of the clues on offer, not absolute counts, so the
  // ranks stay meaningful whether the hunt has one figure or ten.
  var RANKS = [
    { pct: 0,   title: 'Legendary Seeker',    line: 'Cracked it with no help whatsoever. That is genuinely unreal.' },
    { pct: 20,  title: 'Master Codebreaker',  line: 'Barely needed us. Sharp eyes and a sharper brain.' },
    { pct: 40,  title: 'Eagle Eye',           line: 'Solid hunting from start to finish.' },
    { pct: 60,  title: 'Determined Explorer', line: 'You worked for that one, and you got it.' },
    { pct: 100, title: 'Never Gave Up',       line: 'You found it. That is the part that counts.' }
  ];

  // Compared as integers (used * 100 vs pct * available) so a threshold never
  // turns on a float rounding accident.
  function rankFor(cluesUsed, cluesAvailable) {
    if (cluesAvailable <= 0) return RANKS[0];
    for (var i = 0; i < RANKS.length; i++) {
      if (cluesUsed * 100 <= RANKS[i].pct * cluesAvailable) return RANKS[i];
    }
    return RANKS[RANKS.length - 1];
  }

  function totalCluesAvailable() {
    return HUNT.figures.reduce(function (n, f) { return n + f.c.length; }, 0);
  }

  // --- helpers ------------------------------------------------------------

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return ESCAPES[c]; });
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function figureById(id) {
    for (var i = 0; i < HUNT.figures.length; i++) {
      if (HUNT.figures[i].id === id) return HUNT.figures[i];
    }
    return null;
  }

  function accentVar(color) {
    var known = { blue: 1, teal: 1, gold: 1, pink: 1, purple: 1, green: 1 };
    return 'var(--' + (known[color] ? color : 'teal') + ')';
  }

  // A clue's first line is set in monospace when it is a cipher — all caps,
  // digits, dots and spaces, nothing lowercase — so it can be read letter by
  // letter. Everything after it is ordinary prose.
  function clueHtml(text) {
    var split = text.indexOf('\n');
    if (split === -1) return esc(text);

    var head = text.slice(0, split);
    var rest = text.slice(split);
    if (!/[a-z]/.test(head) && /[A-Z0-9]/.test(head)) {
      return '<span class="clue-cipher">' + esc(head) + '</span>' + esc(rest);
    }
    return esc(text);
  }

  // --- confetti -----------------------------------------------------------

  var CONFETTI_COLORS = ['#35C4B5', '#FFC93C', '#FF6B9D', '#8B6DEA', '#4CD07D'];

  function burstConfetti(count) {
    var host = document.getElementById('confetti');
    if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var pieces = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var piece = document.createElement('i');
      var duration = 2.2 + Math.random() * 1.6;
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDuration = duration + 's';
      piece.style.animationDelay = Math.random() * 0.7 + 's';
      pieces.appendChild(piece);
    }
    host.appendChild(pieces);
    setTimeout(function () { host.innerHTML = ''; }, 5200);
  }

  // --- views --------------------------------------------------------------

  var pendingReset = false;

  function hubView() {
    var found = 0;
    var cluesUsed = 0;

    var cards = HUNT.figures.map(function (fig) {
      var p = progressOf(fig.id);
      if (p.found) found++;
      cluesUsed += p.clues;

      var meta = p.found
        ? '★'.repeat(starsFor(p)) + '☆'.repeat(5 - starsFor(p)) +
          '  ·  ' + plural(p.clues, 'clue', 'clues') + ' used'
        : (p.clues > 0 ? plural(p.clues, 'clue', 'clues') + ' taken' : 'Not started');

      return '' +
        '<button class="card' + (p.found ? ' is-found' : '') + '" data-go="' + esc(fig.id) + '"' +
        ' style="--accent:' + accentVar(fig.color) + '">' +
          '<span class="card-top">' +
            '<span class="badge">' + esc(fig.emoji) + '</span>' +
            '<span class="card-title">' +
              '<h3>' + esc(fig.name) + '</h3>' +
              '<span class="card-meta' + (p.found ? ' stars' : '') + '">' + meta + '</span>' +
            '</span>' +
            (p.found ? '<span class="tick">✓</span>' : '') +
          '</span>' +
        '</button>';
    }).join('');

    var total = HUNT.figures.length;
    var pct = total > 0 ? Math.round((found / total) * 100) : 0;
    var fillClass = found === 0 ? ' empty' : (found === total ? ' full' : '');

    var win = '';
    if (found === total) {
      var rank = rankFor(cluesUsed, totalCluesAvailable());
      var summary = total === 1
        ? (cluesUsed === 0 ? 'Found with no clues at all' : 'Found with ' + plural(cluesUsed, 'clue', 'clues'))
        : 'All ' + total + ' found using ' + plural(cluesUsed, 'clue', 'clues');
      win = '' +
        '<div class="win">' +
          '<div class="big">🏆</div>' +
          '<div class="rank">' + esc(rank.title) + '</div>' +
          '<p><strong>' + esc(rank.line) + '</strong></p>' +
          '<p class="sub">' + summary +
            ' · ' + formatMinutes(cluesUsed) + ' minutes of reading</p>' +
        '</div>';
    }

    return '' +
      '<header class="masthead">' +
        '<h1>' + esc(HUNT.title) + '</h1>' +
        '<p class="sub">' + esc(HUNT.subtitle) + '</p>' +
      '</header>' +
      win +
      '<section class="scoreboard">' +
        '<div class="scoreboard-row">' +
          '<span>Found</span><strong>' + found + ' of ' + total + '</strong>' +
        '</div>' +
        '<div class="bar"><div class="bar-fill' + fillClass + '" style="width:' + pct + '%"></div></div>' +
        '<div class="scoreboard-row" style="margin:12px 0 0">' +
          '<span class="sub">' + plural(cluesUsed, 'clue', 'clues') + ' used</span>' +
          '<span class="sub">' + formatMinutes(cluesUsed) + ' min reading</span>' +
        '</div>' +
      '</section>' +
      '<div class="cards">' + cards + '</div>' +
      '<div class="footer"><button class="btn btn-ghost" data-action="ask-reset">Start over 🔒</button></div>';
  }

  function figureView(fig) {
    var p = progressOf(fig.id);
    var totalClues = fig.c.length;
    var shown = Math.min(p.clues, totalClues);
    var remaining = totalClues - shown;

    var clues = '';
    for (var i = 0; i < shown; i++) {
      clues += '' +
        '<div class="clue">' +
          '<span class="clue-n">Clue ' + (i + 1) + ' of ' + totalClues + '</span>' +
          clueHtml(reveal(fig.c[i])) +
        '</div>';
    }

    var body;
    if (p.found) {
      body = '' +
        '<div class="found-box">' +
          '<div class="big">🎉</div>' +
          '<h2>Found!</h2>' +
          '<p><strong>' + esc(reveal(fig.a)) + '</strong></p>' +
          '<p class="stars" style="font-size:22px">' +
            '★'.repeat(starsFor(p)) + '☆'.repeat(5 - starsFor(p)) + '</p>' +
          '<p class="sub">' + plural(p.clues, 'clue', 'clues') + ' used · ' +
            formatMinutes(p.clues) + ' min reading</p>' +
        '</div>' +
        '<div class="stack">' +
          '<button class="btn" data-go="">Back to the hunt</button>' +
        '</div>';
    } else {
      body = '' +
        '<div class="clue-list">' + clues + '</div>' +
        (remaining > 0
          ? '<div class="stack">' +
              '<button class="btn btn-clue" data-action="clue" data-id="' + esc(fig.id) + '">' +
                (shown === 0 ? 'Give me a clue' : 'I need another clue') +
                ' (' + remaining + ' left)</button>' +
              '<p class="cost">Costs ' + formatMinutes(1) + ' minutes of reading' +
                (shown > 0 ? ' · you are on ' + formatMinutes(shown) + ' min so far' : '') +
              '</p>' +
            '</div>'
          : '<p class="locked">That was the last clue. You are on your own now!</p>') +
        '<div class="stack">' +
          '<button class="btn btn-found" data-action="found" data-id="' + esc(fig.id) + '">I FOUND IT!</button>' +
        '</div>';
    }

    return '' +
      '<button class="btn btn-back" data-go="">← Back</button>' +
      '<div class="hero" style="--accent:' + accentVar(fig.color) + '">' +
        '<div class="badge">' + esc(fig.emoji) + '</div>' +
        '<h2>' + esc(fig.name) + '</h2>' +
        '<p class="sub">' + (p.found ? 'Found it' : plural(shown, 'clue', 'clues') + ' of ' + totalClues + ' used') + '</p>' +
      '</div>' +
      '<div class="teaser" style="--accent:' + accentVar(fig.color) + '">' + esc(reveal(fig.t)) + '</div>' +
      '<div style="--accent:' + accentVar(fig.color) + '">' + body + '</div>';
  }

  function resetModal() {
    return '' +
      '<div class="modal-backdrop" data-action="cancel-reset">' +
        '<div class="modal">' +
          '<h2>Grown-ups only</h2>' +
          '<p>Starting over wipes every find and every clue count. There is no undo.</p>' +
          '<input id="reset-pw" class="pw-input" type="password" autocomplete="off"' +
            ' autocapitalize="off" autocorrect="off" spellcheck="false"' +
            ' placeholder="Password" aria-label="Password">' +
          '<p id="reset-error" class="pw-error" role="alert"></p>' +
          '<div class="btn-row" style="margin-top:14px">' +
            '<button class="btn" data-action="cancel-reset">Never mind</button>' +
            '<button class="btn btn-danger" data-action="do-reset">Wipe it</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // --- reset password -----------------------------------------------------
  // Only a salted SHA-256 of the password ships (see tools/build.ps1); the word
  // itself lives in the gitignored clues.json and never reaches the public repo.

  var RESET_SALT = 'scavenger-hunt-reset::';
  var resetBusy = false;

  function sha256Hex(text) {
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function showResetError(message) {
    var field = document.getElementById('reset-pw');
    var slot = document.getElementById('reset-error');
    if (slot) slot.textContent = message;
    if (field) {
      field.value = '';
      field.classList.remove('shake');
      void field.offsetWidth;        // restart the animation on a repeat wrong guess
      field.classList.add('shake');
      field.focus();
    }
  }

  function attemptReset() {
    if (resetBusy) return;

    var field = document.getElementById('reset-pw');
    var typed = field ? field.value.trim().toLowerCase() : '';
    if (!typed) {
      showResetError('Type the password first.');
      return;
    }

    // crypto.subtle only exists in a secure context (https, or localhost).
    if (!window.crypto || !crypto.subtle) {
      showResetError('Open the site over https to use the password.');
      return;
    }

    resetBusy = true;
    sha256Hex(RESET_SALT + typed).then(function (hash) {
      resetBusy = false;
      if (hash !== HUNT.pw) {
        showResetError('That is not it.');
        return;
      }
      state = {};
      saveState(state);
      pendingReset = false;
      if (currentId()) {
        location.hash = '';          // hashchange -> render
      } else {
        render();
      }
    }).catch(function () {
      resetBusy = false;
      showResetError('Could not check the password. Try again.');
    });
  }

  // --- render / routing ---------------------------------------------------

  var app = document.getElementById('app');

  function currentId() {
    return decodeURIComponent(String(location.hash || '').replace(/^#/, ''));
  }

  function render() {
    var id = currentId();
    var fig = id ? figureById(id) : null;

    if (id && !fig) {          // stale or hand-typed hash — fall back to the hub
      location.hash = '';
      return;
    }

    app.innerHTML = (fig ? figureView(fig) : hubView()) + (pendingReset ? resetModal() : '');
    window.scrollTo(0, 0);

    if (pendingReset) {
      var field = document.getElementById('reset-pw');
      if (field) field.focus();
    }
  }

  app.addEventListener('click', function (event) {
    var target = event.target.closest('[data-go], [data-action]');
    if (!target) return;

    // Backdrop closes the modal; clicks inside it must not.
    if (target.dataset.action === 'cancel-reset' &&
        event.target !== target && target.classList.contains('modal-backdrop')) {
      return;
    }

    if (target.hasAttribute('data-go')) {
      var dest = target.getAttribute('data-go');
      if (dest) {
        location.hash = dest;      // hashchange -> render
      } else if (currentId()) {
        location.hash = '';        // leaving a figure; hashchange -> render
      } else {
        render();                  // already on the hub; no hashchange would fire
      }
      return;
    }

    var action = target.dataset.action;
    var id = target.dataset.id;

    if (action === 'clue') {
      var fig = figureById(id);
      if (!fig) return;
      var p = progressOf(id);
      if (p.clues >= fig.c.length) return;
      setProgress(id, { clues: p.clues + 1, found: p.found });
      render();

    } else if (action === 'found') {
      var wasFound = progressOf(id).found;
      if (wasFound) return;
      setProgress(id, { clues: progressOf(id).clues, found: true });

      var allFound = HUNT.figures.every(function (f) { return progressOf(f.id).found; });
      render();
      burstConfetti(allFound ? 90 : 40);

    } else if (action === 'ask-reset') {
      pendingReset = true;
      render();

    } else if (action === 'cancel-reset') {
      pendingReset = false;
      render();

    } else if (action === 'do-reset') {
      attemptReset();
    }
  });

  // Enter in the password box submits, so a phone keyboard's Go key works.
  app.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.id === 'reset-pw') {
      event.preventDefault();
      attemptReset();
    }
  });

  window.addEventListener('hashchange', render);

  // --- boot ---------------------------------------------------------------

  if (!HUNT || !HUNT.figures || !HUNT.figures.length) {
    app.innerHTML =
      '<div class="card"><h2>No hunt loaded</h2>' +
      '<p>data.js is missing or empty. Run <code>pwsh tools/build.ps1</code> and redeploy.</p></div>';
    return;
  }

  try {
    reveal(HUNT.figures[0].t); // fail loudly here rather than mid-game
  } catch (err) {
    app.innerHTML =
      '<div class="card"><h2>Clues will not unscramble</h2>' +
      '<p>data.js was built with a different key than app.js expects. ' +
      'Re-run <code>pwsh tools/build.ps1</code>.</p></div>';
    return;
  }

  render();
})();
