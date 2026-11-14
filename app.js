/* ARCHIVEFLIX - standalone streaming style home screen for archive.org.
   Vanilla JS, no libraries. All personal data stays in localStorage.
   Catalog, playback and downloads come from archive.org. Titles, years and
   descriptions are the Archive's own uploader supplied metadata, shown as-is.
   Playback uses the Archive's own MP4 file in a native video element, so
   your place is saved automatically as you watch and you resume exactly
   where you left off. The Archive embed is only a fallback for titles
   with no file this browser can play directly.
   The catalog loads once when the app opens. It is re-scanned only on
   pull-to-refresh on Home, on a browser refresh, on app start, or when
   a finished title sends you back to Home. Nothing here reloads on a
   timer, and nothing interrupts watching, searching or browsing.
*/

(function () {
"use strict";

/* ---------- Constants ---------- */

var API = "https://archive.org/advancedsearch.php";
var META_API = "https://archive.org/metadata/";
var STORE_KEY = "archiveflix.v1";
var ROW_SIZE = 24;

/* Items that are playlists or collection pages, not films. Skip them. */
var PLAYLIST_BLOCKLIST = ["SciFi_Horror", "Comedy_Films", "silent_films",
  "SciFi_Horror_Movies", "Feature_Films", "classic_tv", "classic_cartoons"];

var SEARCH_FIELDS = ["identifier", "title", "year", "creator", "description",
  "avg_rating", "downloads", "num_reviews", "subject", "collection"];

var GENRES = {
  horror:   { label: "Horror",    subject: "horror",
              subs: [["zombie", "Zombie"], ["gothic", "Gothic"], ["vampire", "Vampire"], ["monster", "Monster"], ["slasher", "Slasher"]] },
  comedy:   { label: "Comedy",    subject: "comedy",
              subs: [["slapstick", "Slapstick"], ["satire", "Satire"]] },
  scifi:    { label: "Sci-Fi",    subject: "\"science fiction\"",
              subs: [["space", "Space"], ["alien", "Alien"], ["robot", "Robot"]] },
  thriller: { label: "Thriller",  subject: "thriller",
              subs: [["crime", "Crime"], ["mystery", "Mystery"], ["detective", "Detective"]] },
  mystery:  { label: "Mystery",   subject: "mystery",
              subs: [["detective", "Detective"], ["crime", "Crime"]] },
  noir:     { label: "Film Noir", subject: "\"film noir\"",
              subs: [["crime", "Crime"], ["detective", "Detective"], ["mystery", "Mystery"]] },
  western:  { label: "Western",   subject: "western",
              subs: [["spaghetti", "Spaghetti"]] },
  drama:    { label: "Drama",     subject: "drama",
              subs: [["crime", "Crime"]] }
};

var THEMES = [
  { id: "flix",     name: "Cinema Gold",  colors: ["#0f0f0f", "#f0b429", "#f5f5f5"] },
  { id: "midnight", name: "Midnight",     colors: ["#0d1526", "#3b82f6", "#eef2ff"] },
  { id: "forest",   name: "Forest",       colors: ["#101a12", "#22c55e", "#edf5ee"] },
  { id: "sunset",   name: "Sunset",       colors: ["#1d1410", "#f59e0b", "#fdf3e7"] },
  { id: "light",    name: "Light",        colors: ["#f4f4f4", "#c40812", "#161616"] },
  { id: "contrast", name: "High Contrast", colors: ["#000000", "#ffff00", "#ffffff"] }
];

/* ---------- Small utils ---------- */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function cleanTitle(t) {
  t = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  return t || "Untitled";
}

function cleanText(t, max) {
  t = String(t == null ? "" : t).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (max && t.length > max) t = t.slice(0, max - 1).trim() + "...";
  return t;
}

function posterUrl(id) { return "https://archive.org/services/img/" + id; }
function embedUrl(id) { return "https://archive.org/embed/" + id; }
function detailsUrl(id) { return "https://archive.org/details/" + id; }
function downloadUrl(id, file) {
  return "https://archive.org/download/" + id + "/" + encodeURIComponent(file);
}

function isYoutubeRip(id) {
  var low = String(id).toLowerCase();
  return low.indexOf("youtube") === 0 || low.indexOf("yt-") === 0 || low.indexOf("yt_") === 0;
}

function isBlocked(id) {
  return PLAYLIST_BLOCKLIST.indexOf(id) !== -1;
}

function formatSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return Math.round(bytes / 1048576) + " MB";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function formatRuntime(seconds) {
  seconds = Number(seconds) || 0;
  if (!seconds) return "";
  var m = Math.round(seconds / 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}

/* Clock style time: 327 seconds is 5:27, 5400 is 1:30:00. */
function formatTime(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  var mm = h ? (m < 10 ? "0" + m : String(m)) : String(m);
  var ss = s < 10 ? "0" + s : String(s);
  return (h ? h + ":" + mm : mm) + ":" + ss;
}

/* Plain words for where you are in a title, from a history entry. */
function placeText(h) {
  if (!h || h.progress <= 0) return "Not started yet.";
  if (h.progress >= 1) return "Finished.";
  if (h.position > 0 && h.duration > 0) {
    return "Resume from " + formatTime(h.position) + " of " + formatTime(h.duration) +
      " (" + Math.round(h.progress * 100) + "%).";
  }
  return "Your place: " + Math.round(h.progress * 100) + "%.";
}

/* Where playback should resume, in seconds. Old history entries only
   have a progress fraction, so those fall back to fraction times
   duration. Finished titles start over, and a place in the last
   seconds starts over too. */
function resumeSeconds(entry, duration) {
  if (!entry || entry.progress >= 1) return 0;
  duration = Number(duration) || 0;
  var pos = 0;
  if (entry.position != null && Number(entry.position) > 0) pos = Number(entry.position);
  else if (entry.progress > 0 && duration > 0) pos = entry.progress * duration;
  if (duration > 0 && pos > duration - 15) return 0;
  if (pos < 5) return 0;
  return Math.floor(pos);
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined,
      { year: "numeric", month: "short", day: "numeric" });
  } catch (e) { return ""; }
}

function subjectsOf(doc) {
  var out = [];
  toArray(doc.subject).forEach(function (s) {
    String(s).split(";").forEach(function (part) {
      part = part.trim();
      if (part) out.push(part);
    });
  });
  return out;
}

function typeOf(doc, fallback) {
  var cols = toArray(doc.collection).map(function (c) { return String(c).toLowerCase(); });
  if (cols.indexOf("classic_tv") !== -1) return "show";
  if (cols.indexOf("classic_cartoons") !== -1) return "cartoon";
  var subs = subjectsOf(doc).map(function (s) { return s.toLowerCase(); });
  if (subs.indexOf("cartoons") !== -1 || subs.indexOf("cartoon") !== -1) return "cartoon";
  return fallback || "movie";
}

function normalizeDoc(doc, fallbackType) {
  var year = doc.year;
  if (Array.isArray(year)) year = year[0];
  year = parseInt(year, 10);
  return {
    id: String(doc.identifier),
    title: cleanTitle(doc.title),
    year: isNaN(year) ? null : year,
    creator: toArray(doc.creator)[0] ? String(toArray(doc.creator)[0]) : "",
    description: cleanText(doc.description),
    rating: doc.avg_rating != null ? Number(doc.avg_rating) : null,
    downloads: doc.downloads != null ? Number(doc.downloads) : 0,
    numReviews: doc.num_reviews != null ? Number(doc.num_reviews) : 0,
    subjects: subjectsOf(doc),
    type: typeOf(doc, fallbackType)
  };
}

/* Pick a sensible download file from a metadata files list.
   Prefer a 512kb MP4, else the smallest MP4 over 1 MB, else any video file. */
function pickDownloadFile(files) {
  files = files || [];
  var mp4s = files.filter(function (f) {
    return f && f.name && /\.mp4$/i.test(f.name) && Number(f.size) > 1048576;
  });
  if (mp4s.length) {
    var small = null;
    mp4s.forEach(function (f) {
      if (f.name.indexOf("512kb") !== -1) small = small || f;
    });
    if (small) return small;
    mp4s.sort(function (a, b) { return Number(a.size) - Number(b.size); });
    return mp4s[0];
  }
  var video = files.filter(function (f) {
    return f && f.name && /\.(ogv|webm|mkv|mpeg|mpg|mov)$/i.test(f.name);
  });
  if (video.length) {
    video.sort(function (a, b) { return Number(a.size) - Number(b.size); });
    return video[0];
  }
  return null;
}

/* Pick a file a browser <video> element can actually play. Same idea as
   the download picker, but only web playable formats count: MP4 first
   (the 512kb one when there is one), then WebM or Ogg. MKV, MPEG and
   MOV files do not play in most phone browsers, so they are skipped. */
function pickPlayableFile(files) {
  files = files || [];
  function playable(f) {
    return f && f.name && /\.(mp4|m4v|webm|ogv)$/i.test(f.name) &&
      Number(f.size) > 1048576;
  }
  var mp4s = files.filter(function (f) {
    return playable(f) && /\.(mp4|m4v)$/i.test(f.name);
  });
  if (mp4s.length) {
    var small = null;
    mp4s.forEach(function (f) {
      if (f.name.indexOf("512kb") !== -1) small = small || f;
    });
    if (small) return small;
    mp4s.sort(function (a, b) { return Number(a.size) - Number(b.size); });
    return mp4s[0];
  }
  var others = files.filter(function (f) { return playable(f); });
  if (others.length) {
    others.sort(function (a, b) { return Number(a.size) - Number(b.size); });
    return others[0];
  }
  return null;
}

/* ---------- State (localStorage) ---------- */

var memoryStore = null;

function defaultState() {
  return {
    version: 1,
    history: {},
    myList: [],
    reactions: {},
    hideWatched: false,
    theme: "flix",
    customAccent: "",
    omdbKey: "",
    omdbCache: {},
    tmdbKey: ""
  };
}

function loadState() {
  try {
    var raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    var s = JSON.parse(raw);
    var d = defaultState();
    Object.keys(d).forEach(function (k) { if (s[k] == null) s[k] = d[k]; });
    return s;
  } catch (e) {
    if (!memoryStore) memoryStore = defaultState();
    return memoryStore;
  }
}

function saveState() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    memoryStore = state;
  }
}

