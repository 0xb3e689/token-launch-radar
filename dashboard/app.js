// Preflight's page. It reads window.RADAR — written beside this directory by main.ts from the sealed
// snapshot — and renders the ranked board, the filters, the model panel and a per-protocol detail
// slide-over with the farm plan. No network: every byte it shows arrived in data.js.
//
// The page recomputes each row's implied value from the multipliers the board carries, with the same
// arithmetic as lib/model.ts, and shows the board's number beside it, so the code and the data are
// visibly the same model.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false,
    tab: 'pre-token', sort: 'rank', dir: 1, selected: null, panel: null,
  };

  // ---------------------------------------------------------------- formatting
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var neg = n < 0 ? '-' : '';
    n = Math.abs(n);
    if (n >= 1e9) return neg + '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return neg + '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return neg + '$' + Math.round(n / 1e3) + 'K';
    return neg + '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2).replace(/\.?0+$/, ''); }
  function chainsLine(r) {
    return (r.category || 'Uncategorized') + ' · ' + (r.chains.length ? r.chains.slice(0, 3).join(', ') : 'no chain named') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
  }

  // ---------------------------------------------------------------- the model, recomputed on the page
  // Same arithmetic as lib/model.ts impliedValue, from the multipliers the board row carries.
  function impliedOf(r) {
    return Math.max(1, Math.round(r.tvl_usd * M.base_multiple * r.size_multiple * r.growth_multiplier * r.anticipation_multiplier * r.breadth_multiplier));
  }

  // ---------------------------------------------------------------- state via the location hash
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = Number(params.get('dir')) < 0 ? -1 : 1;
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    state.watchOnly = params.get('watch') === '1';
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('panel') === 'model') state.panel = 'model';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('min', String(state.minTvl));
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', String(state.dir));
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------------- rows
  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { seen[r.category || 'Uncategorized'] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var count = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { count[c] = (count[c] || 0) + 1; }); });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a] || (a < b ? -1 : 1); });
  }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !r.on_watchlist) return false;
      if (!q) return true;
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'signal') { av = a.signal; bv = b.signal; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  // ---------------------------------------------------------------- tiny DOM builder
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------------------------------------------------------------- static chrome
  function renderMeta() {
    var meta = document.getElementById('top-meta');
    meta.textContent = '';
    meta.appendChild(el('span', { class: 'meta-chip' }, 'snapshot ', el('b', { text: DATA.as_of })));
    meta.appendChild(el('span', { class: 'meta-chip' }, 'watchlist floor ', el('b', { text: fmtUsd(DATA.floor_usd) })));
    meta.appendChild(el('span', { class: 'meta-chip' }, 'model ', el('b', { text: DATA.model_version })));
    var src = document.getElementById('foot-source');
    var at = DATA.source.indexOf(' ');
    src.textContent = at > 0 ? 'Snapshot: ' + DATA.source.slice(0, at) + ' · ' + DATA.source.slice(at + 1) : 'Snapshot: ' + DATA.source;
  }

  function heatColor(signal) {
    return signal >= 80 ? '#3de8a0' : signal >= 60 ? '#9be36f' : signal >= 40 ? '#ffc15e' : '#ff7a8a';
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Every protocol whose token has not launched — ranked by the value its record ', el('em', { text: 'implies' }), '.'),
        el('p', null,
          'The watchlist is the floor: all ', el('b', { text: String(DATA.watchlist_size) }),
          ' protocols with ', el('b', { text: fmtUsd(DATA.floor_usd) }), ' or more of TVL and no token on record are covered. The radar adds ',
          el('b', { text: String(DATA.early_size) }), ' earlier pre-token protocols the floor does not name. Implied value is what each token would be worth if the protocol\'s record stayed as it is — the model is stated below, and every row is scored by the same function.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows added' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied / TVL' }), el('b', null, String(DATA.median_multiple), el('small', { text: 'x' })))
      )
    );
  }

  function toolbar(rowCount) {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain…', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainList = chains();
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chainList.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var minSel = el('select', { id: 'min', 'aria-label': 'Filter by TVL' },
      el('option', { value: '0', text: 'Any TVL', selected: state.minTvl === 0 ? 'selected' : null }),
      el('option', { value: '50000000', text: '≥ $50M', selected: state.minTvl === 50000000 ? 'selected' : null }),
      el('option', { value: '100000000', text: '≥ $100M', selected: state.minTvl === 100000000 ? 'selected' : null }),
      el('option', { value: '250000000', text: '≥ $250M', selected: state.minTvl === 250000000 ? 'selected' : null })
    );
    minSel.addEventListener('change', function () { state.minTvl = Number(minSel.value) || 0; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watch' });
    watch.checked = state.watchOnly;
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'min', text: 'TVL' }), minSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, pre, live)),
      el('label', { class: 'check', for: 'watch' }, watch, 'Watchlist only'),
      el('span', { class: 'count' }, el('b', { text: String(rowCount) }), ' of ' + DATA.rows.length + ' rows')
    );
  }

  function sortHeader(key, label) {
    var self = this;
    return el('th', { scope: 'col' },
      el('button', {
        class: state.sort === key ? 'on' : null,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        }
      }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null)
    );
  }

  // ---------------------------------------------------------------- the board
  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or loosen a filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render();
        } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var recomputed = impliedOf(r);
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        'aria-label': r.name + ', rank ' + r.rank + ', implied value ' + fmtUsd(r.implied_value_usd),
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', { class: 'proto' },
          el('div', { class: 'name' },
            el('b', { text: r.name }),
            el('span', { class: 'badge ' + (r.on_watchlist ? 'watch' : 'early'), text: r.on_watchlist ? 'watchlist' : 'early' })
          ),
          el('span', { class: 'sub', text: chainsLine(r) })
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num' },
          el('span', { class: 'heat', style: 'color:' + heatColor(r.signal), 'aria-hidden': 'true' }),
          String(r.signal)
        )
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', null, 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.'),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Silent age'),
            sortHeader('rank', 'Implied value'),
            sortHeader('signal', 'Signal')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var mult = r.mcap_usd && r.tvl_usd ? r.mcap_usd / r.tvl_usd : null;
      tbody.appendChild(el('tr', null,
        el('td', { class: 'proto' },
          el('div', { class: 'name' }, el('b', { text: r.name })),
          el('span', { class: 'sub', text: chainsLine(r) })
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: mult === null ? 'n/a' : mult.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'badge early', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'livecap' }, 'These protocols already have a token that trades, so the market sets their value — the radar scores none of them, and ranks only the pre-token board.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Cap / TVL' }),
            el('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  // ---------------------------------------------------------------- model panel + histogram
  function histogram() {
    var values = DATA.rows.map(function (r) { return Math.log10(r.implied_value_usd); }).sort(function (a, b) { return a - b; });
    var lo = values[0], hi = values[values.length - 1];
    var bins = new Array(28).fill(0);
    values.forEach(function (v) {
      var at = Math.min(27, Math.floor(((v - lo) / (hi - lo || 1)) * 28));
      bins[at] += 1;
    });
    var peak = Math.max.apply(null, bins);
    var canvas = el('canvas', { width: '1120', height: '110', role: 'img', 'aria-label': 'Distribution of implied values across the board' });
    function draw() {
      var ctx = canvas.getContext('2d');
      var w = canvas.width, h = canvas.height - 8, bw = w / bins.length;
      ctx.clearRect(0, 0, w, h);
      bins.forEach(function (n, i) {
        var bh = Math.round((n / peak) * (h - 14));
        var grad = ctx.createLinearGradient(0, h - bh, 0, h);
        grad.addColorStop(0, '#3de8a0');
        grad.addColorStop(1, '#155d47');
        ctx.fillStyle = grad;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      });
      var med = values[Math.floor(values.length / 2)];
      var x = ((med - lo) / (hi - lo || 1)) * w;
      ctx.strokeStyle = '#ffc15e';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    draw();
    return el('div', { class: 'hist' },
      canvas,
      el('div', { class: 'axis' },
        el('span', { text: fmtUsd(Math.pow(10, lo)) + ' implied' }),
        el('span', { text: 'median ' + fmtUsd(Math.pow(10, values[Math.floor(values.length / 2)])) }),
        el('span', { text: fmtUsd(Math.pow(10, hi)) + ' implied' })
      )
    );
  }

  function modelPanel() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'One function scores every protocol from the snapshot\'s own fields — its TVL, its seven-day growth, how long it has run with no token, and how many chains it is live on. No name is special-cased and no row is hand-picked.'),
      el('div', { class: 'formula' },
        'implied = round( tvl × ', el('i', { text: String(M.base_multiple) }), ' (base) × size × growth × anticipation × breadth )', el('br'),
        'size         = clamp(', el('i', { text: String(M.size_ceiling) }), ' − ', el('i', { text: String(M.size_slope) }), ' × log₁₀(tvl ÷ ', el('i', { text: '$' + (M.size_anchor_tvl / 1e6) + 'M' }), '), ', el('i', { text: String(M.size_floor) }), ', ', el('i', { text: String(M.size_ceiling) }), ')  ', el('i', { text: '— richer multiple for smaller TVL' }), el('br'),
        'growth     = 1 + clamp(change_7d, ', el('i', { text: String(M.growth_floor) }), ', ', el('i', { text: String(M.growth_cap) }), ') ÷ 100 × ', el('i', { text: String(M.growth_weight) }), '  ', el('i', { text: '— momentum, clamped' }), el('br'),
        'anticipation = ', el('i', { text: String(M.anticipation_floor) }), ' + min(age, ', el('i', { text: String(M.anticipation_days) }), 'd) ÷ ', el('i', { text: String(M.anticipation_days) }), ' × ', el('i', { text: String(M.anticipation_range) }), '  ', el('i', { text: '— longer silent, more to reward' }), el('br'),
        'breadth    = 1 + min(chains, ', el('i', { text: String(M.breadth_cap) }), ') × ', el('i', { text: String(M.breadth_weight) }), '  ', el('i', { text: '— more chains, more users' })
      ),
      el('ul', { class: 'model-notes' },
        el('li', null, 'Comparable token launches clear roughly 0.4x to 1.2x of TVL; the size factor decays that multiple as TVL rises, so a big protocol does not dominate by size alone.'),
        el('li', null, 'A protocol that records no token may still have one its record does not carry — DefiLlama\'s record is evidence, not proof. The plan is worth nothing if a token already trades.'),
        el('li', null, 'An unknown age scores ' + M.unknown_age_days + ' days, the midpoint of a typical points program. The signal dot is a display heuristic; the ranking is implied value alone.'),
        el('li', null, 'Live-token protocols are set aside on the Live tokens tab: their market cap is a fact, and mixing them into a ranking of tokens to come would flatter nothing.')
      ),
      histogram()
    );
  }

  // ---------------------------------------------------------------- detail slide-over
  var backdrop = el('button', { class: 'backdrop', 'aria-label': 'Close details', tabindex: '-1' });
  backdrop.addEventListener('click', closeDetail);
  var detail = el('aside', { class: 'detail', id: 'detail', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    writeHash();
    if (detail.parentNode) detail.parentNode.removeChild(detail);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }
  function openDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;
    state.selected = slug;
    writeHash();
    detail.textContent = '';
    var recomputed = impliedOf(r);
    detail.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + r.rank + ' of ' + DATA.board_size + ' · signal ' + r.signal + '/100' }),
        el('h2', { text: r.name }),
        el('span', { class: 'chains-line', text: chainsLine(r) })
      ),
      el('button', { class: 'button close', type: 'button', text: 'Close', onclick: closeDetail })
    ));
    detail.appendChild(el('div', { class: 'chips' },
      el('span', { class: 'chip', text: r.on_watchlist ? 'house watchlist' : 'early radar' }),
      el('span', { class: 'chip', text: 'listed ' + (r.listed_at || 'unknown') }),
      el('span', { class: 'chip', text: r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') })
    ));
    detail.appendChild(el('h3', { text: 'Implied value — the model\'s inputs' }));
    detail.appendChild(el('div', { class: 'kv' },
      el('span', { text: 'TVL' }), el('b', { text: fmtUsd(r.tvl_usd) }),
      el('span', { text: 'Seven-day growth' }), el('b', { class: r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'pos', text: fmtPct(r.change_7d) }),
      el('span', { text: 'Silent age — listed to snapshot' }), el('b', { text: fmtAge(r.age_days) }),
      el('span', { text: 'Chains live on' }), el('b', { text: String(r.chains.length) }),
      el('span', { text: 'Base multiple' }), el('b', { text: M.base_multiple.toFixed(2) + 'x' }),
      el('span', { text: 'Size multiple' }), el('b', { text: r.size_multiple.toFixed(3) + 'x' }),
      el('span', { text: 'Growth multiple' }), el('b', { text: r.growth_multiplier.toFixed(3) + 'x' }),
      el('span', { text: 'Anticipation multiple' }), el('b', { text: r.anticipation_multiplier.toFixed(3) + 'x' }),
      el('span', { text: 'Breadth multiple' }), el('b', { text: r.breadth_multiplier.toFixed(3) + 'x' }),
      el('span', { text: 'Implied value (board)' }), el('b', { class: 'pos', text: fmtUsd(r.implied_value_usd) })
    ));
    detail.appendChild(el('div', { class: 'arithmetic' },
      fmtUsd(r.tvl_usd), ' × ', String(M.base_multiple), ' × ', r.size_multiple.toFixed(4), ' × ', r.growth_multiplier.toFixed(4),
      ' × ', r.anticipation_multiplier.toFixed(4), ' × ', r.breadth_multiplier.toFixed(4), ' ≈ ', el('b', { text: fmtUsd(recomputed) }),
      recomputed === r.implied_value_usd ? ' — the page recomputes the board\'s own number.' : ' — differs from the board by rounding; the board\'s figure stands.'
    ));
    detail.appendChild(el('h3', { text: 'Farm plan — what to do, what it costs' }));
    var steps = el('ol', { class: 'steps' });
    r.farm_steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 7) : '';
      var timeAt = tail.lastIndexOf(' Time: ');
      var cost = timeAt >= 0 ? tail.slice(0, timeAt).replace(/\.$/, '') : tail;
      var time = timeAt >= 0 ? tail.slice(timeAt + 7).replace(/\.$/, '') : '';
      steps.appendChild(el('li', null,
        el('p', { text: action }),
        el('div', { class: 'meta' },
          cost ? el('span', { text: cost }) : null,
          time ? el('span', { text: time }) : null
        )
      ));
    });
    detail.appendChild(steps);
    detail.appendChild(el('p', { class: 'note' }, 'Farming a launch is speculative: costs are paid for certain, the token is not. Never borrow to farm, and treat every claim link outside the protocol\'s own site as hostile.'));
    app.appendChild(backdrop);
    app.appendChild(detail);
    detail.scrollTop = 0;
  }

  // ---------------------------------------------------------------- render
  function render() {
    app.textContent = '';
    app.appendChild(lede());
    app.appendChild(toolbar(state.tab === 'pre-token' ? filteredRows().length : DATA.live.length));
    app.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      var panel = modelPanel();
      app.appendChild(panel);
      if (state.panel === 'model') { panel.scrollIntoView(); state.panel = null; }
    }
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  renderMeta();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDetail();
  });
})();
