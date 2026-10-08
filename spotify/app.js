(function () {
  "use strict";

  var nf = new Intl.NumberFormat("tr-TR");
  var nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  var DAYS_LONG = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  var HOUR = 3.6e6;
  var MIN_PLAY = 30000; // Spotify counts a stream after 30 seconds.

  // A page can set window.SPOTIFY = { data: "data.json", voice: "me" } to show
  // one person's saved summary in their own voice instead of the upload tool.
  var CONFIG = window.SPOTIFY || {};
  var V = CONFIG.voice === "me" ? {
    listened: "dinledim", days: "Müzik dinlediğim gün", skips: "Atladığım şarkı", skipsD: "İlk 30 saniyede ileri geçtiklerim",
    topA: "Bir numaralı sanatçım", topT: "Bir numaralı şarkım", first: "Kayıtlardaki ilk şarkım",
    night: "Gece kuşuyum.", morning: "Güne müzikle başlıyorum.", evening: "Akşamları açılıyorum.",
    peakH: "En yoğun saatim", peakD: "En çok dinlediğim gün"
  } : {
    listened: "dinledin", days: "Müzik dinlediğin gün", skips: "Atladığın şarkı", skipsD: "İlk 30 saniyede ileri geçtiklerin",
    topA: "Bir numaralı sanatçın", topT: "Bir numaralı şarkın", first: "Kayıtlardaki ilk şarkın",
    night: "Gece kuşusun.", morning: "Güne müzikle başlıyorsun.", evening: "Akşamları açılıyorsun.",
    peakH: "En yoğun saatin", peakD: "En çok dinlediğin gün"
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hours(ms) { return ms / HOUR; }
  function fmtHours(ms) {
    var h = hours(ms);
    return (h >= 10 ? nf.format(Math.round(h)) : nf1.format(h)) + " saat";
  }
  function fmtDate(t) {
    var d = new Date(t);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  /* ---------- Reading files ---------- */

  // Minimal ZIP reader: walks the central directory and inflates entries with
  // the browser's built-in DecompressionStream, so no library is needed.
  async function readZip(file, onEntry) {
    var buf = await file.arrayBuffer();
    var dv = new DataView(buf);
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Bu dosya geçerli bir ZIP gibi görünmüyor.");
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true);
    if (p === 0xffffffff) throw new Error("ZIP dosyası çok büyük. Açıp içindeki JSON dosyalarını bırakmayı dene.");
    var dec = new TextDecoder();
    var wanted = [];
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var size = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (isHistoryName(name) && (method === 0 || method === 8)) wanted.push({ method: method, size: size, local: local });
    }
    // Inflate and hand over one file at a time so only one is held in memory.
    for (var w = 0; w < wanted.length; w++) {
      var e = wanted[w];
      var start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      var data = new Uint8Array(buf, start, e.size);
      var text;
      if (e.method === 0) text = dec.decode(data);
      else {
        var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        text = await new Response(stream).text();
      }
      onEntry(text, w + 1, wanted.length);
    }
    return wanted.length;
  }

  function isHistoryName(name) {
    var base = name.split("/").pop();
    return /\.json$/i.test(base) && /stream(ing)?_?history/i.test(base);
  }

  async function readFiles(files, parser) {
    var found = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (/\.zip$/i.test(f.name) || f.type === "application/zip") {
        setStatus(f.name + " açılıyor…");
        found += await readZip(f, function (text, k, total) {
          setStatus("Dinleme geçmişi okunuyor: " + k + " / " + total);
          parser.add(text);
        });
      } else if (/\.json$/i.test(f.name)) {
        parser.add(await f.text());
        found++;
      }
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return found;
  }

  // Spotify ships two formats: "Extended streaming history" (every play since
  // the account was opened) and the lighter "Account data" (last ~12 months).
  function makeParser() {
    var extended = [], basic = [];
    function add(text) {
      var arr;
      try { arr = JSON.parse(text); } catch (err) { return; }
      if (!Array.isArray(arr)) return;
      arr.forEach(function (r) {
        if (r.ts !== undefined) {
          var t = Date.parse(r.ts);
          if (isNaN(t)) return;
          if (r.master_metadata_track_name) {
            var ms = +r.ms_played || 0;
            extended.push({
              t: t, ms: ms, track: r.master_metadata_track_name, artist: r.master_metadata_album_artist_name || "Bilinmeyen sanatçı",
              skip: ms < MIN_PLAY && (r.skipped === true || r.reason_end === "fwdbtn")
            });
          } else if (r.episode_name || r.episode_show_name || r.audiobook_title) {
            extended.push({ t: t, ms: +r.ms_played || 0, pod: true });
          }
        } else if (r.endTime !== undefined) {
          var tb = Date.parse(String(r.endTime).replace(" ", "T") + ":00Z");
          if (isNaN(tb)) return;
          var bms = +r.msPlayed || 0;
          if (r.trackName) basic.push({ t: tb, ms: bms, track: r.trackName, artist: r.artistName || "Bilinmeyen sanatçı", skip: bms > 0 && bms < MIN_PLAY });
          else if (r.podcastName || r.episodeName) basic.push({ t: tb, ms: +r.msPlayed || 0, pod: true });
        }
      });
    }
    // If both formats were uploaded they overlap, so prefer the complete one.
    function result() {
      if (extended.length) return { records: extended, kind: "extended" };
      return { records: basic, kind: basic.length ? "basic" : "none" };
    }
    return { add: add, result: result };
  }

  /* ---------- Demo data ---------- */

  function demoRecords() {
    var seed = 20130314;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var syll = ["Gece", "Mavi", "Neon", "Kuş", "Deniz", "Ayna", "Kum", "Yol", "Rüzgâr", "Sis", "Kahve", "Plak", "Taş", "Ateş", "Yağmur", "Kar", "Işık", "Gölge", "Duman", "Kıyı"];
    var tail = [" Yolcuları", " Sokak", " Kuşlar", " Orkestrası", " ve Arkadaşları", " Kulübü", " Kardeşler", "", " Projesi", " Trio"];
    var words = ["Sabah", "Eski", "Uzak", "Son", "İlk", "Kırmızı", "Sessiz", "Yarım", "Beyaz", "Sıcak", "Kayıp", "Yeni"];
    var nouns = ["Mektup", "Şehir", "Balkon", "Tren", "Yaz", "Sokak", "Hikâye", "Pazar", "Telefon", "Fotoğraf", "Liman", "Kapı"];
    var start = Date.UTC(2013, 2, 14), end = Date.UTC(2026, 8, 30);
    var span = end - start;
    var artists = [];
    for (var a = 0; a < 46; a++) {
      var name = syll[Math.floor(rnd() * syll.length)] + tail[Math.floor(rnd() * tail.length)];
      if (artists.some(function (x) { return x.name === name; })) { a--; continue; }
      var tracks = [];
      for (var k = 0; k < 10; k++) tracks.push(words[Math.floor(rnd() * words.length)] + " " + nouns[Math.floor(rnd() * nouns.length)]);
      artists.push({
        name: name, tracks: tracks,
        peak: rnd(), width: 0.06 + rnd() * 0.22,
        base: rnd() < 0.18 ? 0.25 : 0.02, weight: 0.4 + rnd() * 1.4
      });
    }
    var hourW = [5, 3, 2, 1, 1, 1, 2, 4, 7, 8, 7, 7, 8, 8, 8, 8, 9, 10, 11, 12, 13, 13, 11, 8];
    var hourSum = hourW.reduce(function (s, x) { return s + x; }, 0);
    function pickHour() {
      var r = rnd() * hourSum;
      for (var h = 0; h < 24; h++) { r -= hourW[h]; if (r <= 0) return h; }
      return 23;
    }
    var out = [];
    var days = Math.floor(span / 864e5);
    for (var d = 0; d < days; d++) {
      var x = d / days;
      var ws = artists.map(function (ar) {
        var g = Math.exp(-Math.pow((x - ar.peak) / ar.width, 2));
        return ar.weight * (ar.base + g);
      });
      var total = ws.reduce(function (s, w) { return s + w; }, 0);
      var plays = Math.floor(10 + rnd() * 30 + x * 15);
      for (var p = 0; p < plays; p++) {
        var r = rnd() * total, idx = 0;
        while (idx < ws.length - 1 && (r -= ws[idx]) > 0) idx++;
        var ar = artists[idx];
        var ti = Math.floor(Math.pow(rnd(), 1.8) * ar.tracks.length);
        var skipped = rnd() < 0.2;
        out.push({
          t: start + d * 864e5 + pickHour() * HOUR + Math.floor(rnd() * HOUR),
          ms: skipped ? Math.floor(rnd() * 25000) : Math.floor(150000 + rnd() * 110000),
          track: ar.tracks[ti], artist: ar.name, skip: skipped
        });
      }
      if (rnd() < 0.15) out.push({ t: start + d * 864e5 + 8 * HOUR, ms: Math.floor(600000 + rnd() * 2400000), pod: true });
    }
    out.push({ t: start + 19 * HOUR, ms: 214000, track: artists[0].tracks[0], artist: artists[0].name });
    return out;
  }

  /* ---------- Aggregation ---------- */

  function aggregate(records) {
    records.sort(function (a, b) { return a.t - b.t; });
    var music = records.filter(function (r) { return !r.pod; });
    if (!music.length) throw new Error("Dosyada müzik dinleme kaydı bulamadım.");
    var first = new Date(music[0].t), last = new Date(music[music.length - 1].t);
    var y0 = first.getFullYear(), m0 = first.getMonth();
    var months = (last.getFullYear() - y0) * 12 + last.getMonth() - m0 + 1;

    var A = { ms: 0, plays: 0, podMs: 0, skips: 0, first: music[0], last: music[music.length - 1], y0: y0, m0: m0, months: months };
    var artists = new Map(), tracks = new Map(), years = new Map();
    var heat = []; for (var i = 0; i < 7; i++) heat.push(new Float64Array(24));
    var artistMonth = new Map();
    var days = new Set();

    records.forEach(function (r) {
      if (r.pod) { A.podMs += r.ms; return; }
      var d = new Date(r.t);
      var y = d.getFullYear();
      var play = r.ms >= MIN_PLAY ? 1 : 0;
      A.ms += r.ms; A.plays += play;
      if (r.skip) A.skips++;
      days.add(y * 400 + d.getMonth() * 32 + d.getDate());

      var ar = artists.get(r.artist);
      if (!ar) { ar = { name: r.artist, ms: 0, plays: 0, first: r.t }; artists.set(r.artist, ar); }
      ar.ms += r.ms; ar.plays += play;

      var key = r.track + "\u0001" + r.artist;
      var tr = tracks.get(key);
      if (!tr) { tr = { track: r.track, artist: r.artist, ms: 0, plays: 0 }; tracks.set(key, tr); }
      tr.ms += r.ms; tr.plays += play;

      var yr = years.get(y);
      if (!yr) { yr = { year: y, ms: 0, plays: 0, artists: new Map(), tracks: new Map() }; years.set(y, yr); }
      yr.ms += r.ms; yr.plays += play;
      var ya = yr.artists.get(r.artist) || 0; yr.artists.set(r.artist, ya + r.ms);
      var yt = yr.tracks.get(key);
      if (!yt) { yt = { track: r.track, artist: r.artist, plays: 0, ms: 0 }; yr.tracks.set(key, yt); }
      yt.plays += play; yt.ms += r.ms;

      heat[(d.getDay() + 6) % 7][d.getHours()] += r.ms;

      var mi = (y - y0) * 12 + d.getMonth() - m0;
      var am = artistMonth.get(r.artist);
      if (!am) { am = new Float64Array(months); artistMonth.set(r.artist, am); }
      am[mi] += r.ms;
    });

    A.artists = Array.from(artists.values()).sort(function (a, b) { return b.ms - a.ms; });
    A.tracks = Array.from(tracks.values()).sort(function (a, b) { return b.plays - a.plays || b.ms - a.ms; });
    A.years = Array.from(years.values()).sort(function (a, b) { return a.year - b.year; });
    A.heat = heat;
    A.activeDays = days.size;
    A.artistMonth = artistMonth;
    return A;
  }

  // Everything the page shows, without the raw plays: small enough to save as
  // JSON, and the race keeps only artists that ever reach its top rows.
  function summarize(A) {
    var keep = new Set();
    ["total", "window"].forEach(function (mode) {
      raceCandidates(A.artistMonth, A.months, mode).forEach(function (n) { keep.add(n); });
    });
    var artistMonth = new Map();
    keep.forEach(function (n) { artistMonth.set(n, A.artistMonth.get(n)); });
    return {
      ms: A.ms, plays: A.plays, podMs: A.podMs, skips: A.skips, activeDays: A.activeDays,
      artistCount: A.artists.length, trackCount: A.tracks.length,
      first: { t: A.first.t, track: A.first.track, artist: A.first.artist }, lastT: A.last.t,
      y0: A.y0, m0: A.m0, months: A.months,
      artists: A.artists.slice(0, 25).map(function (a) { return { name: a.name, ms: a.ms }; }),
      tracks: A.tracks.slice(0, 25).map(function (t) { return { track: t.track, artist: t.artist, plays: t.plays, ms: t.ms }; }),
      years: A.years.map(function (y) {
        return {
          year: y.year, ms: y.ms, plays: y.plays,
          artists: Array.from(y.artists.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5)
            .map(function (e) { return { name: e[0], ms: e[1] }; }),
          tracks: Array.from(y.tracks.values()).sort(function (a, b) { return b.plays - a.plays || b.ms - a.ms; }).slice(0, 5)
            .map(function (t) { return { track: t.track, artist: t.artist, plays: t.plays, ms: t.ms }; })
        };
      }),
      heat: A.heat.map(function (row) { return Array.from(row); }),
      artistMonth: artistMonth
    };
  }

  // JSON form of a summary: monthly race values are stored in whole minutes.
  function toJSON(S) {
    var o = Object.assign({}, S);
    var names = Array.from(S.artistMonth.keys());
    o.race = { names: names, minutes: names.map(function (n) { return Array.from(S.artistMonth.get(n), function (v) { return Math.round(v / 60000); }); }) };
    delete o.artistMonth;
    return o;
  }
  function fromJSON(o) {
    var S = Object.assign({}, o);
    S.artistMonth = new Map();
    o.race.names.forEach(function (n, i) { S.artistMonth.set(n, Float64Array.from(o.race.minutes[i], function (m) { return m * 60000; })); });
    delete S.race;
    return S;
  }

  // Artists that make the race's visible rows (plus two in waiting) in any month.
  var RACE_TOP = 10;
  function raceCandidates(artistMonth, M, mode) {
    var names = Array.from(artistMonth.keys());
    var arrs = names.map(function (n) { return artistMonth.get(n); });
    var cur = new Float64Array(names.length), cand = new Set();
    for (var m = 0; m < M; m++) {
      for (var i = 0; i < names.length; i++) {
        cur[i] += arrs[i][m];
        if (mode === "window" && m >= 12) cur[i] -= arrs[i][m - 12];
      }
      var top = [];
      for (var j = 0; j < names.length; j++) {
        if (cur[j] < 60000) continue;
        if (top.length < RACE_TOP + 2 || cur[j] > cur[top[top.length - 1]]) {
          top.push(j);
          top.sort(function (a, b) { return cur[b] - cur[a]; });
          if (top.length > RACE_TOP + 2) top.pop();
        }
      }
      top.forEach(function (k) { cand.add(names[k]); });
    }
    return cand;
  }

  /* ---------- Rendering the page ---------- */

  function rankList(items, opts) {
    var max = items.length ? opts.value(items[0]) : 1;
    return items.map(function (it, i) {
      return '<li class="' + (i === 0 ? "top" : "") + '"><span class="n">' + (i + 1) + '</span>' +
        '<span class="t" title="' + esc(opts.title(it)) + '">' + opts.label(it) + '</span>' +
        '<span class="m">' + opts.meta(it) + '</span>' +
        (opts.meter ? '<span class="n"></span><span class="meter"><i style="width:' + (opts.value(it) / max * 100).toFixed(1) + '%"></i></span>' : "") +
        '</li>';
    }).join("");
  }
  var artistOpts = {
    value: function (a) { return a.ms; }, title: function (a) { return a.name; },
    label: function (a) { return esc(a.name); }, meta: function (a) { return fmtHours(a.ms); }, meter: true
  };
  var trackOpts = {
    value: function (t) { return t.plays; }, title: function (t) { return t.track + " — " + t.artist; },
    label: function (t) { return esc(t.track) + ' <span>· ' + esc(t.artist) + '</span>'; },
    meta: function (t) { return nf.format(t.plays) + " kez"; }, meter: false
  };

  function render(A, kind, isDemo) {
    var banner = $("banner");
    if (banner) banner.className = "banner hidden";
    if (isDemo) {
      banner.className = "banner";
      banner.innerHTML = '<span>Şu an <strong>örnek veri</strong> görüyorsun. Sanatçılar ve şarkılar uydurma.</span><button type="button" data-reset>Kendi verimi yükle</button>';
    } else if (kind === "basic") {
      banner.className = "banner warn";
      banner.innerHTML = '<span>Bu dosya sadece yaklaşık son bir yılı kapsıyor. Bütün geçmişin için Spotify\'dan <strong>"Extended streaming history"</strong> iste.</span>';
    }

    var totalH = hours(A.ms);
    $("since").textContent = fmtDate(A.first.t) + " ile " + fmtDate(A.lastT) + " arasında";
    $("bigHours").innerHTML = nf.format(Math.round(totalH)) + "<small>saat müzik</small>";
    var dayCount = totalH / 24;
    $("bigSub").textContent = "Yani aralıksız " + nf.format(Math.round(dayCount)) + " gün. Bu sürede " +
      nf.format(A.plays) + " şarkı " + V.listened + ".";

    var topA = A.artists[0], topT = A.tracks[0];
    var stats = [
      ["Farklı sanatçı", nf.format(A.artistCount), ""],
      ["Farklı şarkı", nf.format(A.trackCount), ""],
      [V.days, nf.format(A.activeDays), "Günde ortalama " + nf.format(Math.round(A.ms / A.activeDays / 60000)) + " dakika"],
      [V.skips, nf.format(A.skips), V.skipsD],
      [V.topA, esc(topA.name), fmtHours(topA.ms), true],
      [V.topT, esc(topT.track), esc(topT.artist) + " · " + nf.format(topT.plays) + " kez", true]
    ];
    if (A.podMs > HOUR) stats.splice(4, 0, ["Podcast", fmtHours(A.podMs), ""]);
    $("stats").innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="k">' + s[0] + '</div><div class="v' + (s[3] ? " sm" : "") + '">' + s[1] + '</div>' +
        (s[2] ? '<div class="d">' + s[2] + '</div>' : "") + '</div>';
    }).join("");
    $("firstSong").innerHTML = '<div class="k">' + V.first + ' · ' + fmtDate(A.first.t) + '</div>' +
      '<div class="v">' + esc(A.first.track) + ' <span class="muted">— ' + esc(A.first.artist) + '</span></div>';

    // Years
    var maxY = Math.max.apply(null, A.years.map(function (y) { return y.ms; }));
    $("yearBars").innerHTML = A.years.map(function (y) {
      return '<button type="button" data-year="' + y.year + '" class="' + (y.ms === maxY ? "peak" : "") + '" title="' + y.year + ': ' + fmtHours(y.ms) + '">' +
        '<span class="val">' + nf.format(Math.round(hours(y.ms))) + '</span>' +
        '<span class="bar" style="height:' + Math.max(2, y.ms / maxY * 100).toFixed(1) + '%"></span>' +
        '<span class="lbl">’' + String(y.year).slice(2) + '</span></button>';
    }).join("");
    $("years").innerHTML = A.years.slice().reverse().map(function (y) {
      var ta = y.artists, tt = y.tracks;
      return '<article class="year" id="y' + y.year + '"><div class="yh"><span class="yn display">' + y.year + '</span>' +
        '<span class="yt">' + fmtHours(y.ms) + '<br>' + nf.format(y.plays) + ' şarkı</span></div>' +
        '<h3>Sanatçılar</h3><ol class="rank">' + rankList(ta, artistOpts) + '</ol>' +
        '<h3>Şarkılar</h3><ol class="rank">' + rankList(tt, trackOpts) + '</ol></article>';
    }).join("");

    renderAllTime("artists");
    renderHeat(A);
    race.load(A);
  }

  function renderAllTime(tab) {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    $("allTime").innerHTML = tab === "artists"
      ? rankList(state.S.artists, artistOpts)
      : rankList(state.S.tracks, trackOpts);
  }

  function renderHeat(A) {
    var max = 0, total = 0, dayTot = new Array(7).fill(0), hourTot = new Array(24).fill(0);
    A.heat.forEach(function (row, d) {
      row.forEach(function (v, h) { max = Math.max(max, v); total += v; dayTot[d] += v; hourTot[h] += v; });
    });
    var html = "<span></span>";
    for (var h = 0; h < 24; h++) html += '<span class="hl">' + h + '</span>';
    A.heat.forEach(function (row, d) {
      html += '<span class="dl">' + DAYS[d] + '</span>';
      row.forEach(function (v, hh) {
        var o = max ? Math.pow(v / max, 0.8) : 0;
        html += '<span class="c" style="opacity:' + Math.max(0.05, o).toFixed(3) + '" title="' + DAYS_LONG[d] + ' ' + hh + ':00 · ' + fmtHours(v) + '"></span>';
      });
    });
    $("heat").innerHTML = html;

    var peakH = hourTot.indexOf(Math.max.apply(null, hourTot));
    var peakD = dayTot.indexOf(Math.max.apply(null, dayTot));
    var night = hourTot.slice(0, 5).reduce(function (s, x) { return s + x; }, 0) / total;
    var morning = hourTot.slice(5, 12).reduce(function (s, x) { return s + x; }, 0) / total;
    var label = night > 0.12 ? V.night : morning > 0.35 ? V.morning : peakH >= 17 ? V.evening : "Gün boyu müzik.";
    $("clockTitle").textContent = label;
    var facts = [
      [V.peakH, peakH + ":00 – " + (peakH + 1) % 24 + ":00"],
      [V.peakD, DAYS_LONG[peakD]],
      ["Gece yarısından sonra (00–05)", "%" + nf.format(Math.round(night * 100))]
    ];
    $("heatFacts").innerHTML = facts.map(function (f) {
      return '<div class="stat"><div class="k">' + f[0] + '</div><div class="v sm">' + f[1] + '</div></div>';
    }).join("");
  }

  /* ---------- Artist race (canvas) ---------- */

  var race = (function () {
    var canvas = $("raceCanvas"), ctx = canvas.getContext("2d");
    var TOP = RACE_TOP;
    var A = null, data = {}, series = null;
    var t = 0, playing = false, lastTs = 0, snap = true, rec = null, holdUntil = 0;
    var disp = new Map(); // artist -> { y, a } for smooth reordering

    function build(mode) {
      var names = Array.from(raceCandidates(A.artistMonth, A.months, mode));
      var M = A.months;
      var vals = names.map(function (n) {
        var src = A.artistMonth.get(n), out = new Float64Array(M), run = 0;
        for (var m = 0; m < M; m++) {
          run += src[m];
          if (mode === "window" && m >= 12) run -= src[m - 12];
          out[m] = Math.max(0, run);
        }
        return out;
      });
      return { names: names, vals: vals, colors: names.map(colorFor) };
    }

    // Colors go round the palette in the order artists first reach the chart,
    // so neighbours rarely share one, and an artist keeps it across modes.
    var PALETTE = ["#1ed760", "#ff4d2e", "#ffc53d", "#4da3ff", "#c084fc", "#ff7eb6", "#2dd4bf", "#f97316", "#a3e635", "#818cf8", "#f472b6", "#facc15"];
    var colorMap = new Map();
    function colorFor(name) {
      if (!colorMap.has(name)) colorMap.set(name, PALETTE[colorMap.size % PALETTE.length]);
      return colorMap.get(name);
    }

    function load(agg) {
      A = agg; data = {}; colorMap.clear();
      stop();
      $("scrub").max = String(A.months - 1);
      setMode($("mode").value);
      setRatio($("ratio").value);
    }

    function setMode(mode) {
      if (!data[mode]) data[mode] = build(mode);
      series = data[mode];
      series.mode = mode;
      disp.clear();
      snap = true;
      draw(0);
    }

    function setRatio(r) {
      var dims = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] }[r];
      canvas.width = dims[0]; canvas.height = dims[1];
      snap = true;
      draw(0);
    }

    function layout() {
      var W = canvas.width, H = canvas.height, portrait = H > W * 1.2, square = !portrait && W < H * 1.2;
      var u = Math.min(W, H);
      return {
        W: W, H: H, u: u, portrait: portrait,
        pad: W * (portrait ? 0.07 : 0.05),
        top: H * (portrait ? 0.2 : square ? 0.24 : 0.25),
        bottom: H * (portrait ? 0.76 : square ? 0.84 : 0.9),
        valueSpace: W * (portrait ? 0.24 : square ? 0.2 : 0.14)
      };
    }

    function monthLabel(m) {
      var mm = A.m0 + Math.floor(m);
      return { month: MONTHS[mm % 12], year: A.y0 + Math.floor(mm / 12) };
    }

    function draw(dt) {
      if (!series) return;
      var L = layout(), W = L.W, H = L.H, M = A.months;
      var i = Math.min(Math.floor(t), M - 1), f = t - i, i2 = Math.min(i + 1, M - 1);
      var cur = series.names.map(function (n, c) {
        return { n: n, c: c, v: series.vals[c][i] * (1 - f) + series.vals[c][i2] * f };
      }).filter(function (e) { return e.v > 60000; });
      cur.sort(function (a, b) { return b.v - a.v; });
      var shown = cur.slice(0, TOP);
      var maxV = shown.length ? shown[0].v : 1;

      // Ease each bar's slot toward its rank so overtakes glide.
      var k = snap ? 1 : 1 - Math.exp(-dt * 9);
      var live = new Set();
      shown.forEach(function (e, r) {
        live.add(e.n);
        var s = disp.get(e.n);
        if (!s) { s = { y: snap ? r : TOP + 0.5, a: snap ? 1 : 0 }; disp.set(e.n, s); }
        s.y += (r - s.y) * k; s.a += (1 - s.a) * k; s.v = e.v; s.c = e.c;
      });
      disp.forEach(function (s, n) {
        if (live.has(n)) return;
        s.y += (TOP + 0.5 - s.y) * k; s.a += (0 - s.a) * k;
        var e = cur.find(function (x) { return x.n === n; });
        s.v = e ? e.v : s.v;
        if (s.a < 0.02) disp.delete(n);
      });
      snap = false;

      // Background
      ctx.fillStyle = "#0b0d0c";
      ctx.fillRect(0, 0, W, H);

      var fam = '"Bricolage Grotesque", Geist, system-ui, sans-serif';
      var body = 'Geist, system-ui, sans-serif';
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f1f2ee";
      ctx.font = "700 " + Math.round(L.u * (L.portrait ? 0.062 : 0.052)) + "px " + fam;
      ctx.textAlign = "left";
      var titleY = L.pad + L.u * 0.05;
      ctx.fillText("En çok dinlediğim sanatçılar", L.pad, titleY);
      ctx.fillStyle = "#949a95";
      ctx.font = "500 " + Math.round(L.u * (L.portrait ? 0.034 : 0.026)) + "px " + body;
      ctx.fillText(series.mode === "total" ? "İlk günden bu yana toplam dinleme süresi" : "Son 12 aydaki dinleme süresi", L.pad, titleY + L.u * (L.portrait ? 0.06 : 0.048));

      // Date
      var ml = monthLabel(i);
      ctx.textAlign = "right";
      if (L.portrait) {
        ctx.fillStyle = "#1ed760";
        ctx.font = "800 " + Math.round(W * 0.2) + "px " + fam;
        ctx.fillText(String(ml.year), W - L.pad, H * 0.9);
        ctx.fillStyle = "#949a95";
        ctx.font = "600 " + Math.round(W * 0.05) + "px " + fam;
        ctx.fillText(ml.month, W - L.pad, H * 0.9 - W * 0.2);
      } else {
        ctx.fillStyle = "rgba(241,242,238,.13)";
        ctx.font = "800 " + Math.round(L.u * 0.2) + "px " + fam;
        ctx.fillText(String(ml.year), W - L.pad, L.bottom - L.u * 0.02);
        ctx.fillStyle = "rgba(241,242,238,.32)";
        ctx.font = "600 " + Math.round(L.u * 0.05) + "px " + fam;
        ctx.fillText(ml.month, W - L.pad, L.bottom - L.u * 0.22);
      }

      // Bars
      var rowH = (L.bottom - L.top) / TOP, barH = rowH * 0.76;
      var maxW = W - L.pad * 2 - L.valueSpace;
      var nameFont = Math.round(barH * 0.42), valFont = Math.round(barH * 0.36);
      var items = Array.from(disp.entries()).sort(function (a, b) { return b[1].y - a[1].y; });
      items.forEach(function (it) {
        var name = it[0], s = it[1];
        var y = L.top + s.y * rowH + (rowH - barH) / 2;
        if (y > H) return;
        var w = Math.max(barH * 0.2, s.v / maxV * maxW);
        ctx.globalAlpha = Math.max(0, Math.min(1, s.a));
        ctx.fillStyle = series.colors[s.c];
        roundRect(L.pad, y, w, barH, Math.min(barH * 0.18, 14));
        ctx.fill();

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "700 " + nameFont + "px " + fam;
        var label = fit(name, maxW + L.valueSpace * 0.4);
        var tw = ctx.measureText(label).width;
        var cy = y + barH / 2;
        var after;
        if (tw + barH * 0.6 < w) {
          ctx.fillStyle = "#0b0d0c";
          ctx.fillText(label, L.pad + barH * 0.3, cy);
          after = L.pad + w + barH * 0.25;
        } else {
          ctx.fillStyle = "#f1f2ee";
          ctx.fillText(label, L.pad + w + barH * 0.25, cy);
          after = L.pad + w + barH * 0.5 + tw;
        }
        ctx.fillStyle = "#949a95";
        ctx.font = "500 " + valFont + "px " + body;
        ctx.fillText(nf.format(Math.round(hours(s.v))) + " saat", after, cy);
        ctx.textBaseline = "alphabetic";
      });
      ctx.globalAlpha = 1;

      // Footer
      ctx.textAlign = "left";
      ctx.fillStyle = "#5b615d";
      ctx.font = "500 " + Math.round(L.u * 0.02) + "px " + body;
      ctx.fillText("Spotify dinleme geçmişim · " + A.y0 + "–" + new Date(A.lastT).getFullYear(), L.pad, H - L.pad * 0.6);

      $("when").textContent = ml.month.slice(0, 3) + " " + ml.year;
      if (document.activeElement !== $("scrub")) $("scrub").value = String(t);
    }

    function fit(text, max) {
      if (ctx.measureText(text).width <= max) return text;
      var s = text;
      while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
      return s + "…";
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    }

    function frame(ts) {
      if (!playing) return;
      var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
      lastTs = ts;
      var end = A.months - 1;
      if (t < end) {
        t = Math.min(end, t + dt * parseFloat($("speed").value));
      } else if (!holdUntil) {
        holdUntil = ts + (rec ? 2000 : 0);
      }
      draw(dt);
      if (holdUntil && ts >= holdUntil) { finish(); return; }
      requestAnimationFrame(frame);
    }

    function play() {
      if (!A) return;
      if (t >= A.months - 1) { t = 0; snap = true; }
      playing = true; lastTs = 0; holdUntil = 0;
      $("play").textContent = "Durdur";
      requestAnimationFrame(frame);
    }
    function stop() {
      playing = false;
      $("play").textContent = "Oynat";
    }
    function finish() {
      stop();
      if (rec) rec.stop();
    }

    function seek(v) {
      t = v; snap = true;
      draw(0);
    }

    function record() {
      if (!window.MediaRecorder || !canvas.captureStream) {
        note("Bu tarayıcı video kaydını desteklemiyor. Bilgisayarda Chrome ile dene.", true);
        return;
      }
      var types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
      var type = types.find(function (x) { return MediaRecorder.isTypeSupported(x); });
      if (!type) { note("Bu tarayıcı video kaydını desteklemiyor.", true); return; }
      var chunks = [];
      var r = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 12e6 });
      r.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      r.onstop = function () {
        var ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
        var blob = new Blob(chunks, { type: type.split(";")[0] });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sanatci-yarisi-" + $("ratio").value.replace(":", "x") + "." + ext;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        rec = null;
        lock(false);
        note("Video indirildi" + (ext === "webm" ? " (WebM formatında; Premiere için HandBrake ya da CapCut ile MP4'e çevirebilirsin)." : "."), false);
      };
      rec = r;
      lock(true);
      var secs = Math.round((A.months - 1) / parseFloat($("speed").value) + 2);
      note("Kaydediliyor… yaklaşık " + secs + " saniye sürecek. Bitene kadar bu sekmede kal.", true);
      t = 0; snap = true; disp.clear();
      r.start(500);
      play();
    }

    function lock(on) {
      ["play", "record", "mode", "ratio", "speed", "scrub"].forEach(function (id) { $(id).disabled = on; });
    }
    function note(text, warn) {
      var n = $("recNote");
      n.textContent = text;
      n.className = "rec-note" + (warn ? " on" : "");
    }

    return {
      load: load, setMode: setMode, setRatio: setRatio, seek: seek, record: record,
      toggle: function () { playing ? stop() : play(); }
    };
  })();

  /* ---------- Wiring ---------- */

  var state = { S: null };

  function setStatus(text, isError) {
    var s = $("status");
    if (!s) return;
    s.textContent = text || "";
    s.className = "status" + (isError ? " error" : "");
  }

  function show(S, kind, isDemo) {
    state.S = S;
    if ($("upload")) $("upload").classList.add("hidden");
    if ($("reset")) $("reset").classList.remove("hidden");
    if ($("loading")) $("loading").classList.add("hidden");
    $("results").classList.remove("hidden");
    render(S, kind, isDemo);
    window.scrollTo(0, 0);
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    try {
      setStatus("Dosyalar okunuyor…");
      var parser = makeParser();
      var found = await readFiles(files, parser);
      if (!found) throw new Error("Bu dosyada dinleme geçmişi bulamadım. Spotify'dan gelen ZIP'i ya da içindeki \"Streaming_History\" JSON dosyalarını yükle.");
      setStatus("Hesaplanıyor…");
      await new Promise(function (r) { setTimeout(r, 30); });
      var parsed = parser.result();
      if (!parsed.records.length) throw new Error("Dosyalarda dinleme kaydı bulamadım.");
      var S = summarize(aggregate(parsed.records));
      setStatus("");
      show(S, parsed.kind, false);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Dosya okunamadı.", true);
    }
  }

  function reset() {
    state.S = null;
    $("results").classList.add("hidden");
    $("upload").classList.remove("hidden");
    $("reset").classList.add("hidden");
    $("file").value = "";
    setStatus("");
    window.scrollTo(0, 0);
  }

  var drop = $("drop");
  if (drop) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) { e.preventDefault(); });

    $("pick").addEventListener("click", function () { $("file").click(); });
    $("file").addEventListener("change", function (e) { handleFiles(e.target.files); });
    $("demo").addEventListener("click", function () {
      setStatus("Örnek veri hazırlanıyor…");
      setTimeout(function () { show(summarize(aggregate(demoRecords())), "extended", true); setStatus(""); }, 30);
    });
    $("reset").addEventListener("click", reset);
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-reset]")) reset();
    var yb = e.target.closest("[data-year]");
    if (yb) $("y" + yb.dataset.year).scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
    var tab = e.target.closest("[data-tab]");
    if (tab) renderAllTime(tab.dataset.tab);
  });

  $("play").addEventListener("click", function () { race.toggle(); });
  $("record").addEventListener("click", function () { race.record(); });
  $("mode").addEventListener("change", function (e) { race.setMode(e.target.value); });
  $("ratio").addEventListener("change", function (e) { race.setRatio(e.target.value); });
  $("scrub").addEventListener("input", function (e) { race.seek(parseFloat(e.target.value)); });

  // Make sure the canvas uses the real fonts, not the fallback.
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('700 40px "Bricolage Grotesque"'),
      document.fonts.load('500 20px Geist')
    ]).then(function () { if (state.S) race.seek(parseFloat($("scrub").value) || 0); }).catch(function () {});
  }

  if (CONFIG.data) {
    fetch(CONFIG.data)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (o) { show(fromJSON(o), "extended", false); })
      .catch(function (err) {
        console.error(err);
        $("loading").textContent = "Veriler yüklenemedi. Sayfayı yenilemeyi dene.";
      });
  }

  // Used to save a summary as a page's data file (see README).
  window.SpotifyApp = { exportSummary: function () { return state.S && JSON.stringify(toJSON(state.S)); } };
})();