var state = loadState();

function isFinished(id) {
  var h = state.history[id];
  return !!(h && h.progress >= 1);
}

function inMyList(id) {
  return state.myList.some(function (m) { return m.id === id; });
}

function reactionOf(id) {
  var r = state.reactions[id];
  return r ? r.value : 0;
}

/* A title counts as watched for hiding once it is finished. In-progress
   titles keep showing, so Continue Watching still works. */
function shouldHide(item) {
  if (!state.hideWatched) return false;
  return isFinished(item.id);
}

function filterVisible(items) {
  return items.filter(function (it) { return !shouldHide(it); });
}

/* Position and duration are seconds. A finished title keeps its
   duration but its position goes back to 0, so playing it again
   starts from the beginning. Older entries without a position keep
   working: they just have the progress fraction. */
function recordProgress(item, progress, position, duration) {
  var prev = state.history[item.id];
  var wasFinished = !!(prev && prev.progress >= 1);
  var now = Date.now();
  state.history[item.id] = {
    id: item.id,
    title: item.title,
    year: item.year,
    type: item.type,
    subjects: item.subjects || (prev && prev.subjects) || [],
    progress: progress,
    position: progress >= 1 ? 0 :
      (position != null ? Math.round(position) : (prev ? prev.position || 0 : 0)),
    duration: duration != null ? Math.round(duration) : (prev ? prev.duration || 0 : 0),
    lastWatchedAt: now,
    watchCount: (prev ? prev.watchCount : 0) + (progress >= 1 && !wasFinished ? 1 : 0)
  };
  saveState();
}

function toggleMyList(item) {
  var i = state.myList.findIndex(function (m) { return m.id === item.id; });
  if (i === -1) {
    state.myList.unshift({ id: item.id, title: item.title, year: item.year, type: item.type });
    toast("Saved to My List");
  } else {
    state.myList.splice(i, 1);
    toast("Removed from My List");
  }
  saveState();
}

function setReaction(item, value) {
  if (reactionOf(item.id) === value) {
    delete state.reactions[item.id];
    toast("Reaction cleared");
  } else {
    state.reactions[item.id] = {
      value: value,
      title: item.title,
      year: item.year,
      type: item.type,
      subjects: item.subjects || []
    };
    toast(value === 1 ? "Liked" : "Noted as not for you");
  }
  saveState();
}

/* ---------- Archive.org API ---------- */

var searchCache = {};
var metaCache = {};

function searchUrl(query, opts) {
  opts = opts || {};
  var p = new URLSearchParams();
  p.set("q", query);
  SEARCH_FIELDS.forEach(function (f) { p.append("fl[]", f); });
  p.set("rows", String(opts.rows || ROW_SIZE));
  if (opts.start) p.set("start", String(opts.start));
  if (opts.sort) p.append("sort[]", opts.sort);
  p.set("output", "json");
  return API + "?" + p.toString();
}

function searchArchive(query, opts) {
  opts = opts || {};
  var key = query + "|" + (opts.rows || ROW_SIZE) + "|" + (opts.sort || "") + "|" + (opts.start || 0);
  if (searchCache[key]) return Promise.resolve(searchCache[key]);
  return fetch(searchUrl(query, opts)).then(function (res) {
    if (!res.ok) throw new Error("Archive search failed: " + res.status);
    return res.json();
  }).then(function (json) {
    var docs = ((json.response || {}).docs || []).map(function (d) {
      return normalizeDoc(d, opts.type);
    }).filter(function (it) { return it.id && !isBlocked(it.id); });
    var out = { total: (json.response || {}).numFound || 0, items: docs };
    searchCache[key] = out;
    return out;
  });
}

function getMetadata(id) {
  if (metaCache[id]) return Promise.resolve(metaCache[id]);
  return fetch(META_API + encodeURIComponent(id)).then(function (res) {
    if (!res.ok) throw new Error("Archive metadata failed: " + res.status);
    return res.json();
  }).then(function (json) {
    metaCache[id] = json;
    return json;
  });
}

/* OMDb is only ever called when the user saved their own free key. */
function omdbRating(title, year) {
  var key = state.omdbKey;
  if (!key) return Promise.resolve(null);
  var cacheKey = title.toLowerCase() + "|" + (year || "");
  if (state.omdbCache[cacheKey]) return Promise.resolve(state.omdbCache[cacheKey]);
  var url = "https://www.omdbapi.com/?apikey=" + encodeURIComponent(key) +
    "&t=" + encodeURIComponent(title) + (year ? "&y=" + year : "") + "&type=movie";
  return fetch(url).then(function (res) { return res.json(); }).then(function (j) {
    var out = null;
    if (j && j.Response === "True" && j.imdbRating && j.imdbRating !== "N/A") {
      out = { rating: Number(j.imdbRating), votes: j.imdbVotes || "" };
      state.omdbCache[cacheKey] = out;
      saveState();
    }
    return out;
  }).catch(function () { return null; });
}

/* ---------- Real movie posters ---------- */
/* Cards show the Archive thumbnail right away, then upgrade to a real
   movie poster when one resolves. Layers, best first:
   1. OMDb poster (needs the user's free OMDb key)
   2. TMDB poster (needs the user's free TMDB key)
   3. The Archive item's own poster or cover image files
   4. Wikimedia Commons public domain poster search (no key)
   5. The Archive thumbnail (the starting image, always the fallback)
   Every layer fails silently into the next, and resolved posters are
   cached in localStorage so they are not re-fetched every visit. */

var POSTER_CACHE_KEY = "archiveflix.posters.v1";
var POSTER_CACHE_MAX = 400;
var POSTER_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

function loadPosterCache() {
  try {
    var raw = window.localStorage.getItem(POSTER_CACHE_KEY);
    if (!raw) return {};
    var c = JSON.parse(raw);
    if (!c || typeof c !== "object") return {};
    var now = Date.now();
    Object.keys(c).forEach(function (k) {
      if (!c[k] || now - (c[k].ts || 0) > POSTER_CACHE_MS) delete c[k];
    });
    return c;
  } catch (e) {
    return {};
  }
}

var posterCache = loadPosterCache();
var posterAttempted = {};

function savePosterCache() {
  try {
    var keys = Object.keys(posterCache);
    if (keys.length > POSTER_CACHE_MAX) {
      keys.sort(function (a, b) { return (posterCache[a].ts || 0) - (posterCache[b].ts || 0); });
      keys.slice(0, keys.length - POSTER_CACHE_MAX).forEach(function (k) { delete posterCache[k]; });
    }
    window.localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache));
  } catch (e) { /* private mode or full: posters just re-resolve next visit */ }
}

function clearPosterCache() {
  posterCache = {};
  posterAttempted = {};
  try { window.localStorage.removeItem(POSTER_CACHE_KEY); } catch (e) {}
}

/* Clean a catalog title for poster matching: drop parentheticals, a
   trailing year and anything after it, and colorized tags. */
function cleanSearchTitle(title) {
  var t = String(title || "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  var m = /^(.+?)\s+\b(19|20)\d{2}\b.*$/.exec(t);
  if (m) t = m[1].trim();
  t = t.replace(/\bcolori[sz]ed\b.*$/i, "").trim();
  return t.replace(/\s+/g, " ").trim();
}

/* Pick a poster or cover image from an Archive metadata files list.
   Ranks poster over cover over front over folder, skips thumbnails,
   gifs and tiny files. */
function pickArchivePosterFile(files) {
  files = files || [];
  var ranked = [];
  files.forEach(function (f) {
    if (!f || !f.name) return;
    var name = String(f.name).toLowerCase();
    if (!/\.(jpg|jpeg|png|webp)$/i.test(name)) return;
    if (name.indexOf("thumb") !== -1) return;
    if (Number(f.size) < 5000) return;
    var rank = -1;
    if (name.indexOf("poster") !== -1) rank = 0;
    else if (name.indexOf("cover") !== -1) rank = 1;
    else if (name.indexOf("front") !== -1) rank = 2;
    else if (name.indexOf("folder") !== -1) rank = 3;
    if (rank === -1) return;
    ranked.push({ file: f, rank: rank });
  });
  if (!ranked.length) return null;
  ranked.sort(function (a, b) {
    return a.rank - b.rank || Number(b.file.size) - Number(a.file.size);
  });
  return ranked[0].file;
}

/* Pick the best poster from a Wikimedia Commons image search result.
   pages is an array of {title, imageinfo: [{url, thumburl, width, height, mime}]}.
   Only files named like posters, covers or lobby cards count, so film
   stills and logos do not slip in; title words break ties. A file
   dated to a different year than the film is the wrong poster (a
   remake's, usually) and is skipped outright. */
function pickCommonsPoster(pages, title, year) {
  pages = pages || [];
  var words = cleanSearchTitle(title).toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 3; });
  var best = null, bestScore = 0, bestWidth = 0;
  pages.forEach(function (p) {
    var info = (p.imageinfo || [])[0];
    if (!info) return;
    if (info.mime !== "image/jpeg" && info.mime !== "image/png") return;
    if (Number(info.width) < 300 || Number(info.height) < 300) return;
    var name = String(p.title || "").toLowerCase();
    if (name.indexOf("screenshot") !== -1 || name.indexOf("logo") !== -1 ||
        name.indexOf("soundtrack") !== -1) return;
    var score = 0;
    if (name.indexOf("poster") !== -1 || name.indexOf("one-sheet") !== -1 ||
        name.indexOf("onesheet") !== -1) score += 3;
    if (name.indexOf("cover") !== -1) score += 2;
    if (name.indexOf("lobby") !== -1) score += 2;
    if (score === 0) return;
    if (year) {
      var years = name.match(/\b(19|20)\d{2}\b/g) || [];
      if (years.length && years.indexOf(String(year)) === -1) return;
      if (years.indexOf(String(year)) !== -1) score += 2;
    }
    words.forEach(function (w) { if (name.indexOf(w) !== -1) score += 1; });
    if (score > bestScore || (score === bestScore && Number(info.width) > bestWidth)) {
      bestScore = score;
      bestWidth = Number(info.width);
      best = info.thumburl || info.url;
    }
  });
  return best;
}

