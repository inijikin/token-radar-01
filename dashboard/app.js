// Token Radar's page logic: filter, sort and open the detail view. No network, no storage.
// The page recomputes every implied value from the model in data.js and says so in the detail
// view when the recomputation matches the board's number.
(function () {
  'use strict';
  var data = window.RADAR;
  var root = document.documentElement;
  if (!data) {
    document.body.insertAdjacentHTML('beforeend', '<p>Data failed to load.</p>');
    return;
  }
  var model = data.model;

  // ---------------------------------------------------------------- formatting
  var money = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
  var compact = function (n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return money(n);
  };
  var pct = function (v) {
    if (v === null || v === undefined) return '—';
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
  };
  var ageText = function (days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    var y = Math.floor(days / 365);
    var m = Math.floor((days % 365) / 30);
    return y + 'y ' + m + 'm';
  };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  // The model's own formula, run in the page so the reader can check the board's number.
  var ageTilt = function (ageDays) {
    var days = ageDays === null || ageDays === undefined ? model.age_unknown_days : Math.min(ageDays, model.age_cap_days);
    return 0.9 + 0.2 * (days / model.age_cap_days);
  };
  var impliedOf = function (row) {
    var change = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var tvlAdj = row.tvl / (1 + change / 100);
    if (!(tvlAdj > 0)) return 1;
    var mult = row.category ? (model.category_multipliers[row.category] || 1) : 1;
    return Math.max(1, Math.round(model.scale * Math.pow(tvlAdj, model.slope) * mult * ageTilt(row.age_days)));
  };

  // ---------------------------------------------------------------- state
  var state = { q: '', category: '', chain: '', tab: 'pre', watchlistOnly: false, sort: 'rank', dir: 1 };
  var $ = function (id) { return document.getElementById(id); };
  var searchEl = $('search');
  var categoryEl = $('category');
  var chainEl = $('chain');
  var tabPre = $('tab-pre');
  var tabLive = $('tab-live');
  var watchlistEl = $('watchlist-only');
  var countEl = $('count');
  var rowsEl = $('rows');
  var emptyEl = $('empty');
  var detailEl = $('detail');
  var selectedSlug = null;

  // ---------------------------------------------------------------- static text
  $('top-meta').innerHTML = '';
  [['Snapshot', data.as_of_iso], ['Protocols', String(data.snapshot_protocols)], ['Ranked', String(data.ranked_total)], ['Model', 'fitted log-log, R\u00b2 ' + model.fit_r2]].forEach(function (pair) {
    var s = document.createElement('span');
    s.textContent = pair[0] + ' ' + pair[1];
    $('top-meta').appendChild(s);
  });
  var facts = [
    ['Watchlist on the board', data.watchlist_ranked + ' / ' + data.watchlist_total],
    ['Pre-token protocols ranked', String(data.ranked_total)],
    ['Tokenized in the snapshot', String(data.tokenized_total)],
    ['Top implied value', money(data.rows[0].implied_value_usd)],
  ];
  facts.forEach(function (pair) {
    var d = document.createElement('div');
    d.className = 'fact';
    var dt = document.createElement('dt');
    dt.textContent = pair[0];
    var dd = document.createElement('dd');
    dd.textContent = pair[1];
    d.appendChild(dt);
    d.appendChild(dd);
    $('facts').appendChild(d);
  });
  $('formula').textContent = model.formula + '   |   TVL_adj = TVL \u00f7 (1 + clamp(change_7d, \u221250%, +50%) \u00f7 100)';
  var fitItems = [
    [String(model.fit_n), 'tokenized protocols fitted'],
    [model.fit_r2.toFixed(2), 'R\u00b2 of the log-log fit'],
    [model.slope.toFixed(2) + '  (t = ' + model.fit_slope_t + ')', 'elasticity of value to TVL'],
    [model.fit_residual_sd.toFixed(2), 'residual SD, log points'],
    [String(data.ranked_total), 'pre-token rows on the board'],
    [money(data.rows[0].implied_value_usd), 'highest implied value'],
  ];
  fitItems.forEach(function (pair) {
    var d = document.createElement('div');
    d.className = 'fit';
    var b = document.createElement('b');
    b.textContent = pair[0];
    var s = document.createElement('span');
    s.textContent = pair[1];
    d.appendChild(b);
    d.appendChild(s);
    $('fit-grid').appendChild(d);
  });
  if (data.scatter_svg) $('scatter').innerHTML = data.scatter_svg;
  $('asof').textContent = data.as_of_iso;

  var fillSelect = function (el, values) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  };
  fillSelect(categoryEl, Array.from(new Set(data.rows.map(function (r) { return r.category; }).filter(Boolean))).sort());
  fillSelect(chainEl, Array.from(new Set(data.rows.flatMap(function (r) { return r.chains; }))).sort());

  // ---------------------------------------------------------------- filtering + sorting
  var visible = function () {
    var list = state.tab === 'pre' ? data.rows : data.live;
    var q = state.q.trim().toLowerCase();
    var out = list.filter(function (r) {
      if (state.tab === 'pre' && state.watchlistOnly && !r.watchlist) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && (r.category || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'rank') return state.tab === 'pre' ? data.rows.indexOf(r) : data.live.indexOf(r);
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl;
      if (key === 'change_7d') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age_days') return r.age_days === null ? -Infinity : r.age_days;
      if (key === 'implied') return state.tab === 'pre' ? r.implied_value_usd : r.mcap;
      return 0;
    };
    out.sort(function (a, b) {
      var va = val(a);
      var vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return out;
  };

  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  var render = function () {
    var list = visible();
    var total = state.tab === 'pre' ? data.rows.length : data.live.length;
    countEl.textContent = 'Showing ' + list.length + ' of ' + total + (state.tab === 'pre' ? ' pre-token protocols' : ' live-token protocols');
    emptyEl.hidden = list.length > 0;
    rowsEl.innerHTML = '';
    var max = state.tab === 'pre' ? data.rows[0].implied_value_usd : data.live[0].mcap;
    list.forEach(function (r, i) {
      var tr = document.createElement('tr');
      tr.dataset.slug = r.slug;
      if (r.slug === selectedSlug) tr.dataset.selected = 'true';
      var rank = state.tab === 'pre' ? data.rows.indexOf(r) + 1 : data.live.indexOf(r) + 1;
      tr.appendChild(el('td', 'num', String(rank)));
      var nameTd = el('td');
      var nameWrap = el('span', 'name');
      nameWrap.appendChild(el('b', null, r.name));
      var sub = el('span', 'sub', (r.category || 'Uncategorized') + (r.chains.length ? ' · ' + r.chains.slice(0, 3).join(', ') : ''));
      nameWrap.appendChild(sub);
      nameTd.appendChild(nameWrap);
      tr.appendChild(nameTd);
      tr.appendChild(el('td', 'num', compact(r.tvl)));
      var ch = el('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), pct(r.change_7d));
      tr.appendChild(ch);
      tr.appendChild(el('td', 'num', state.tab === 'pre' ? ageText(r.age_days) : '—'));
      var impTd = el('td');
      var impWrap = el('span', 'implied');
      var value = state.tab === 'pre' ? r.implied_value_usd : r.mcap;
      impWrap.appendChild(el('span', 'num', money(value)));
      var bar = el('span', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(1, Math.round((value / max) * 100)) + '%';
      bar.appendChild(fill);
      impWrap.appendChild(bar);
      impTd.appendChild(impWrap);
      tr.appendChild(impTd);
      var tokTd = el('td');
      if (state.tab === 'pre') {
        var badge = el('span', 'badge', r.watchlist ? 'Pre-token · watchlist' : 'Pre-token');
        tokTd.appendChild(badge);
      } else {
        tokTd.appendChild(el('span', 'badge live', 'Live token'));
      }
      tr.appendChild(tokTd);
      tr.addEventListener('click', function () { openDetail(r); });
      rowsEl.appendChild(tr);
    });
    document.querySelectorAll('th button[data-sort]').forEach(function (btn) {
      btn.removeAttribute('aria-sort');
      if (btn.dataset.sort === state.sort) btn.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
    });
  };

  // ---------------------------------------------------------------- detail view
  var openDetail = function (r) {
    selectedSlug = r.slug;
    var isPre = state.tab === 'pre';
    var rank = isPre ? data.rows.indexOf(r) + 1 : data.live.indexOf(r) + 1;
    $('detail-kicker').textContent = isPre
      ? 'Rank ' + rank + (r.watchlist ? ' · Watchlist' : '')
      : 'Live token · ' + rank + ' by market cap';
    $('detail-title').textContent = r.name;
    $('detail-sub').textContent = (r.category || 'Uncategorized') + (r.chains.length ? ' · ' + r.chains.join(', ') : '');
    var eq = $('detail-equation');
    eq.innerHTML = '';
    var row = function (label, value) {
      var d = document.createElement('div');
      d.appendChild(el('span', null, label));
      d.appendChild(el('b', null, value));
      eq.appendChild(d);
    };
    if (isPre) {
      var change = clamp(r.change_7d === null ? 0 : r.change_7d, model.growth_floor, model.growth_cap);
      var tvlAdj = r.tvl / (1 + change / 100);
      var mult = r.category ? (model.category_multipliers[r.category] || 1) : 1;
      row('TVL', money(r.tvl));
      row('7-day change', pct(r.change_7d) + (r.change_7d !== null && (r.change_7d < model.growth_floor || r.change_7d > model.growth_cap) ? ' (clamped to ' + pct(change) + ')' : ''));
      row('Growth-adjusted TVL', money(tvlAdj));
      row('Category multiplier (' + (r.category || 'none') + ')', '\u00d7' + mult.toFixed(3));
      row('Age tilt (' + ageText(r.age_days) + ')', '\u00d7' + ageTilt(r.age_days).toFixed(3));
      row('Implied value', money(r.implied_value_usd));
      var recomputed = impliedOf(r);
      $('detail-check').textContent = recomputed === r.implied_value_usd
        ? 'The page recomputes ' + money(recomputed) + ' from the model — the same number the board carries.'
        : 'Warning: the page recomputes ' + money(recomputed) + ', but the board carries ' + money(r.implied_value_usd) + '.';
    } else {
      row('Market cap', money(r.mcap));
      row('TVL', money(r.tvl));
      row('Market cap / TVL', (r.mcap / Math.max(1, r.tvl)).toFixed(2) + '\u00d7');
      row('7-day change', pct(r.change_7d));
      $('detail-check').textContent = 'This protocol already has a token, so it sits outside the farm board. It is here because its market cap is one of the 128 the model learned from.';
    }
    var stepsEl = $('detail-steps');
    stepsEl.innerHTML = '';
    if (isPre) {
      r.farm_steps.forEach(function (step) {
        var li = document.createElement('li');
        var m = step.match(/^(.*?)\s*Cost: (.*)$/);
        if (m) {
          li.appendChild(el('b', null, m[1]));
          li.appendChild(document.createTextNode(' '));
          li.appendChild(el('span', 'cost', 'Cost: ' + m[2]));
        } else {
          li.textContent = step;
        }
        stepsEl.appendChild(li);
      });
    } else {
      var li = document.createElement('li');
      li.textContent = 'No farm plan: a live token means the launch already happened. The farm board is for protocols that still record no token.';
      stepsEl.appendChild(li);
    }
    if (!detailEl.open) detailEl.showModal();
    render();
  };

  $('detail-close').addEventListener('click', function () { detailEl.close(); });
  detailEl.addEventListener('close', function () { selectedSlug = null; render(); });

  // ---------------------------------------------------------------- events
  searchEl.addEventListener('input', function () { state.q = searchEl.value; render(); });
  categoryEl.addEventListener('change', function () { state.category = categoryEl.value; render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; render(); });
  watchlistEl.addEventListener('change', function () { state.watchlistOnly = watchlistEl.checked; render(); });
  var setTab = function (tab) {
    state.tab = tab;
    tabPre.setAttribute('aria-pressed', String(tab === 'pre'));
    tabLive.setAttribute('aria-pressed', String(tab === 'live'));
    document.querySelector('th button[data-sort="implied"]').textContent = tab === 'pre' ? 'Implied value' : 'Market cap';
    render();
  };
  tabPre.addEventListener('click', function () { setTab('pre'); });
  tabLive.addEventListener('click', function () { setTab('live'); });
  document.querySelectorAll('th button[data-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.sort;
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      if (key === 'rank') state.dir = 1;
      render();
    });
  });
  $('reset').addEventListener('click', function () {
    state.q = '';
    state.category = '';
    state.chain = '';
    state.watchlistOnly = false;
    searchEl.value = '';
    categoryEl.value = '';
    chainEl.value = '';
    watchlistEl.checked = false;
    render();
  });

  render();
})();
