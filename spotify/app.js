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
    if (h < 1) return nf.format(Math.round(ms / 60000)) + " dk";
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
              album: r.master_metadata_album_album_name || "", skip: ms < MIN_PLAY && (r.skipped === true || r.reason_end === "fwdbtn"),
              platform: r.platform || "", rs: r.reason_start || "", re: r.reason_end || "",
              shuffle: r.shuffle === true, offline: r.offline === true, incognito: r.incognito_mode === true
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
        var r1 = rnd();
        out.push({
          t: start + d * 864e5 + pickHour() * HOUR + Math.floor(rnd() * HOUR),
          ms: skipped ? Math.floor(rnd() * 25000) : Math.floor(150000 + rnd() * 110000),
          track: ar.tracks[ti], artist: ar.name, album: ar.name + " (Albüm)", skip: skipped,
          platform: r1 < 0.55 ? "iOS 12.1 (iPhone10,6)" : r1 < 0.8 ? "OS X 10.14 [x86 8]" : r1 < 0.92 ? "Partner SCEI sony_tv ps4" : "web_player windows 10",
          rs: skipped ? "fwdbtn" : rnd() < 0.5 ? "clickrow" : "trackdone", re: skipped ? "fwdbtn" : rnd() < 0.6 ? "trackdone" : "endplay",
          shuffle: rnd() < 0.2, offline: rnd() < 0.05, incognito: false
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
      return '<li class="' + (i === 0 ? "top" : "") + '" data-q="' + esc(opts.q(it)) + '"><span class="n">' + (i + 1) + '</span>' +
        '<span class="t" title="' + esc(opts.title(it)) + '">' + opts.label(it) + '</span>' +
        '<span class="m">' + opts.meta(it) + '</span>' +
        (opts.meter ? '<span class="n"></span><span class="meter"><i style="width:' + (opts.value(it) / max * 100).toFixed(1) + '%"></i></span>' : "") +
        '</li>';
    }).join("");
  }
  var artistOpts = {
    value: function (a) { return a.ms; }, title: function (a) { return a.name; },
    label: function (a) { return esc(a.name); }, meta: function (a) { return fmtHours(a.ms); }, meter: true,
    q: function (a) { return a.name; }
  };
  var trackOpts = {
    value: function (t) { return t.plays; }, title: function (t) { return t.track + " — " + t.artist; },
    label: function (t) { return esc(t.track) + ' <span>· ' + esc(t.artist) + '</span>'; },
    meta: function (t) { return nf.format(t.plays) + " kez"; }, meter: false,
    q: function (t) { return t.track; }
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

  /* ---------- Search & explore ---------- */

  // Spotify's raw platform strings ("iOS 9.1 (iPhone7,2)", "Partner SCEI sony_tv ps4"…)
  // boiled down to a device someone would recognise.
  function deviceOf(p) {
    p = String(p || "").toLowerCase();
    if (!p || p === "not applicable") return "Bilinmiyor";
    if (/scei|playstation|ps4|ps5/.test(p)) return "PlayStation";
    if (/xbox/.test(p)) return "Xbox";
    if (/tizen|webos|roku|android_tv|android tv|smart ?tv|_tv|\btv\b/.test(p)) return "Akıllı TV";
    if (/cast|google home|sonos|alexa|echo|speaker|bose/.test(p)) return "Hoparlör / Cast";
    if (/watch|wear/.test(p)) return "Saat";
    if (/ipad/.test(p)) return "iPad";
    if (/ios|iphone/.test(p)) return "iPhone";
    if (/android-tablet/.test(p)) return "Android tablet";
    if (/android/.test(p)) return "Android";
    if (/windows phone/.test(p)) return "Windows Phone";
    if (/windows/.test(p) && !/web/.test(p)) return "Windows";
    if (/os x|osx|macos|mac os/.test(p)) return "Mac";
    if (/web/.test(p)) return "Web";
    if (/linux/.test(p)) return "Linux";
    return "Diğer";
  }
  var STARTS = ["Kendin seçtin", "Bir önceki bitince", "İleri tuşuyla", "Geri tuşuyla", "Uygulama açılınca", "Başka cihazdan", "Diğer"];
  function startOf(r) {
    if (/^(clickrow|click-row|clickside|playbtn|uriopen)$/.test(r)) return 0;
    if (r === "trackdone") return 1;
    if (r === "fwdbtn") return 2;
    if (r === "backbtn") return 3;
    if (r === "appload" || r === "persisted") return 4;
    if (r === "remote") return 5;
    return 6;
  }
  var ENDS = ["Sonuna kadar dinledin", "İleri geçtin", "Geri döndün", "Başka bir şey açtın", "Uygulama kapandı", "Diğer"];
  function endOf(r) {
    if (r === "trackdone") return 0;
    if (r === "fwdbtn") return 1;
    if (r === "backbtn") return 2;
    if (r === "endplay" || r === "clickrow" || r === "click-row" || r === "remote") return 3;
    if (/^(logout|unexpected-exit|unexpected-exit-while-paused)$/.test(r)) return 4;
    return 5;
  }

  // Every music play in compact columns (times in seconds, durations, an index
  // into a track list, and small codes for device and how it started
  // and ended). 13 years fit in a few megabytes this way.
  var PLAYS_VERSION = 2;
  function encodePlays(records) {
    var music = records.filter(function (r) { return !r.pod; });
    var n = music.length;
    var P = {
      v: PLAYS_VERSION, artists: [], albums: [], tracks: [], devices: [],
      t: new Uint32Array(n), ms: new Uint32Array(n), tr: new Uint32Array(n),
      dev: new Uint8Array(n), rs: new Uint8Array(n), re: new Uint8Array(n), fl: new Uint8Array(n)
    };
    var idx = { artists: new Map(), albums: new Map(), tracks: new Map(), devices: new Map() };
    function code(kind, key, make) {
      var m = idx[kind], v = m.get(key);
      if (v === undefined) { v = P[kind].length; P[kind].push(make ? make() : key); m.set(key, v); }
      return v;
    }
    music.forEach(function (r, i) {
      var a = code("artists", r.artist);
      var al = code("albums", r.album || "");
      P.t[i] = Math.floor(r.t / 1000);
      P.ms[i] = Math.min(r.ms, 4294967295);
      P.tr[i] = code("tracks", r.track + "\u0001" + r.artist, function () { return [r.track, a, al]; });
      P.dev[i] = Math.min(255, code("devices", deviceOf(r.platform)));
      P.rs[i] = r.rs === undefined ? 6 : startOf(r.rs);
      P.re[i] = r.re === undefined ? 5 : endOf(r.re);
      P.fl[i] = (r.shuffle ? 1 : 0) | (r.offline ? 2 : 0) | (r.incognito ? 4 : 0);
    });
    return P;
  }

  // Saved on this device only (IndexedDB), so the page can reopen without a file.
  var store = (function () {
    function open() {
      return new Promise(function (res, rej) {
        var req = indexedDB.open("spotify-zaman-makinesi", 1);
        req.onupgradeneeded = function () { req.result.createObjectStore("saved"); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }
    function run(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction("saved", mode), req = fn(tx.objectStore("saved"));
          tx.oncomplete = function () { db.close(); res(req && req.result); };
          tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
        });
      });
    }
    return {
      get: function () { return run("readonly", function (st) { return st.get("me"); }); },
      put: function (v) { return run("readwrite", function (st) { return st.put(v, "me"); }); },
      clear: function () { return run("readwrite", function (st) { return st.delete("me"); }); }
    };
  })();

  var explorer = (function () {
    var box = $("explore");
    if (!box) return { load: function () {}, search: function () {} };
    var P = null, hits = [];
    // Per-play columns derived once: local year, month, weekday, hour and month-day.
    var yr, mon, wd, hr, md, foldTrack, foldArtist, foldAlbum, trackTotal, firstPlay;
    var MONTHS_SHORT = MONTHS.map(function (m) { return m.slice(0, 3); });
    var LISTEN_COUNTS = [
      ["", "Hepsi"], ["1", "Sadece 1 kez"], ["2-4", "2–4 kez"], ["5-", "5 ve üstü"], ["20-", "20 ve üstü"], ["50-", "50 ve üstü"], ["100-", "100 ve üstü"]
    ];

    function norm(x) {
      return String(x).toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
    }

    function load(plays) {
      P = plays;
      var n = P.t.length;
      yr = new Uint16Array(n); mon = new Uint8Array(n); wd = new Uint8Array(n); hr = new Uint8Array(n); md = new Uint16Array(n);
      for (var i = 0; i < n; i++) {
        var d = new Date(P.t[i] * 1000);
        yr[i] = d.getFullYear(); mon[i] = d.getMonth(); wd[i] = (d.getDay() + 6) % 7; hr[i] = d.getHours();
        md[i] = (d.getMonth() + 1) * 100 + d.getDate();
      }
      foldTrack = P.tracks.map(function (tk) { return norm(tk[0]); });
      foldArtist = P.artists.map(norm);
      foldAlbum = P.albums.map(norm);
      // How often each track was played in total, and the first proper play of it.
      trackTotal = new Uint32Array(P.tracks.length);
      firstPlay = new Uint8Array(n);
      var seen = new Uint8Array(P.tracks.length);
      for (var j = 0; j < n; j++) {
        if (P.ms[j] < MIN_PLAY) continue;
        var k = P.tr[j];
        trackTotal[k]++;
        if (!seen[k]) { seen[k] = 1; firstPlay[j] = 1; }
      }
      buildChoices();
      document.body.classList.add("can-search");
      clear();
    }

    function countBy(col, size) {
      var c = new Uint32Array(size);
      for (var i = 0; i < col.length; i++) c[col[i]]++;
      return c;
    }
    function chips(id, items) {
      $(id).innerHTML = items.map(function (it) {
        return '<button type="button" class="chip" data-v="' + it[0] + '" aria-pressed="false">' + esc(it[1]) +
          (it[2] !== undefined ? ' <small>' + nf.format(it[2]) + '</small>' : "") + '</button>';
      }).join("");
    }
    function byCount(labels, counts) {
      return labels.map(function (l, i) { return [i, l, counts[i]]; })
        .filter(function (x) { return x[2] > 0; })
        .sort(function (a, b) { return b[2] - a[2]; });
    }

    function buildChoices() {
      var years = [];
      for (var y = yr[0]; y <= yr[yr.length - 1]; y++) years.push([y, String(y)]);
      chips("fYear", years);
      chips("fMonth", MONTHS_SHORT.map(function (m, i) { return [i, m]; }));
      chips("fDay", DAYS.map(function (d, i) { return [i, d]; }));
      chips("fDevice", byCount(P.devices, countBy(P.dev, P.devices.length)));
      chips("fStart", byCount(STARTS, countBy(P.rs, STARTS.length)));
      chips("fEnd", byCount(ENDS, countBy(P.re, ENDS.length)));
      var hours = "";
      for (var h = 0; h < 24; h++) hours += '<option value="' + h + '">' + String(h).padStart(2, "0") + ':00</option>';
      $("fHourFrom").innerHTML = hours;
      $("fHourTo").innerHTML = hours.replace(/:00</g, ":59<");
      $("fCount").innerHTML = LISTEN_COUNTS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join("");
    }

    function picked(id) {
      var set = null;
      $(id).querySelectorAll('[aria-pressed="true"]').forEach(function (b) { (set = set || {})[b.dataset.v] = 1; });
      return set;
    }
    function tri(id) { var v = $(id).value; return v === "" ? null : v === "1"; }
    function dayStart(v) { if (!v) return null; var p = v.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).getTime() / 1000; }

    function readFilters() {
      var F = {
        q: norm($("xq").value.trim()), field: $("xField").value,
        from: dayStart($("xFrom").value), to: dayStart($("xTo").value),
        today: $("xToday").getAttribute("aria-pressed") === "true",
        firsts: $("xFirsts").getAttribute("aria-pressed") === "true",
        short: $("xShort").checked,
        years: picked("fYear"), months: picked("fMonth"), days: picked("fDay"),
        devices: picked("fDevice"), starts: picked("fStart"), ends: picked("fEnd"),
        hFrom: +$("fHourFrom").value, hTo: +$("fHourTo").value,
        shuffle: tri("fShuffle"), offline: tri("fOffline"), incognito: tri("fIncognito"),
        count: $("fCount").value
      };
      if (F.to !== null) F.to += 86400 - 1;
      return F;
    }

    function run() {
      if (!P) return;
      var F = readFilters();
      var nT = P.tracks.length, match = null;
      if (F.q) {
        match = new Uint8Array(nT);
        for (var k = 0; k < nT; k++) {
          var tk = P.tracks[k];
          var hit = (F.field !== "artist" && F.field !== "album" && foldTrack[k].indexOf(F.q) >= 0) ||
            (F.field !== "track" && F.field !== "album" && foldArtist[tk[1]].indexOf(F.q) >= 0) ||
            ((F.field === "album" || F.field === "all") && foldAlbum[tk[2]].indexOf(F.q) >= 0);
          if (hit) match[k] = 1;
        }
      }
      var cMin = 0, cMax = Infinity;
      if (F.count) { var cp = F.count.split("-"); cMin = +cp[0]; cMax = cp.length > 1 ? (cp[1] ? +cp[1] : Infinity) : cMin; }
      var allHours = F.hFrom === 0 && F.hTo === 23;
      var todayMD = 0;
      if (F.today) { var now = new Date(); todayMD = (now.getMonth() + 1) * 100 + now.getDate(); }

      var out = [];
      for (var i = 0; i < P.t.length; i++) {
        if (!F.short && P.ms[i] < MIN_PLAY) continue;
        var k2 = P.tr[i];
        if (match && !match[k2]) continue;
        if (F.from !== null && P.t[i] < F.from) continue;
        if (F.to !== null && P.t[i] > F.to) continue;
        if (F.today && md[i] !== todayMD) continue;
        if (F.firsts && !firstPlay[i]) continue;
        if (F.years && !F.years[yr[i]]) continue;
        if (F.months && !F.months[mon[i]]) continue;
        if (F.days && !F.days[wd[i]]) continue;
        if (!allHours) {
          var h = hr[i];
          if (F.hFrom <= F.hTo ? (h < F.hFrom || h > F.hTo) : (h < F.hFrom && h > F.hTo)) continue;
        }
        if (F.devices && !F.devices[P.dev[i]]) continue;
        if (F.starts && !F.starts[P.rs[i]]) continue;
        if (F.ends && !F.ends[P.re[i]]) continue;
        if (F.shuffle !== null && !!(P.fl[i] & 1) !== F.shuffle) continue;
        if (F.offline !== null && !!(P.fl[i] & 2) !== F.offline) continue;
        if (F.incognito !== null && !!(P.fl[i] & 4) !== F.incognito) continue;
        if (F.count && (trackTotal[k2] < cMin || trackTotal[k2] > cMax)) continue;
        out.push(i);
      }
      hits = out;
      showActive(F);
      renderResults();
    }

    // How many of the extra filters are on, shown on the "more filters" toggle.
    function showActive(F) {
      var n = ["years", "months", "days", "devices", "starts", "ends"].filter(function (k) { return F[k]; }).length +
        (F.hFrom !== 0 || F.hTo !== 23 ? 1 : 0) + ["shuffle", "offline", "incognito"].filter(function (k) { return F[k] !== null; }).length +
        (F.count ? 1 : 0);
      $("xMoreCount").textContent = n ? n + " açık" : "";
    }

    function renderResults() {
      var n = hits.length;
      if (!n) {
        $("xStats").innerHTML = '<p class="x-empty">Bu filtrelerle eşleşen bir dinleme yok.</p>';
        ["xChart", "xArtists", "xTracks"].forEach(function (id) { $(id).innerHTML = ""; });
        return;
      }
      var totalMs = 0, plays = 0, trMs = new Float64Array(P.tracks.length), trPlays = new Uint32Array(P.tracks.length);
      var arMs = new Float64Array(P.artists.length);
      hits.forEach(function (i) {
        var k = P.tr[i];
        totalMs += P.ms[i]; trMs[k] += P.ms[i]; arMs[P.tracks[k][1]] += P.ms[i];
        if (P.ms[i] >= MIN_PLAY) { plays++; trPlays[k]++; }
      });
      var nTracks = 0, nArtists = 0;
      for (var a = 0; a < trMs.length; a++) if (trMs[a] > 0 || trPlays[a] > 0) nTracks++;
      for (var b = 0; b < arMs.length; b++) if (arMs[b] > 0) nArtists++;
      var first = P.t[hits[0]] * 1000, last = P.t[hits[n - 1]] * 1000;
      var stats = [
        ["Dinleme", nf.format(plays), "30 saniyeyi geçen çalmalar"],
        ["Toplam süre", fmtHours(totalMs), ""],
        ["İlk kez", fmtDate(first), ""],
        ["Son kez", fmtDate(last), ""],
        ["Farklı şarkı", nf.format(nTracks), ""],
        ["Farklı sanatçı", nf.format(nArtists), ""]
      ];
      $("xStats").innerHTML = stats.map(function (st) {
        return '<div class="stat"><div class="k">' + st[0] + '</div><div class="v sm">' + st[1] + '</div>' + (st[2] ? '<div class="d">' + st[2] + '</div>' : "") + '</div>';
      }).join("");

      renderChart(first, last);

      var ta = [], tt = [];
      for (var x = 0; x < arMs.length; x++) if (arMs[x] > 0) ta.push({ name: P.artists[x], ms: arMs[x] });
      for (var y = 0; y < trMs.length; y++) if (trPlays[y] > 0) tt.push({ track: P.tracks[y][0], artist: P.artists[P.tracks[y][1]], plays: trPlays[y], ms: trMs[y] });
      ta.sort(function (p, q) { return q.ms - p.ms; });
      tt.sort(function (p, q) { return q.plays - p.plays || q.ms - p.ms; });
      $("xArtists").innerHTML = rankList(ta.slice(0, 10), artistOpts);
      $("xTracks").innerHTML = rankList(tt.slice(0, 10), trackOpts);
    }

    // Listening per day for short spans, per month otherwise. Bars are clickable.
    function renderChart(first, last) {
      var a = new Date(first), b = new Date(last);
      var byDay = (last - first) / 864e5 <= 92;
      var bins = [], start;
      if (byDay) {
        start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
        var days = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - start) / 864e5) + 1;
        for (var d = 0; d < days; d++) bins.push(0);
      } else {
        var months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
        for (var m = 0; m < months; m++) bins.push(0);
      }
      hits.forEach(function (i) {
        var dt = new Date(P.t[i] * 1000), idx;
        if (byDay) idx = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - start) / 864e5);
        else idx = (dt.getFullYear() - a.getFullYear()) * 12 + dt.getMonth() - a.getMonth();
        bins[idx] += P.ms[i];
      });
      var max = Math.max.apply(null, bins) || 1;
      function binDate(k) {
        return byDay ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + k) : new Date(a.getFullYear(), a.getMonth() + k, 1);
      }
      function label(k) {
        var dt = binDate(k);
        return byDay ? dt.getDate() + " " + MONTHS[dt.getMonth()] + " " + dt.getFullYear() : MONTHS[dt.getMonth()] + " " + dt.getFullYear();
      }
      $("xChart").innerHTML = bins.map(function (v, k) {
        return '<button type="button" data-bin="' + k + '" title="' + label(k) + ' · ' + fmtHours(v) + '"><i style="height:' + (v ? Math.max(2, v / max * 100) : 0).toFixed(1) + '%"></i></button>';
      }).join("") + '<span class="ax">' + label(0) + '</span><span class="ax r">' + label(bins.length - 1) + '</span>';
      $("xChart").onclick = function (e) {
        var btn = e.target.closest("[data-bin]");
        if (!btn) return;
        var dt = binDate(+btn.dataset.bin);
        var end = byDay ? dt : new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
        $("xToday").setAttribute("aria-pressed", "false");
        $("xFrom").value = iso(dt); $("xTo").value = iso(end);
        run();
      };
    }

    function iso(d) {
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    // The current results as a spreadsheet file (opens in Excel / Numbers / Sheets).
    function exportCsv() {
      if (!hits.length) return;
      var rows = [["Tarih", "Saat", "Şarkı", "Sanatçı", "Albüm", "Dinleme (sn)", "Cihaz", "Nasıl başladı", "Nasıl bitti", "Karışık", "Çevrimdışı"]];
      for (var j = 0; j < hits.length; j++) {
        var i = hits[hits.length - 1 - j], d = new Date(P.t[i] * 1000), tk = P.tracks[P.tr[i]];
        rows.push([iso(d), String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"),
          tk[0], P.artists[tk[1]], P.albums[tk[2]] || "", Math.round(P.ms[i] / 1000), P.devices[P.dev[i]],
          STARTS[P.rs[i]], ENDS[P.re[i]], P.fl[i] & 1 ? "Evet" : "Hayır", P.fl[i] & 2 ? "Evet" : "Hayır"]);
      }
      var csv = "﻿" + rows.map(function (r) {
        return r.map(function (c) { c = String(c); return /[";\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(";");
      }).join("\r\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "spotify-dinlemeler.csv";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    }

    function clear() {
      $("xq").value = ""; $("xField").value = "all"; $("xFrom").value = ""; $("xTo").value = ""; $("xShort").checked = false;
      $("xToday").setAttribute("aria-pressed", "false"); $("xFirsts").setAttribute("aria-pressed", "false");
      box.querySelectorAll(".x-panel .chip[aria-pressed]").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      $("fHourFrom").value = "0"; $("fHourTo").value = "23";
      ["fShuffle", "fOffline", "fIncognito", "fCount"].forEach(function (id) { $(id).value = ""; });
      run();
    }

    var timer = 0;
    function later() { clearTimeout(timer); timer = setTimeout(run, 150); }
    $("xq").addEventListener("input", later);
    box.addEventListener("change", function (e) {
      if (e.target.id === "xq") return;
      if (e.target.id === "xFrom" || e.target.id === "xTo") $("xToday").setAttribute("aria-pressed", "false");
      run();
    });
    box.addEventListener("click", function (e) {
      var c = e.target.closest(".chip[aria-pressed]");
      if (!c) return;
      c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") === "true" ? "false" : "true");
      if (c.id === "xToday" && c.getAttribute("aria-pressed") === "true") { $("xFrom").value = ""; $("xTo").value = ""; }
      later();
    });
    $("xClear").addEventListener("click", clear);
    $("xCsv").addEventListener("click", exportCsv);

    return {
      load: load,
      search: function (q) {
        if (!P) return;
        $("xq").value = q;
        run();
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
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
      var plays = encodePlays(parsed.records);
      setStatus("");
      show(S, parsed.kind, false);
      explorer.load(plays);
      if ($("remember").checked) {
        store.put({ summary: toJSON(S), plays: plays, kind: parsed.kind, savedAt: Date.now() })
          .then(function () { savedBanner(Date.now()); })
          .catch(function (err) { console.warn("Kaydedilemedi", err); });
      }
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
      setTimeout(function () {
        var recs = demoRecords();
        show(summarize(aggregate(recs)), "extended", true);
        explorer.load(encodePlays(recs));
        setStatus("");
      }, 30);
    });
    $("reset").addEventListener("click", reset);
  }

  function savedBanner(when) {
    var banner = $("banner");
    banner.className = "banner";
    banner.innerHTML = '<span>Geçmişin bu cihazda kayıtlı (' + fmtDate(when) + '). Sayfayı bir dahaki açışında dosya yüklemeden görürsün.</span>' +
      '<button type="button" id="forget">Bu cihazdan sil</button>';
  }

  // Reopen a history saved on this device.
  if (drop && window.indexedDB) {
    store.get().then(function (saved) {
      if (!saved || state.S) return;
      if (!saved.plays || saved.plays.v !== PLAYS_VERSION) {
        store.clear().catch(function () {});
        setStatus("Sayfa güncellendi: yeni filtreler için dosyanı bir kez daha yükle.");
        return;
      }
      show(fromJSON(saved.summary), saved.kind, false);
      explorer.load(saved.plays);
      savedBanner(saved.savedAt);
    }).catch(function () {});
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-reset]")) reset();
    if (e.target.closest("#forget")) {
      store.clear().then(reset, reset);
      return;
    }
    var qItem = e.target.closest("[data-q]");
    if (qItem && document.body.classList.contains("can-search")) explorer.search(qItem.dataset.q);
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