function tmdbPosterUrl(path) {
  return path ? "https://image.tmdb.org/t/p/w342" + path : null;
}

/* OMDb poster. Exact title first, then a search for the first result
   that actually has a poster. "N/A" means no poster. */
function omdbPoster(title, year) {
  var key = state.omdbKey;
  if (!key) return Promise.resolve(null);
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var base = "https://www.omdbapi.com/?apikey=" + encodeURIComponent(key);
  if (year) base += "&y=" + encodeURIComponent(year);
  function posterOf(j) {
    if (!j || j.Poster == null || j.Poster === "N/A") return null;
    return j.Poster;
  }
  return fetch(base + "&t=" + encodeURIComponent(t))
    .then(function (res) { return res.json(); })
    .then(function (j) {
      var p = posterOf(j);
      if (p) return p;
      return fetch(base + "&s=" + encodeURIComponent(t))
        .then(function (res) { return res.json(); })
        .then(function (j2) {
          var list = (j2 && j2.Search) || [];
          for (var i = 0; i < list.length; i++) {
            var q = posterOf(list[i]);
            if (q) return q;
          }
          return null;
        });
    })
    .catch(function () { return null; });
}

function tmdbSearch(endpoint, q, year, key) {
  var url = "https://api.themoviedb.org/3/search/" + endpoint +
    "?api_key=" + encodeURIComponent(key) + "&query=" + encodeURIComponent(q) +
    "&include_adult=false";
  if (year) url += "&" + (endpoint === "tv" ? "first_air_date_year=" : "year=") +
    encodeURIComponent(year);
  return fetch(url).then(function (res) { return res.json(); }).then(function (j) {
    var list = (j && j.results) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].poster_path) return tmdbPosterUrl(list[i].poster_path);
    }
    return null;
  }).catch(function () { return null; });
}

/* TMDB poster, matched by title and year. Shows search TV first,
   everything else searches movies first, then the other side. */
function tmdbPoster(title, year, type) {
  var key = state.tmdbKey;
  if (!key) return Promise.resolve(null);
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var first = type === "show" ? "tv" : "movie";
  var second = first === "tv" ? "movie" : "tv";
  return tmdbSearch(first, t, year, key).then(function (p) {
    if (p) return p;
    return tmdbSearch(second, t, year, key);
  });
}

/* The Archive item's own poster or cover files, from its metadata
   (the metadata call is already cached per session). */
function archivePoster(id) {
  return getMetadata(id).then(function (json) {
    var f = pickArchivePosterFile((json || {}).files);
    return f ? downloadUrl(id, f.name) : null;
  }).catch(function () { return null; });
}

/* Wikimedia Commons public domain poster search. No key needed. */
function commonsPoster(title, year) {
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*"
    + "&generator=search&gsrsearch=" + encodeURIComponent('"' + t + '" poster')
    + "&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=500";
  return fetch(url).then(function (res) { return res.json(); }).then(function (j) {
    var pages = ((j.query || {}).pages) || {};
    var list = Object.keys(pages).map(function (k) { return pages[k]; });
    return pickCommonsPoster(list, title, year);
  }).catch(function () { return null; });
}

/* Run the layers in order. Returns a poster URL or null (keep the
   Archive thumbnail). The result is cached either way. */
function resolvePoster(item) {
  var id = item.id;
  var cached = posterCache[id];
  if (cached) return Promise.resolve(cached.url);
  return omdbPoster(item.title, item.year).then(function (p) {
    if (p) return p;
    return tmdbPoster(item.title, item.year, item.type);
  }).then(function (p) {
    if (p) return p;
    return archivePoster(id);
  }).then(function (p) {
    if (p) return p;
    return commonsPoster(item.title, item.year);
  }).then(function (p) {
    posterCache[id] = { url: p || null, ts: Date.now() };
    savePosterCache();
    return p || null;
  }).catch(function () { return null; });
}

/* Poster upgrades run through a small queue so a row of cards never
   fires off a dozen requests at once, and only for cards near the
   viewport, so scrolling a row never blocks the page. */

var posterQueue = [];
var posterInFlight = 0;
var POSTER_MAX_INFLIGHT = 3;
var posterObserver = null;
var posterImgItems = (typeof WeakMap !== "undefined") ? new WeakMap() : null;

function posterQueueRun(job) {
  posterInFlight++;
  resolvePoster(job.item).then(function (url) {
    posterInFlight--;
    if (url && job.img.src !== url) job.img.src = url;
    posterQueuePump();
  }).catch(function () { posterInFlight--; posterQueuePump(); });
}

function posterQueuePump() {
  while (posterInFlight < POSTER_MAX_INFLIGHT && posterQueue.length) {
    posterQueueRun(posterQueue.shift());
  }
}

function ensurePosterObserver() {
  if (posterObserver) return posterObserver;
  if (typeof IntersectionObserver === "undefined") return null;
  posterObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var img = entry.target;
      posterObserver.unobserve(img);
      var item = posterImgItems ? posterImgItems.get(img) : null;
      if (item) {
        posterQueue.push({ img: img, item: item });
        posterQueuePump();
      }
    });
  }, { rootMargin: "200px" });
  return posterObserver;
}

/* If an upgraded poster fails to load, fall back to the Archive
   thumbnail instead of leaving a blank card. The inline onerror
   handler hides the image first; this restores it with the thumbnail. */
function posterErrorGuard(img, item) {
  function onErr() {
    img.removeEventListener("error", onErr);
    if (img.src !== posterUrl(item.id)) {
      img.style.display = "";
      img.src = posterUrl(item.id);
    }
  }
  img.addEventListener("error", onErr);
}

/* Upgrade one image to a real poster when one resolves. The Archive
   thumbnail stays put until something better arrives, and nothing
   here ever blocks the rows. */
function upgradePoster(img, item) {
  if (!img || !item || !item.id) return;
  posterErrorGuard(img, item);
  var cached = posterCache[item.id];
  if (cached) {
    if (cached.url && img.src !== cached.url) img.src = cached.url;
    return;
  }
  if (posterAttempted[item.id]) return;
  posterAttempted[item.id] = true;
  var obs = ensurePosterObserver();
  if (obs && posterImgItems) {
    posterImgItems.set(img, item);
    obs.observe(img);
  } else {
    posterQueue.push({ img: img, item: item });
    posterQueuePump();
  }
}

/* ---------- UI helpers ---------- */

var toastTimer = null;
function toast(msg) {
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
}

function starText(rating) {
  if (rating == null || isNaN(rating)) return "";
  return "★ " + rating.toFixed(1);
}

function typeLabel(type) {
  if (type === "show") return "Show";
  if (type === "cartoon") return "Cartoon";
  return "Movie";
}

function ratingBadge(item) {
  if (item.imdbRating != null) return "IMDb " + item.imdbRating.toFixed(1);
  if (item.rating != null) return "Archive " + item.rating.toFixed(1);
  return "";
}

function cardEl(item) {
  var btn = document.createElement("button");
  btn.className = "card";
  btn.setAttribute("aria-label", item.title + (item.year ? " (" + item.year + ")" : ""));
  var badge = ratingBadge(item);
  var h = item.id && state.history[item.id];
  var prog = h ? h.progress : 0;
  var meta = [item.year ? String(item.year) : "", typeLabel(item.type)].filter(Boolean).join(" · ");
  btn.innerHTML =
    '<span class="poster"><span class="poster-fallback">' + esc(item.title) + "</span>" +
    '<img src="' + posterUrl(item.id) + '" alt="" loading="lazy" ' +
    'onerror="this.style.display=\'none\'"></span>' +
    '<span class="card-body"><span class="card-title">' + esc(item.title) + "</span>" +
    '<span class="card-meta">' + esc(meta) + "</span>" +
    (item.type === "show" ? '<span class="card-badge type-badge">TV Show</span>' :
     item.type === "cartoon" ? '<span class="card-badge type-badge">Cartoon</span>' : "") +
    (badge ? '<span class="card-badge">' + esc(badge) + "</span>" : "") +
    (prog > 0 && prog < 1
      ? '<span class="progress-track"><span class="progress-fill" style="width:' + Math.round(prog * 100) + '%"></span></span>'
      : "") +
    (prog >= 1 ? '<span class="card-badge">Watched</span>' : "") +
    "</span>";
  var posterImg = btn.querySelector("img");
  if (posterImg) upgradePoster(posterImg, item);
  btn.addEventListener("click", function () { openDetails(item); });
  return btn;
}

function rowEl(title, subtitle) {
  var section = document.createElement("section");
  section.className = "row";
  section.innerHTML = '<div class="row-head"><h2>' + esc(title) + "</h2>" +
    (subtitle ? '<p class="row-sub">' + esc(subtitle) + "</p>" : "") + "</div>" +
    '<div class="row-scroll"></div>';
  return section;
}

function fillRow(section, items, emptyText) {
  var scroll = section.querySelector(".row-scroll");
  scroll.innerHTML = "";
  if (!items.length) {
    var p = document.createElement("p");
    p.className = "row-error";
    p.textContent = emptyText || "Nothing here yet.";
    scroll.appendChild(p);
    return;
  }
  items.forEach(function (it) { scroll.appendChild(cardEl(it)); });
}

function rowError(section, retry) {
  var scroll = section.querySelector(".row-scroll");
  scroll.innerHTML = "";
  var p = document.createElement("p");
  p.className = "row-error";
  p.textContent = "Could not load this row from archive.org. Check your connection and try again.";
  var b = document.createElement("button");
  b.className = "btn small";
  b.textContent = "Retry";
  b.addEventListener("click", retry);
  scroll.appendChild(p);
  scroll.appendChild(b);
}

/* Expandable descriptions: long text is clamped with a Read more toggle
   that expands it in place. The toggle only shows when the text is
   actually longer than the clamped display. */
function descHtml(text, pClass) {
  return '<div class="desc-wrap"><p class="' + pClass + ' desc-text clamped">' +
    esc(text) + '</p><button class="read-more-btn" type="button" hidden ' +
    'aria-expanded="false">Read more</button></div>';
}

function wireExpandableDescs(root) {
  root = root || document;
  var wraps = root.querySelectorAll ? root.querySelectorAll(".desc-wrap") : [];
  Array.prototype.forEach.call(wraps, function (wrap) {
    var text = wrap.querySelector(".desc-text");
    var btn = wrap.querySelector(".read-more-btn");
    if (!text || !btn) return;
    if (!wrap.getAttribute("data-wired")) {
      wrap.setAttribute("data-wired", "1");
      btn.addEventListener("click", function () {
        var open = wrap.classList.toggle("expanded");
        btn.textContent = open ? "Read less" : "Read more";
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    if (wrap.classList.contains("expanded")) { btn.hidden = false; return; }
    var overflowing;
    if (text.clientHeight > 0) {
      overflowing = text.scrollHeight > text.clientHeight + 1;
    } else {
      overflowing = text.textContent.length > 200;
    }
    btn.hidden = !overflowing;
  });
}

/* ---------- Row definitions ---------- */

var MOVIES = "collection:feature_films";
var ROW_DEFS = [
  { id: "trending",  title: "Trending Now", q: MOVIES, sort: "downloads desc", skipNoYear: true },
  { id: "toprated",  title: "Top Rated", q: MOVIES, sort: "avg_rating desc", rows: 40, byRating: true, skipNoYear: true },
  { id: "horror",    title: "Horror", q: MOVIES + " AND subject:horror", sort: "downloads desc" },
  { id: "comedy",    title: "Comedy", q: MOVIES + " AND subject:comedy", sort: "downloads desc" },
  { id: "scifi",     title: "Sci-Fi", q: MOVIES + ' AND subject:"science fiction"', sort: "downloads desc" },
  { id: "thriller",  title: "Thriller", q: MOVIES + " AND subject:thriller", sort: "downloads desc" },
  { id: "plottwist", title: "Plot Twist", subtitle: "Mysteries and thrillers where nothing is what it seems",
    q: MOVIES + " AND subject:(mystery OR thriller)", sort: "downloads desc" },
  { id: "noir",      title: "Film Noir", q: MOVIES + ' AND subject:"film noir"', sort: "downloads desc" },
  { id: "westerns",  title: "Westerns", q: MOVIES + " AND subject:western", sort: "downloads desc" },
  { id: "shows",     title: "Shows", q: "collection:classic_tv", sort: "downloads desc", type: "show" },
  { id: "cartoons",  title: "Cartoons", special: "cartoons" },
  { id: "animation", title: "Animation", q: "mediatype:movies AND subject:cartoons", sort: "downloads desc", type: "cartoon", noYoutube: true },
  { id: "new",       title: "Newly Added", q: MOVIES, sort: "addeddate desc" },
  { id: "golden",    title: "Golden Age 1930s", q: MOVIES + " AND year:[1930 TO 1939]", sort: "downloads desc" },
  { id: "silent",    title: "Silent Era", q: MOVIES + " AND year:[1890 TO 1929]", sort: "downloads desc" },
  { id: "directors", title: "Directors Picks", subtitle: "Hitchcock, Chaplin, Keaton and Welles", special: "directors" },
  { id: "imdb",      title: "Top IMDb", special: "imdb" }
];

function loadRow(def) {
  if (def.special === "directors") return loadDirectors();
  if (def.special === "cartoons") return loadCartoons();
  if (def.special === "imdb") return loadTopImdb();
  return searchArchive(def.q, { rows: def.rows || 30, sort: def.sort, type: def.type })
    .then(function (res) {
      var items = res.items;
      if (def.noYoutube) items = items.filter(function (it) { return !isYoutubeRip(it.id); });
      if (def.skipNoYear) items = items.filter(function (it) { return it.year != null; });
      if (def.byRating) {
        items = items.filter(function (it) { return it.rating != null; })
          .sort(function (a, b) {
            return (b.rating - a.rating) || (b.downloads - a.downloads);
          });
      }
      return items.slice(0, ROW_SIZE);
    });
}

function loadDirectors() {
  var directors = ["Alfred Hitchcock", "Charlie Chaplin", "Buster Keaton", "Orson Welles"];
  var jobs = directors.map(function (name) {
    return searchArchive('creator:"' + name + '" AND mediatype:movies',
      { rows: 8, sort: "downloads desc", type: "movie" }).catch(function () { return { items: [] }; });
  });
  return Promise.all(jobs).then(function (results) {
    var seen = {};
    var items = [];
    results.forEach(function (r) {
      r.items.forEach(function (it) {
        if (!seen[it.id]) { seen[it.id] = true; items.push(it); }
      });
    });
    items.sort(function (a, b) { return b.downloads - a.downloads; });
    return items.slice(0, ROW_SIZE);
  });
}

function loadCartoons() {
  var curated = searchArchive("collection:classic_cartoons",
    { rows: 30, sort: "downloads desc", type: "cartoon" }).catch(function () { return { items: [] }; });
  var extra = searchArchive("mediatype:movies AND subject:cartoons",
    { rows: 30, sort: "downloads desc", type: "cartoon" }).catch(function () { return { items: [] }; });
  return Promise.all([curated, extra]).then(function (res) {
    var seen = {};
    var items = [];
    res[0].items.forEach(function (it) {
      if (!seen[it.id]) { seen[it.id] = true; items.push(it); }
    });
    res[1].items.forEach(function (it) {
      if (!seen[it.id] && !isYoutubeRip(it.id)) { seen[it.id] = true; items.push(it); }
    });
    return items.slice(0, ROW_SIZE);
  });
}

/* Top IMDb: real IMDb ratings only with a user key. Without one, Archive
   ratings are shown and labeled as Archive ratings, never as IMDb. */
function loadTopImdb() {
  return searchArchive(MOVIES, { rows: 40, sort: "avg_rating desc", type: "movie" })
    .then(function (res) {
      var items = res.items.filter(function (it) { return it.rating != null && it.year != null; })
        .sort(function (a, b) { return (b.rating - a.rating) || (b.downloads - a.downloads); })
        .slice(0, 18);
      if (!state.omdbKey) return { items: items, imdb: false };
      var jobs = items.slice(0, 12).map(function (it) {
        return omdbRating(it.title, it.year).then(function (r) {
          if (r) it.imdbRating = r.rating;
          return it;
        });
      });
      return Promise.all(jobs).then(function (done) {
        var rated = done.filter(function (it) { return it.imdbRating != null; })
          .sort(function (a, b) { return b.imdbRating - a.imdbRating; });
        var rest = items.filter(function (it) { return it.imdbRating == null; });
        return { items: rated.concat(rest).slice(0, ROW_SIZE), imdb: rated.length > 0 };
      });
    });
}

/* ---------- Home ---------- */

var homeLoaded = false;

function heroPick(items) {
  if (!items.length) return null;
  var day = Math.floor(Date.now() / 86400000);
  return items[day % Math.min(items.length, 5)];
}

function renderHero(item) {
  var hero = document.getElementById("hero");
  if (!item) {
    hero.innerHTML = '<div class="hero-content"><p class="hero-kicker">ARCHIVEFLIX</p>' +
      "<h2>Free movies, shows and cartoons</h2>" +
      '<p class="hero-desc">The catalog could not load. Check your connection, then reload the page.</p></div>';
    return;
  }
  hero.innerHTML =
    '<img class="hero-img" src="' + posterUrl(item.id) + '" alt="" onerror="this.style.display=\'none\'">' +
    '<div class="hero-content"><p class="hero-kicker">Featured film</p>' +
    "<h2>" + esc(item.title) + "</h2>" +
    '<p class="hero-meta">' + esc([item.year ? String(item.year) : "", typeLabel(item.type),
      item.creator ? "Directed by " + item.creator : "", starText(item.rating)].filter(Boolean).join(" · ")) + "</p>" +
    (item.description ? descHtml(item.description, "hero-desc") : "") +
    '<div class="hero-actions">' +
    '<button class="btn btn-primary" id="heroPlay">Play</button>' +
    '<button class="btn" id="heroDetails">More Info</button>' +
    "</div></div>";
  var heroImg = hero.querySelector(".hero-img");
  if (heroImg) upgradePoster(heroImg, item);
  document.getElementById("heroPlay").addEventListener("click", function () { openPlayer(item); });
  document.getElementById("heroDetails").addEventListener("click", function () { openDetails(item); });
  wireExpandableDescs(hero);
}

function continueWatchingItems() {
  return Object.keys(state.history).map(function (id) { return state.history[id]; })
    .filter(function (h) { return h.progress > 0 && h.progress < 1; })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; })
    .map(function (h) {
      return { id: h.id, title: h.title, year: h.year, type: h.type,
        subjects: h.subjects || [], rating: null, downloads: 0 };
    });
}

function watchAgainItems() {
  return Object.keys(state.history).map(function (id) { return state.history[id]; })
    .filter(function (h) { return h.progress >= 1; })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; })
    .map(function (h) {
      return { id: h.id, title: h.title, year: h.year, type: h.type,
        subjects: h.subjects || [], rating: null, downloads: 0 };
    });
}

function topSignalSubjects() {
  var counts = {};
  Object.keys(state.history).forEach(function (id) {
    var h = state.history[id];
    if (h.progress < 1) return;
    (h.subjects || []).forEach(function (s) {
      var k = s.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
  });
  Object.keys(state.reactions).forEach(function (id) {
    var r = state.reactions[id];
    if (r.value !== 1) return;
    (r.subjects || []).forEach(function (s) {
      var k = s.toLowerCase();
      counts[k] = (counts[k] || 0) + 2;
    });
  });
  var stop = ["movies", "feature films", "feature film", "movingimage", "video",
    "pre-code", "public domain", "classic", "vhs", "dvd", "colorized"];
  return Object.keys(counts)
    .filter(function (k) { return stop.indexOf(k) === -1 && k.length > 2 && k.length < 40; })
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, 2);
}

function renderPersonalShelves(container) {
  var cw = continueWatchingItems();
  if (cw.length) {
    var s1 = rowEl("Continue Watching", "Pick up where you left off");
    s1.classList.add("personal-shelf");
    container.appendChild(s1);
    fillRow(s1, cw);
  }
  var wa = watchAgainItems();
  if (wa.length) {
    var s2 = rowEl("Watch Again", "Finished titles, ready for another round");
    s2.classList.add("personal-shelf");
    container.appendChild(s2);
    fillRow(s2, wa);
  }
  var subjects = topSignalSubjects();
  subjects.forEach(function (subj) {
    var label = subj.charAt(0).toUpperCase() + subj.slice(1);
    var s3 = rowEl("Because you watched " + label, "Picked from what you finished and liked");
    s3.classList.add("personal-shelf");
    container.appendChild(s3);
    var scroll = s3.querySelector(".row-scroll");
    scroll.innerHTML = '<div class="skeleton-row"><div class="skeleton-card"></div>' +
      '<div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    searchArchive(MOVIES + ' AND subject:"' + subj.replace(/"/g, "") + '"',
      { rows: 30, sort: "downloads desc", type: "movie" })
      .then(function (res) {
        var items = filterVisible(res.items).filter(function (it) {
          return reactionOf(it.id) !== -1;
        }).slice(0, ROW_SIZE);
        if (!items.length) { s3.remove(); return; }
        fillRow(s3, items);
      }).catch(function () { s3.remove(); });
  });
}

function loadHome() {
  var container = document.getElementById("homeRows");
  container.innerHTML = "";
  renderPersonalShelves(container);
  var heroDone = false;

  ROW_DEFS.forEach(function (def) {
    var subtitle = def.subtitle || "";
    if (def.id === "imdb" && !state.omdbKey) {
      subtitle = "Archive ratings shown. Add a free OMDb key in Settings for real IMDb ratings.";
    }
    var section = rowEl(def.title, subtitle);
    container.appendChild(section);
    var scroll = section.querySelector(".row-scroll");
    scroll.innerHTML = '<div class="skeleton-row"><div class="skeleton-card"></div>' +
      '<div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    var load = function () {
      loadRow(def).then(function (result) {
        var items = result.items || result;
        if (def.id === "imdb" && result.imdb) {
          var sub = section.querySelector(".row-sub");
          if (sub) sub.textContent = "Sorted by real IMDb ratings from your OMDb key.";
        }
        items = filterVisible(items).filter(function (it) { return reactionOf(it.id) !== -1; });
        if (!heroDone && def.id === "trending" && items.length) {
          heroDone = true;
          renderHero(heroPick(items));
        }
        fillRow(section, items, "Nothing found here right now.");
      }).catch(function () {
        if (def.id === "trending" && !heroDone) { heroDone = true; renderHero(null); }
        rowError(section, load);
      });
    };
    load();
  });
  homeLoaded = true;
}

/* Re-render just the personal shelves (Continue Watching, Watch Again,
   Because You Watched) without touching the catalog rows. Used after
   closing the player, so Continue Watching shows the latest place. */
function refreshHomePersonal() {
  var container = document.getElementById("homeRows");
  if (!container || !homeLoaded) return;
  var old = container.querySelectorAll(".personal-shelf");
  Array.prototype.forEach.call(old, function (s) { s.remove(); });
  var temp = document.createElement("div");
  renderPersonalShelves(temp);
  var ref = container.firstChild;
  while (temp.firstChild) container.insertBefore(temp.firstChild, ref);
}

/* Re-scan the catalog from archive.org and show Home. This is one of
   the only times the app reloads the catalog on its own: after a
   title finishes, or on pull-to-refresh. It never runs while you are
   watching, searching or browsing. */
function rescanCatalog() {
  searchCache = {};
  homeLoaded = false;
  showView("home");
}

/* ---------- Browse ---------- */

var browseState = { query: "", type: "all", genre: "", sub: "", decade: "",
  year: "", yearFrom: "", yearTo: "",
  minRating: 0, sort: "trending", start: 0, total: 0, loading: false };
var searchTimer = null;

var YEAR_MIN = 1890;
var YEAR_MAX = 2026;

function isYear(v) {
  return /^\d{4}$/.test(String(v || "")) &&
    Number(v) >= YEAR_MIN && Number(v) <= YEAR_MAX;
}

/* Builds the Archive query from a browse state object, so the node smoke
   test can drive it without a DOM. Year, range and decade are all ANDed
   in; a year outside its decade simply matches nothing, and Browse shows
   the honest empty state. */
function buildBrowseQuery(s) {
  var parts = [];
  var t = s.type;
  if (t === "movie") parts.push(MOVIES);
  else if (t === "show") parts.push("collection:classic_tv");
  else if (t === "cartoon") parts.push("collection:classic_cartoons");
  else parts.push("(collection:feature_films OR collection:classic_tv OR collection:classic_cartoons)");
  if (s.genre && GENRES[s.genre]) {
    parts.push("subject:" + GENRES[s.genre].subject);
  }
  if (s.sub) {
    parts.push('subject:"' + s.sub.replace(/"/g, "") + '"');
  }
  if (s.decade) {
    var d = s.decade.split("-");
    parts.push("year:[" + d[0] + " TO " + d[1] + "]");
  }
  if (s.year && isYear(s.year)) {
    parts.push("year:" + s.year);
  } else if (s.yearFrom || s.yearTo) {
    var from = isYear(s.yearFrom) ? s.yearFrom : String(YEAR_MIN);
    var to = isYear(s.yearTo) ? s.yearTo : String(YEAR_MAX);
    parts.push("year:[" + from + " TO " + to + "]");
  }
  if (s.query) {
    var terms = s.query.replace(/["()]/g, " ").trim().split(/\s+/).join(" ");
    if (terms) parts.push("title:(" + terms + ")");
  }
  return parts.join(" AND ");
}

function browseQuery() {
  return buildBrowseQuery(browseState);
}

function browseSortParam() {
  if (browseState.sort === "trending") return "downloads desc";
  if (browseState.sort === "rated") return "avg_rating desc";
  if (browseState.sort === "newest") return "addeddate desc";
  return "downloads desc";
}

function sortClientSide(items) {
  var s = browseState.sort;
  var copy = items.slice();
  if (s === "az") copy.sort(function (a, b) { return a.title.localeCompare(b.title); });
  else if (s === "year-desc") copy.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
  else if (s === "year-asc") copy.sort(function (a, b) { return (a.year || 9999) - (b.year || 9999); });
  else if (s === "rated") copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
  return copy;
}

function renderSubChips() {
  var wrap = document.getElementById("subGenreChips");
  wrap.innerHTML = "";
  var g = GENRES[browseState.genre];
  if (!g) return;
  var all = document.createElement("button");
  all.className = "chip" + (browseState.sub === "" ? " active" : "");
  all.textContent = "All " + g.label;
  all.addEventListener("click", function () { browseState.sub = ""; runBrowse(true); });
  wrap.appendChild(all);
  g.subs.forEach(function (pair) {
    var chip = document.createElement("button");
    chip.className = "chip" + (browseState.sub === pair[0] ? " active" : "");
    chip.textContent = pair[1];
    chip.addEventListener("click", function () {
      browseState.sub = (browseState.sub === pair[0]) ? "" : pair[0];
      runBrowse(true);
    });
    wrap.appendChild(chip);
  });
}

function runBrowse(reset) {
  if (browseState.loading) return;
  browseState.loading = true;
  if (reset) { browseState.start = 0; document.getElementById("browseGrid").innerHTML = ""; }
  renderSubChips();
  document.getElementById("browseCount").textContent = "Searching archive.org...";
  var isClientSort = ["az", "year-desc", "year-asc"].indexOf(browseState.sort) !== -1;
  searchArchive(browseQuery(), {
    rows: isClientSort ? 100 : 48,
    start: isClientSort ? 0 : browseState.start,
    sort: browseSortParam()
  }).then(function (res) {
    browseState.loading = false;
    browseState.total = res.total;
    var items = res.items;
    if (browseState.type === "cartoon") {
      items = items.filter(function (it) { return !isYoutubeRip(it.id); });
    }
    if (browseState.minRating > 0) {
      items = items.filter(function (it) { return it.rating != null && it.rating >= browseState.minRating; });
    }
    items = filterVisible(items).filter(function (it) { return reactionOf(it.id) !== -1; });
    items = sortClientSide(items);
    var grid = document.getElementById("browseGrid");
    if (!items.length && browseState.start === 0) {
      grid.innerHTML = '<div class="empty-state">Nothing matched those filters. ' +
        "Try a different genre, decade, year or search term.</div>";
    } else {
      items.forEach(function (it) { grid.appendChild(cardEl(it)); });
    }
    browseState.start += res.items.length;
    var shown = grid.querySelectorAll(".card").length;
    document.getElementById("browseCount").textContent =
      res.total + " titles found. Showing " + shown + ".";
    document.getElementById("loadMoreBtn").style.display =
      (isClientSort || browseState.start >= res.total) ? "none" : "inline-block";
  }).catch(function () {
    browseState.loading = false;
    document.getElementById("browseCount").textContent = "";
    var grid = document.getElementById("browseGrid");
    if (browseState.start === 0) {
      grid.innerHTML = '<div class="empty-state">Could not reach archive.org. ' +
        "Check your connection and try again.</div>";
    }
  });
}

/* ---------- Details sheet ---------- */

var currentDetails = null;

function openDetails(item) {
  currentDetails = item;
  var body = document.getElementById("detailsBody");
  body.innerHTML = "<p>Loading details from archive.org...</p>";
  document.getElementById("detailsSheet").hidden = false;
  document.body.style.overflow = "hidden";

  getMetadata(item.id).then(function (meta) {
    var m = meta.metadata || {};
    var files = meta.files || [];
    var dl = pickDownloadFile(files);
    var runtime = "";
    if (dl && dl.length) runtime = formatRuntime(dl.length);
    if (!runtime) {
      var withLen = files.filter(function (f) { return f.length; })[0];
      if (withLen) runtime = formatRuntime(withLen.length);
    }
    var subjects = [];
    toArray(m.subject).forEach(function (s) {
      String(s).split(";").forEach(function (part) {
        part = part.trim();
        if (part) subjects.push(part);
      });
    });
    var desc = cleanText(toArray(m.description)[0] || item.description);
    var year = m.date ? String(m.date).slice(0, 4) : (item.year ? String(item.year) : "");
    var creator = toArray(m.creator)[0] ? String(toArray(m.creator)[0]) : item.creator;
    var h = state.history[item.id];
    var progress = h ? h.progress : 0;
    var inList = inMyList(item.id);
    var reaction = reactionOf(item.id);
    var badge = ratingBadge(item);
    var fullItem = {
      id: item.id, title: item.title, year: item.year, type: item.type,
      subjects: subjects.length ? subjects : (item.subjects || []),
      rating: item.rating, downloads: item.downloads
    };

    body.innerHTML =
      '<div class="details-top">' +
      '<img class="details-poster" src="' + posterUrl(item.id) + '" alt="" onerror="this.style.display=\'none\'">' +
      '<div class="details-info"><h2>' + esc(item.title) + "</h2>" +
      '<p class="details-meta">' + esc([year, typeLabel(item.type),
        creator ? "By " + creator : "", runtime,
        badge, h ? "Watched " + h.watchCount + " time" + (h.watchCount === 1 ? "" : "s") : ""]
        .filter(Boolean).join(" · ")) + "</p>" +
      (desc ? descHtml(desc, "details-desc") : '<p class="details-desc">No synopsis on the Archive for this one.</p>') +
      (subjects.length ? '<div class="tag-row">' +
        subjects.slice(0, 8).map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("") +
        "</div>" : "") +
      '<div class="details-actions">' +
      '<button class="btn btn-primary" id="dPlay">' +
      (progress >= 1 ? "Watch Again" : (progress > 0 ? "Resume" : "Play")) + "</button>" +
      '<button class="btn" id="dDownload">Download' + (dl ? " (" + formatSize(dl.size) + ")" : "") + "</button>" +
      '<button class="btn" id="dList">' + (inList ? "Remove from My List" : "Add to My List") + "</button>" +
      '<button class="btn" id="dLike">' + (reaction === 1 ? "Liked" : "Like") + "</button>" +
      '<button class="btn" id="dNope">' + (reaction === -1 ? "Not for me" : "Not for me") + "</button>" +
      "</div>" +
      '<div class="place-row"><p class="sub">' + esc(placeText(h)) +
      " Your place is saved automatically as you watch.</p></div>" +
      "</div></div>" +
      '<h3 class="similar-head">More Like This</h3><div class="row-scroll" id="similarRow"></div>';

    var detImg = body.querySelector(".details-poster");
    if (detImg) upgradePoster(detImg, item);
    document.getElementById("dPlay").addEventListener("click", function () { openPlayer(fullItem); });
    document.getElementById("dDownload").addEventListener("click", function () {
      var url = dl ? downloadUrl(item.id, dl.name) : detailsUrl(item.id);
      window.open(url, "_blank");
      toast(dl ? "Download started from archive.org" : "No video file found, opened the Archive page instead");
    });
    document.getElementById("dList").addEventListener("click", function () {
      toggleMyList(fullItem);
      openDetails(item);
    });
    document.getElementById("dLike").addEventListener("click", function () {
      setReaction(fullItem, 1);
      openDetails(item);
    });
    document.getElementById("dNope").addEventListener("click", function () {
      setReaction(fullItem, -1);
      openDetails(item);
    });
    wireExpandableDescs(body);

    var similarRow = document.getElementById("similarRow");
    var topSub = subjects[0];
    if (topSub) {
      searchArchive(MOVIES + ' AND subject:"' + topSub.replace(/"/g, "") + '"',
        { rows: 20, sort: "downloads desc", type: "movie" })
        .then(function (res) {
          var sims = filterVisible(res.items).filter(function (it) {
            return it.id !== item.id && reactionOf(it.id) !== -1;
          }).slice(0, 12);
          if (!sims.length) {
            similarRow.innerHTML = '<p class="row-error">No close matches found.</p>';
            return;
          }
          sims.forEach(function (it) { similarRow.appendChild(cardEl(it)); });
        }).catch(function () {
          similarRow.innerHTML = '<p class="row-error">Could not load similar titles.</p>';
        });
    } else {
      similarRow.innerHTML = '<p class="row-error">No subject tags to match on.</p>';
    }
  }).catch(function () {
    body.innerHTML = "<p>Could not load details for this title. " +
      'You can still open it on the Archive: <a href="' + detailsUrl(item.id) +
      '" target="_blank" rel="noopener">archive.org/details/' + esc(item.id) + "</a>.</p>";
  });
}

function closeDetails() {
  document.getElementById("detailsSheet").hidden = true;
  document.body.style.overflow = "";
  currentDetails = null;
}

/* ---------- Player sheet ---------- */

var currentPlayer = null;
var currentVideo = null;
var playerMode = "";
var finishHandled = false;
var lastSavedAt = 0;
var lastSavedPos = -1;

/* Save the video element's real position right now. */
function saveVideoPosition() {
  if (!currentPlayer || !currentVideo) return;
  var dur = Number(currentVideo.duration) || 0;
  var pos = Number(currentVideo.currentTime) || 0;
  if (!dur) return;
  recordProgress(currentPlayer, Math.min(1, pos / dur), pos, dur);
  updatePlayerPlace();
}

/* Same, but at most once every 5 seconds while playing. */
function saveVideoPositionThrottled() {
  if (!currentVideo) return;
  var now = Date.now();
  var pos = Number(currentVideo.currentTime) || 0;
  if (now - lastSavedAt < 5000 && Math.abs(pos - lastSavedPos) < 5) return;
  lastSavedAt = now;
  lastSavedPos = pos;
  saveVideoPosition();
}

function updatePlayerPlace() {
  var el = document.getElementById("playerPlace");
  var h = currentPlayer && state.history[currentPlayer.id];
  if (!h || h.progress <= 0) {
    el.textContent = "Not started yet.";
    return;
  }
  if (h.progress >= 1) {
    el.textContent = "Finished.";
    return;
  }
  if (h.position > 0 && h.duration > 0) {
    el.textContent = "Your place: " + formatTime(h.position) + " of " +
      formatTime(h.duration) + " (" + Math.round(h.progress * 100) +
      "%). Saved automatically.";
    return;
  }
  el.textContent = "Your place: " + Math.round(h.progress * 100) + "%. Saved automatically.";
}

/* Show the right note and controls for the player mode. The manual
   percent buttons only ever appear in embed fallback mode. */
function setPlayerMode(mode) {
  playerMode = mode;
  document.getElementById("playerNoteVideo").hidden = mode !== "video";
  document.getElementById("playerNoteEmbed").hidden = mode !== "embed";
  document.getElementById("playerManualBtns").hidden = mode !== "embed";
  document.getElementById("playerRestartBtn").hidden = mode !== "video";
}

function openPlayer(item) {
  currentPlayer = item;
  currentVideo = null;
  finishHandled = false;
  lastSavedAt = 0;
  lastSavedPos = -1;
  document.getElementById("playerTitle").textContent = item.title +
    (item.year ? " (" + item.year + ")" : "");
  document.getElementById("playerFrame").innerHTML =
    '<p class="player-loading">Finding a playable file on archive.org...</p>';
  document.getElementById("playerSheet").hidden = false;
  document.body.style.overflow = "hidden";
  setPlayerMode("loading");
  updatePlayerPlace();
  getMetadata(item.id).then(function (meta) {
    if (!currentPlayer || currentPlayer.id !== item.id) return;
    var file = pickPlayableFile(meta.files || []);
    if (file) startNativePlayer(item, file);
    else startEmbedPlayer(item);
  }).catch(function () {
    if (!currentPlayer || currentPlayer.id !== item.id) return;
    startEmbedPlayer(item);
  });
}

function startNativePlayer(item, file) {
  var frame = document.getElementById("playerFrame");
  var video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.className = "player-video";
  video.src = downloadUrl(item.id, file.name);
  frame.innerHTML = "";
  frame.appendChild(video);
  currentVideo = video;
  setPlayerMode("video");
  var saved = state.history[item.id];
  var resumed = false;
  video.addEventListener("loadedmetadata", function () {
    if (resumed) return;
    resumed = true;
    var at = resumeSeconds(saved, video.duration);
    if (at > 0) {
      try { video.currentTime = at; } catch (e) { /* seek failed, plays from the start */ }
      toast("Resuming from " + formatTime(at));
    }
  });
  video.addEventListener("timeupdate", saveVideoPositionThrottled);
  video.addEventListener("pause", saveVideoPosition);
  video.addEventListener("ended", function () { finishTitle(item); });
  video.addEventListener("error", function () {
    if (currentPlayer && currentPlayer.id === item.id) startEmbedPlayer(item);
  });
  var playPromise = null;
  try { playPromise = video.play(); } catch (e) { playPromise = null; }
  if (playPromise && playPromise.catch) {
    playPromise.catch(function () { /* autoplay blocked, press play */ });
  }
}

function startEmbedPlayer(item) {
  currentVideo = null;
  var frame = document.getElementById("playerFrame");
  frame.innerHTML =
    '<iframe src="' + embedUrl(item.id) + '" allowfullscreen allow="fullscreen"></iframe>';
  setPlayerMode("embed");
}

/* The film ended. Mark it finished, stop everything, re-scan the
   catalog and go back to Home. */
function finishTitle(item) {
  if (finishHandled) return;
  finishHandled = true;
  var dur = currentVideo && Number(currentVideo.duration)
    ? Math.round(Number(currentVideo.duration)) : 0;
  recordProgress(item, 1, 0, dur);
  toast("Finished. Back to Home.");
  stopPlayback();
  document.getElementById("playerSheet").hidden = true;
  document.body.style.overflow = "";
  currentPlayer = null;
  playerMode = "";
  /* An update that arrived mid-film reloads now, and the fresh page
     loads the catalog itself, so there is no need to re-scan first. */
  if (reloadForUpdateIfPending()) return;
  refreshPersonalViews();
  rescanCatalog();
}

function stopPlayback() {
  if (currentVideo) {
    try { currentVideo.pause(); } catch (e) { /* already stopped */ }
    try { currentVideo.removeAttribute("src"); currentVideo.load(); } catch (e) { /* ignore */ }
    currentVideo = null;
  }
  document.getElementById("playerFrame").innerHTML = "";
}

function closePlayer() {
  saveVideoPosition();
  stopPlayback();
  document.getElementById("playerSheet").hidden = true;
  document.body.style.overflow = "";
  currentPlayer = null;
  playerMode = "";
  refreshPersonalViews();
  refreshHomePersonal();
  reloadForUpdateIfPending();
}

/* ---------- My List and History views ---------- */

function renderMyList() {
  var grid = document.getElementById("myListGrid");
  grid.innerHTML = "";
  var items = filterVisible(state.myList.map(function (m) {
    return { id: m.id, title: m.title, year: m.year, type: m.type,
      subjects: [], rating: null, downloads: 0 };
  }));
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state">' +
      (state.myList.length
        ? "Your saved titles are all finished and hidden by Hide watched. Turn it off to see them here."
        : "Nothing saved yet. Open any title and tap Add to My List.") + "</div>";
    return;
  }
  items.forEach(function (it) { grid.appendChild(cardEl(it)); });
}

function renderHistory() {
  var list = document.getElementById("historyList");
  list.innerHTML = "";
  var entries = Object.keys(state.history).map(function (id) { return state.history[id]; })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; });
  if (!entries.length) {
    list.innerHTML = '<div class="empty-state">No history yet. Play something and it shows up here.</div>';
    return;
  }
  entries.forEach(function (h) {
    var item = { id: h.id, title: h.title, year: h.year, type: h.type, subjects: h.subjects || [] };
    var div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML =
      '<img class="history-thumb" src="' + posterUrl(h.id) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
      '<div class="history-main"><div class="card-title">' + esc(h.title) + "</div>" +
      '<div class="card-meta">' + esc([h.year ? String(h.year) : "", typeLabel(h.type),
        formatDate(h.lastWatchedAt), h.watchCount ? "Watched " + h.watchCount + " time" + (h.watchCount === 1 ? "" : "s") : ""]
        .filter(Boolean).join(" · ")) + "</div>" +
      '<div class="progress-track"><div class="progress-fill" style="width:' + Math.round(h.progress * 100) + '%"></div></div>' +
      '<div class="card-meta">' + esc(placeText(h).replace(/\.$/, "")) + "</div></div>" +
      '<div class="history-btns">' +
      '<button class="btn small btn-primary" data-act="play">' + (h.progress >= 1 ? "Watch Again" : "Resume") + "</button>" +
      '<button class="btn small" data-act="details">Details</button>' +
      '<button class="btn small btn-ghost" data-act="remove">Remove</button></div>';
    div.querySelector('[data-act="play"]').addEventListener("click", function () { openPlayer(item); });
    div.querySelector('[data-act="details"]').addEventListener("click", function () { openDetails(item); });
    div.querySelector('[data-act="remove"]').addEventListener("click", function () {
      delete state.history[h.id];
      saveState();
      renderHistory();
      toast("Removed from history");
    });
    list.appendChild(div);
  });
}

function refreshPersonalViews() {
  renderMyList();
  renderHistory();
}

/* ---------- Themes ---------- */

/* Text color for a custom accent: dark text on light accents (gold),
   white text on dark ones, so buttons stay readable either way. */
function accentTextFor(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  var n = parseInt(m[1], 16);
  var lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) +
             0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "#1c1300" : "#ffffff";
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme || "flix");
  if (state.customAccent) {
    document.documentElement.style.setProperty("--accent", state.customAccent);
    document.documentElement.style.setProperty("--accent-text", accentTextFor(state.customAccent));
  } else {
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-text");
  }
  document.querySelectorAll(".theme-btn").forEach(function (b) {
    b.classList.toggle("active", b.dataset.theme === state.theme);
  });
  var picker = document.getElementById("accentPicker");
  if (picker && state.customAccent) picker.value = state.customAccent;
}

function renderThemePresets() {
  var wrap = document.getElementById("themePresets");
  wrap.innerHTML = "";
  THEMES.forEach(function (t) {
    var b = document.createElement("button");
    b.className = "theme-btn" + (state.theme === t.id ? " active" : "");
    b.dataset.theme = t.id;
    b.innerHTML = esc(t.name) + '<span class="theme-swatches">' +
      t.colors.map(function (c) {
        return '<span class="swatch" style="background:' + esc(c) + '"></span>';
      }).join("") + "</span>";
    b.addEventListener("click", function () {
      state.theme = t.id;
      saveState();
      applyTheme();
      toast(t.name + " theme applied");
    });
    wrap.appendChild(b);
  });
}

/* ---------- Navigation ---------- */

function showView(name) {
  document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
  document.getElementById(name + "View").classList.add("active");
  document.querySelectorAll(".navbtn").forEach(function (b) {
    b.classList.toggle("active", b.dataset.view === name);
  });
  window.scrollTo(0, 0);
  if (name === "home" && !homeLoaded) loadHome();
  if (name === "home") wireExpandableDescs(document.getElementById("hero"));
  if (name === "browse" && document.getElementById("browseGrid").children.length === 0) runBrowse(true);
  if (name === "mylist") renderMyList();
  if (name === "history") renderHistory();
  if (name === "settings") renderThemePresets();
}

/* ---------- Pull to refresh (Home only) ---------- */

/* Drag down from the very top of Home, release past the threshold,
   and the catalog re-scans. This is the only gesture that reloads
   the catalog. It does nothing while a sheet is open, while you are
   scrolled down, or on any view but Home. */
function initPullToRefresh() {
  var indicator = document.getElementById("ptrIndicator");
  var startY = 0;
  var pulling = false;
  var THRESHOLD = 90;
  document.addEventListener("touchstart", function (e) {
    if (!document.getElementById("homeView").classList.contains("active")) return;
    if (!document.getElementById("playerSheet").hidden) return;
    if (!document.getElementById("detailsSheet").hidden) return;
    if (window.scrollY > 0) return;
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!pulling) return;
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      indicator.classList.remove("visible", "ready");
      return;
    }
    if (dy > 10) indicator.classList.add("visible");
    var ready = dy >= THRESHOLD;
    indicator.classList.toggle("ready", ready);
    indicator.textContent = ready ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });
  document.addEventListener("touchend", function () {
    if (!pulling) return;
    pulling = false;
    var ready = indicator.classList.contains("ready");
    indicator.classList.remove("visible", "ready");
    if (ready) {
      toast("Refreshing the catalog...");
      rescanCatalog();
    }
  });
}

/* ---------- Installable app (PWA) ---------- */

var deferredInstallPrompt = null;

/* An updated service worker takes control of the page, but the page
   itself keeps showing the old shell until it reloads, so an update
   would sit invisible until the next manual reload. Watch for the
   new worker and reload once so an update appears on its own.
   Never reload while the player is open: the reload waits until the
   player closes instead. */
var updateReloadDone = false;
var pendingUpdateReload = false;
var swHadControllerAtLoad = false;

function isPlayerOpen() {
  return !!currentPlayer;
}

/* Reload once for a pending update, after the player has closed.
   Returns true when a reload was started. */
function reloadForUpdateIfPending() {
  if (!pendingUpdateReload || updateReloadDone) return false;
  pendingUpdateReload = false;
  updateReloadDone = true;
  window.location.reload();
  return true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1") return;
  /* A page loading with no controller is a first install: the
     controllerchange that follows is the first worker taking over,
     not an update, so it must not reload. Remember the page now has
     a controller, so a later update in this same session still
     reloads. */
  swHadControllerAtLoad = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!swHadControllerAtLoad) {
      swHadControllerAtLoad = true;
      return;
    }
    if (updateReloadDone) return;
    if (isPlayerOpen()) {
      pendingUpdateReload = true;
      return;
    }
    updateReloadDone = true;
    window.location.reload();
  });
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {
      /* Offline support unavailable, the app still works. */
    });
  });
}

function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    var btn = document.getElementById("installBtn");
    if (btn) btn.hidden = false;
  });
  var btn = document.getElementById("installBtn");
  if (btn) {
    btn.addEventListener("click", function () {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function () {
        deferredInstallPrompt = null;
        btn.hidden = true;
      }).catch(function () { /* prompt dismissed */ });
    });
  }
}

/* ---------- Init ---------- */

function syncHideWatchedBoxes() {
  document.getElementById("hideWatchedTop").checked = state.hideWatched;
  document.getElementById("hideWatchedBrowse").checked = state.hideWatched;
}

function onHideWatchedChange(checked) {
  state.hideWatched = checked;
  saveState();
  syncHideWatchedBoxes();
  if (homeLoaded) loadHome();
  if (document.getElementById("browseView").classList.contains("active")) runBrowse(true);
  renderMyList();
}

/* Fill the Year, From year and To year selects, newest first. A single
   year and a range never apply together: picking one clears the other,
   so the query always means what the bar shows. */
function populateYearSelects() {
  ["filterYear", "filterYearFrom", "filterYearTo"].forEach(function (id) {
    var sel = document.getElementById(id);
    for (var y = YEAR_MAX; y >= YEAR_MIN; y--) {
      var opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      sel.appendChild(opt);
    }
  });
}

function init() {
  applyTheme();
  renderThemePresets();
  populateYearSelects();
  syncHideWatchedBoxes();
  initPullToRefresh();
  registerServiceWorker();
  initInstallPrompt();

  /* Save your place if the app is hidden or closed mid-film. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) saveVideoPosition();
  });
  window.addEventListener("pagehide", saveVideoPosition);
  window.addEventListener("offline", function () {
    toast("You are offline. Saved pages still open, the catalog needs internet.");
  });
  window.addEventListener("online", function () {
    toast("Back online.");
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { wireExpandableDescs(document); }, 200);
  });

  document.querySelectorAll(".navbtn").forEach(function (b) {
    b.addEventListener("click", function () { showView(b.dataset.view); });
  });
  document.getElementById("homeBtn").addEventListener("click", function () { showView("home"); });
  document.getElementById("settingsBtn").addEventListener("click", function () { showView("settings"); });

  document.getElementById("hideWatchedTop").addEventListener("change", function (e) {
    onHideWatchedChange(e.target.checked);
  });
  document.getElementById("hideWatchedBrowse").addEventListener("change", function (e) {
    onHideWatchedChange(e.target.checked);
  });

  document.getElementById("searchInput").addEventListener("input", function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      browseState.query = e.target.value.trim();
      runBrowse(true);
    }, 450);
  });
  document.getElementById("filterType").addEventListener("change", function (e) {
    browseState.type = e.target.value;
    runBrowse(true);
  });
  document.getElementById("filterGenre").addEventListener("change", function (e) {
    browseState.genre = e.target.value;
    browseState.sub = "";
    runBrowse(true);
  });
  document.getElementById("filterDecade").addEventListener("change", function (e) {
    browseState.decade = e.target.value;
    runBrowse(true);
  });
  document.getElementById("filterYear").addEventListener("change", function (e) {
    browseState.year = e.target.value;
    if (browseState.year) {
      browseState.yearFrom = "";
      browseState.yearTo = "";
      document.getElementById("filterYearFrom").value = "";
      document.getElementById("filterYearTo").value = "";
    }
    runBrowse(true);
  });
  document.getElementById("filterYearFrom").addEventListener("change", function (e) {
    browseState.yearFrom = e.target.value;
    browseState.year = "";
    document.getElementById("filterYear").value = "";
    if (browseState.yearFrom && browseState.yearTo &&
        Number(browseState.yearFrom) > Number(browseState.yearTo)) {
      browseState.yearTo = browseState.yearFrom;
      document.getElementById("filterYearTo").value = browseState.yearTo;
    }
    runBrowse(true);
  });
  document.getElementById("filterYearTo").addEventListener("change", function (e) {
    browseState.yearTo = e.target.value;
    browseState.year = "";
    document.getElementById("filterYear").value = "";
    if (browseState.yearFrom && browseState.yearTo &&
        Number(browseState.yearTo) < Number(browseState.yearFrom)) {
      browseState.yearFrom = browseState.yearTo;
      document.getElementById("filterYearFrom").value = browseState.yearFrom;
    }
    runBrowse(true);
  });
  document.getElementById("filterRating").addEventListener("change", function (e) {
    browseState.minRating = Number(e.target.value);
    runBrowse(true);
  });
  document.getElementById("filterSort").addEventListener("change", function (e) {
    browseState.sort = e.target.value;
    runBrowse(true);
  });
  document.getElementById("loadMoreBtn").addEventListener("click", function () { runBrowse(false); });
  document.getElementById("clearFilters").addEventListener("click", function () {
    browseState.query = "";
    browseState.type = "all";
    browseState.genre = "";
    browseState.sub = "";
    browseState.decade = "";
    browseState.year = "";
    browseState.yearFrom = "";
    browseState.yearTo = "";
    browseState.minRating = 0;
    browseState.sort = "trending";
    document.getElementById("searchInput").value = "";
    document.getElementById("filterType").value = "all";
    document.getElementById("filterGenre").value = "";
    document.getElementById("filterDecade").value = "";
    document.getElementById("filterYear").value = "";
    document.getElementById("filterYearFrom").value = "";
    document.getElementById("filterYearTo").value = "";
    document.getElementById("filterRating").value = "0";
    document.getElementById("filterSort").value = "trending";
    runBrowse(true);
  });

  document.getElementById("clearHistoryBtn").addEventListener("click", function () {
    if (Object.keys(state.history).length === 0) { toast("History is already empty"); return; }
    state.history = {};
    saveState();
    renderHistory();
    if (homeLoaded) loadHome();
    toast("History cleared");
  });

  document.getElementById("detailsClose").addEventListener("click", closeDetails);
  document.getElementById("detailsSheet").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closeDetails();
  });
  document.getElementById("playerClose").addEventListener("click", closePlayer);
  document.getElementById("playerSheet").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closePlayer();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!document.getElementById("playerSheet").hidden) closePlayer();
    else if (!document.getElementById("detailsSheet").hidden) closeDetails();
  });
  /* Manual place buttons. They only show in embed fallback mode, where
     the Archive player cannot report your place. Native playback
     saves your place on its own. */
  document.querySelectorAll(".progress-btns .btn").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!currentPlayer) return;
      var p = Number(b.dataset.progress);
      recordProgress(currentPlayer, p);
      updatePlayerPlace();
      toast(p >= 1 ? "Marked as finished" : "Place saved at " + Math.round(p * 100) + "%");
    });
  });
  document.getElementById("playerRestartBtn").addEventListener("click", function () {
    if (!currentVideo || !currentPlayer) return;
    try { currentVideo.currentTime = 0; } catch (e) { /* seek failed */ }
    recordProgress(currentPlayer, 0, 0, Number(currentVideo.duration) || 0);
    updatePlayerPlace();
    toast("Started from the beginning");
  });

  document.getElementById("accentPicker").addEventListener("input", function (e) {
    state.customAccent = e.target.value;
    saveState();
    applyTheme();
  });
  document.getElementById("accentClear").addEventListener("click", function () {
    state.customAccent = "";
    saveState();
    applyTheme();
    toast("Back to the theme color");
  });

  var keyInput = document.getElementById("omdbKeyInput");
  keyInput.value = state.omdbKey || "";
  keyInput.placeholder = state.omdbKey ? "Key saved" : "Free OMDb API key";
  document.getElementById("omdbSave").addEventListener("click", function () {
    var v = keyInput.value.trim();
    if (!v) { toast("Paste a key first"); return; }
    state.omdbKey = v;
    state.omdbCache = {};
    saveState();
    clearPosterCache();
    keyInput.value = "";
    keyInput.placeholder = "Key saved";
    if (homeLoaded) loadHome();
    toast("Key saved in this browser only");
  });
  document.getElementById("omdbClear").addEventListener("click", function () {
    state.omdbKey = "";
    state.omdbCache = {};
    saveState();
    clearPosterCache();
    keyInput.value = "";
    keyInput.placeholder = "Free OMDb API key";
    if (homeLoaded) loadHome();
    toast("Key removed");
  });

  var tmdbInput = document.getElementById("tmdbKeyInput");
  tmdbInput.value = state.tmdbKey || "";
  tmdbInput.placeholder = state.tmdbKey ? "Key saved" : "Free TMDB API key";
  document.getElementById("tmdbSave").addEventListener("click", function () {
    var v = tmdbInput.value.trim();
    if (!v) { toast("Paste a key first"); return; }
    state.tmdbKey = v;
    saveState();
    clearPosterCache();
    tmdbInput.value = "";
    tmdbInput.placeholder = "Key saved";
    if (homeLoaded) loadHome();
    toast("Key saved in this browser only");
  });
  document.getElementById("tmdbClear").addEventListener("click", function () {
    state.tmdbKey = "";
    saveState();
    clearPosterCache();
    tmdbInput.value = "";
    tmdbInput.placeholder = "Free TMDB API key";
    if (homeLoaded) loadHome();
    toast("Key removed");
  });

  document.getElementById("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "archiveflix-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Backup downloaded");
  });
  document.getElementById("importFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || !data.history) throw new Error("bad file");
        state = data;
        saveState();
        applyTheme();
        renderThemePresets();
        syncHideWatchedBoxes();
        keyInput.value = "";
        keyInput.placeholder = state.omdbKey ? "Key saved" : "Free OMDb API key";
        tmdbInput.value = "";
        tmdbInput.placeholder = state.tmdbKey ? "Key saved" : "Free TMDB API key";
        if (homeLoaded) loadHome();
        refreshPersonalViews();
        toast("Backup imported");
      } catch (err) {
        toast("That file is not an ARCHIVEFLIX backup");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });
  document.getElementById("wipeBtn").addEventListener("click", function () {
    state = defaultState();
    saveState();
    applyTheme();
    renderThemePresets();
    syncHideWatchedBoxes();
    keyInput.value = "";
    keyInput.placeholder = "Free OMDb API key";
    tmdbInput.value = "";
    tmdbInput.placeholder = "Free TMDB API key";
    clearPosterCache();
    if (homeLoaded) loadHome();
    refreshPersonalViews();
    toast("Everything erased from this browser");
  });

  loadHome();
}

/* Only boot in a real browser page that has the app markup. */
if (typeof document !== "undefined" && document.getElementById &&
    document.getElementById("homeView")) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

/* Pure helpers exposed for the node smoke test (no DOM needed). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pickDownloadFile: pickDownloadFile,
    pickPlayableFile: pickPlayableFile,
    resumeSeconds: resumeSeconds,
    formatTime: formatTime,
    placeText: placeText,
    posterUrl: posterUrl,
    embedUrl: embedUrl,
    downloadUrl: downloadUrl,
    detailsUrl: detailsUrl,
    isYoutubeRip: isYoutubeRip,
    isBlocked: isBlocked,
    normalizeDoc: normalizeDoc,
    GENRES: GENRES,
    THEMES: THEMES,
    accentTextFor: accentTextFor,
    cleanSearchTitle: cleanSearchTitle,
    pickArchivePosterFile: pickArchivePosterFile,
    pickCommonsPoster: pickCommonsPoster,
    tmdbPosterUrl: tmdbPosterUrl,
    omdbPoster: omdbPoster,
    tmdbPoster: tmdbPoster,
    archivePoster: archivePoster,
    commonsPoster: commonsPoster,
    resolvePoster: resolvePoster,
    ROW_DEFS: ROW_DEFS,
    searchUrl: searchUrl,
    buildBrowseQuery: buildBrowseQuery,
    defaultState: defaultState,
    filterVisibleWith: function (items, st) {
      var saved = state;
      state = st;
      var out = filterVisible(items);
      state = saved;
      return out;
    },
    /* Update reload guards, for the node smoke test. */
    registerServiceWorker: registerServiceWorker,
    isPlayerOpen: isPlayerOpen,
    reloadForUpdateIfPending: reloadForUpdateIfPending,
    setPlayerForTest: function (p) { currentPlayer = p; }
  };
}

})();
