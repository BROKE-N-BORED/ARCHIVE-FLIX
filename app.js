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
/* The release version, shown in Settings About. Bump with each
   release alongside the service worker cache version. */
var APP_VERSION = "1.6.0";
var STORE_KEY = "archiveflix.v1";
var PROFILES_KEY = "archiveflix.profiles.v1";
var MAX_PROFILES = 5;
var PROFILE_COLORS = ["#f0b429", "#3b82f6", "#22c55e", "#a855f7", "#ef4444"];
/* Fields that belong to one profile. API keys and the OMDb ratings
   cache stay device level, shared across profiles. */
var PROFILE_FIELDS = ["history", "myList", "reactions", "hideWatched", "theme", "customAccent", "adultEnabled", "density"];
var DEVICE_FIELDS = ["omdbKey", "omdbCache", "tmdbKey"];
var ROW_SIZE = 24;
/* History keeps the newest 1000 entries, pruning the oldest
   finished ones first; the OMDb ratings cache keeps the newest
   200 ratings. Both are serialized into local storage on every
   save, so without caps long-term use marches toward the storage
   quota. Declared up here because loadStores prunes during the
   first load, before the functions below run. */
var HISTORY_MAX_ENTRIES = 1000;
var OMDB_CACHE_MAX = 200;

/* Adult 18+ section. The Archive's own subject tags decide what is
   adult. These eight subjects, inside feature_films, are the whole
   18+ catalog: 107 titles, verified live 2026-11-14. One shared
   definition drives both sides: ADULT_QUERY is what the 18+ section
   includes, and ADULT_EXCLUDE (NOT the same query) is what every
   normal catalog query appends, so a title can never be in the
   section and still show up in normal search. "sex comedy" is in
   the set because a second, untagged upload of Madame and Her
   Niece (1969) carried only Sex Comedy tags and would otherwise
   have surfaced in the normal catalog. */
var ADULT_SUBJECTS = ["adult", "erotica", "erotic", "sexploitation",
  "softcore", "nudie", "adults only", "sex comedy"];
var ADULT_QUERY = 'subject:(adult OR erotica OR erotic OR sexploitation OR softcore OR nudie OR "adults only" OR "sex comedy")';
var ADULT_EXCLUDE = "NOT " + ADULT_QUERY;

/* Manual override: titles the Archive's own tags put in the 18+
   section by mistake. Add an identifier here, one per line, when a
   mistagged title is spotted, and it leaves the section and stops
   counting as adult everywhere: History, My List, recommendations
   and the identity gate all consult this list through
   isAdultOverridden. Identifiers verified live against archive.org
   metadata 2026-11-15:
   - youre-never-too-young-1955-comedy-jerry-lewis-dean-martin:
     "You're Never Too Young" (1955), a Jerry Lewis and Dean
     Martin comedy, tagged "Adult as child", which the Archive
     reads as the subject "adult".
   - goliathon-mighty-peking-man-xing-xing-wang-1977: "Goliathon,
     Mighty Peking Man" (1977), a Shaw Brothers giant ape film,
     tagged "Sex Comedy". One upload carries both names. */
var ADULT_OVERRIDE_IDS = [
  "youre-never-too-young-1955-comedy-jerry-lewis-dean-martin",
  "goliathon-mighty-peking-man-xing-xing-wang-1977"
];

function isAdultOverridden(id) {
  return !!id && ADULT_OVERRIDE_IDS.indexOf(String(id)) !== -1;
}

/* Subjects that contain the word "adult" without being adult
   content: adult education is a class, not a film genre. These
   phrases are stripped before matching, so they never classify a
   title as adult. */
var ADULT_EXCEPTION_PHRASES = ["adult education", "adult learning",
  "adult literacy", "adult swim"];

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* One precompiled whole word matcher per adult phrase, and one
   stripper per exception phrase, so matching never rebuilds a
   regular expression per subject. */
var ADULT_SUBJECT_RES = ADULT_SUBJECTS.map(function (phrase) {
  return new RegExp("(^|[^a-z0-9])" + escapeRegExp(phrase) + "([^a-z0-9]|$)");
});
var ADULT_EXCEPTION_RES = ADULT_EXCEPTION_PHRASES.map(function (phrase) {
  return new RegExp(escapeRegExp(phrase), "g");
});

/* True when a lowercased subject contains an adult phrase as whole
   words: "sex comedy" matches "German Sex Comedy", "adult"
   matches the subject "adult" but not "adultery", and "adult
   education" never matches because the exception phrases are
   stripped first. */
function adultSubjectMatches(s) {
  for (var j = 0; j < ADULT_SUBJECT_RES.length; j++) {
    if (ADULT_SUBJECT_RES[j].test(s)) return true;
  }
  return false;
}

/* True when an item (search result, history entry, My List entry)
   is an adult title: its stored flag, or one of its subjects.
   Matching is on whole words and phrases with token boundaries,
   not raw substrings, so "adult education" and "adultery" do not
   count, while compound tags like "German Sex Comedy" still do.
   Titles on the manual override list are never adult, whatever
   their tags or stored flag say. Note the server side cannot be
   fixed the same way: the Archive's own subject search still
   token matches, so an "adult education" title stays out of
   normal search results at the query level. */
function isAdultItem(item) {
  if (!item) return false;
  if (isAdultOverridden(item.id)) return false;
  if (item.adult) return true;
  var subs = item.subjects || [];
  for (var i = 0; i < subs.length; i++) {
    var s = String(subs[i]).toLowerCase();
    for (var e = 0; e < ADULT_EXCEPTION_RES.length; e++) {
      s = s.replace(ADULT_EXCEPTION_RES[e], " ");
    }
    if (adultSubjectMatches(s)) return true;
  }
  return false;
}

/* A history entry is adult when it was recorded as one, or when its
   stored subjects say so. The override list wins over a stored
   flag, so a mistagged title already in history is corrected. */
function isAdultEntry(h) {
  if (!h) return false;
  if (isAdultOverridden(h.id)) return false;
  return !!(h.adult || isAdultItem(h));
}

/* A title reduced to its matchable shape: lowercased words, one
   space between them. Shared by the identity gate and the TMDB
   title check, so both compare titles the same way. */
function normalizeTitleForMatch(title) {
  return String(title || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/* ---------- 18+ identity gate ---------- */
/* An untagged second upload of an adult title carries no adult
   tags, so neither the server exclusion nor the client side subject
   filter can catch it. The gate catches it by identity instead: a
   normal result whose normalized title plus year matches a title
   in the 18+ pool is dropped. The pool is one extra query per
   session (title, year and identifier fields only, 500 rows covers
   the 107 title pool), cached for the session. Override list titles
   are left out of the pool, since they are not adult. */
var ADULT_POOL_ROWS = 500;
var ADULT_POOL_GATE_WAIT_MS = 2000;
var adultPoolSet = null;
var adultPoolPromise = null;

function adultPoolKey(title, year) {
  if (year == null) return null;
  var t = normalizeTitleForMatch(title);
  if (!t) return null;
  return t + "|" + year;
}

function isInAdultPool(title, year) {
  if (!adultPoolSet) return false;
  var k = adultPoolKey(title, year);
  return !!(k && adultPoolSet[k]);
}

function fetchAdultPool() {
  if (adultPoolPromise) return adultPoolPromise;
  var p = new URLSearchParams();
  p.set("q", MOVIES + " AND " + ADULT_QUERY);
  ["identifier", "title", "year"].forEach(function (f) { p.append("fl[]", f); });
  p.set("rows", String(ADULT_POOL_ROWS));
  p.set("output", "json");
  adultPoolPromise = Promise.resolve().then(function () {
    return fetchWithTimeout(API + "?" + p.toString(), FETCH_TIMEOUT_SEARCH_MS);
  })
    .then(function (res) {
      if (!res.ok) throw new Error("Adult pool fetch failed: " + res.status);
      return res.json();
    }).then(function (json) {
      var set = {};
      (((json.response || {}).docs) || []).forEach(function (d) {
        if (isAdultOverridden(d.identifier)) return;
        var k = adultPoolKey(d.title, deriveYear(d));
        if (k) set[k] = true;
      });
      adultPoolSet = set;
      return set;
    }).catch(function () {
      /* A failed pool fetch gates nothing this session rather than
         breaking the catalog: the subject filters still apply. */
      adultPoolSet = {};
      return adultPoolSet;
    });
  return adultPoolPromise;
}

/* Drop any item whose title plus year matches the 18+ pool. When
   the pool is still loading, wait briefly for it (bounded, so a
   slow pool fetch never holds up the catalog); when the wait runs
   out, the items pass ungated and later searches gate them, since
   the pool keeps loading in the background. */
function applyIdentityGate(items) {
  if (adultPoolSet) {
    return Promise.resolve(items.filter(function (it) {
      return !isInAdultPool(it.title, it.year);
    }));
  }
  var pool = fetchAdultPool();
  var waited = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, ADULT_POOL_GATE_WAIT_MS);
  });
  return Promise.race([pool.then(function () { return true; }), waited])
    .then(function () {
      if (!adultPoolSet) return items;
      return items.filter(function (it) { return !isInAdultPool(it.title, it.year); });
    });
}

/* The normal catalog never includes adult titles. Appended to every
   query that is not the 18+ section's own. */
function applyAdultExclusion(query) {
  return query + " AND " + ADULT_EXCLUDE;
}

/* Items that are playlists or collection pages, not films. Skip them. */
var PLAYLIST_BLOCKLIST = ["SciFi_Horror", "Comedy_Films", "silent_films",
  "SciFi_Horror_Movies", "Feature_Films", "classic_tv", "classic_cartoons"];

var SEARCH_FIELDS = ["identifier", "title", "year", "date", "creator", "description",
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
/* Subfolder files (Green Acres season folders) encode their whole
   path, slashes included, so "Season 1/file.mp4" becomes
   "Season%201%2Ffile.mp4". Whether archive.org accepts the
   percent-encoded slash in playback is a live check (V9), not
   something code reading can settle. */
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

/* ---------- Release years ---------- */

/* The Archive's own year fields cannot be trusted: uploaders often
   put the upload date in `year` and `date` alike (verified live:
   The Two Headed Spy (1958) carries year 2024 and date 2024-03-02;
   The Fat Man (1951), Our Town (1955) and The Yellow Canary (1943)
   all carry year 2024). publicdate and addeddate are always upload
   dates. The title is the most reliable carrier of the release
   year, then the identifier, then the year field, then the date
   field. A parenthesised year in the title wins over a bare one:
   "2001: A Space Odyssey (1968)" is a 1968 film, not 2001. */
var DERIVED_YEAR_MIN = 1880;
/* The current year, derived at load so a new year of releases never
   needs a code change. */
var DERIVED_YEAR_MAX = new Date().getFullYear();

function inDerivedRange(y) {
  return y >= DERIVED_YEAR_MIN && y <= DERIVED_YEAR_MAX;
}

/* A year in free text: a parenthesised or bracketed year first,
   then the first bare four digit year. Pure, so the node test can
   drive it. */
function yearFromText(text) {
  var t = String(text || "");
  var m = t.match(/[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]/);
  if (m && inDerivedRange(Number(m[1]))) return Number(m[1]);
  var b = t.match(/\b((?:19|20)\d{2})\b/);
  if (b && inDerivedRange(Number(b[1]))) return Number(b[1]);
  return null;
}

/* A year from a metadata field value (a number, a "1958" string, a
   "1958-01-01" date, or a one element array of any of those).
   Returns null for garbage, future years and pre-cinema years. */
function yearFromField(v) {
  if (v == null) return null;
  if (Array.isArray(v)) v = v[0];
  if (v == null) return null;
  var s = String(v).slice(0, 4);
  if (!/^\d{4}$/.test(s)) return null;
  var y = parseInt(s, 10);
  return inDerivedRange(y) ? y : null;
}

/* The film's release year, never the upload year. Order: title,
   identifier, year field, date field. publicdate and addeddate are
   never consulted. Pure, so the node test can drive it. */
function deriveYearWithSource(doc) {
  doc = doc || {};
  var y = yearFromText(doc.title);
  if (y != null) return { year: y, source: "title" };
  y = yearFromText(doc.identifier);
  if (y != null) return { year: y, source: "identifier" };
  y = yearFromField(doc.year);
  if (y != null) return { year: y, source: "year" };
  y = yearFromField(doc.date);
  if (y != null) return { year: y, source: "date" };
  return { year: null, source: null };
}

function deriveYear(doc) {
  return deriveYearWithSource(doc).year;
}

/* A field-derived year that equals the upload year is suspicious:
   uploaders often put the upload date in the year field, so the
   film's real release year is likely earlier ("Stage 67 The Brave
   Rifles", a 1960s TV production, shows 2024 this way). Title and
   identifier years are trusted, and a field year that is not the
   upload year has no reason to be doubted. Pure, so the node test
   can drive it. */
function isSuspiciousYear(year, source, uploadYear) {
  if (year == null || uploadYear == null) return false;
  if (source !== "year" && source !== "date") return false;
  return year === uploadYear;
}

/* A stored history or My List entry may carry a year saved before
   the release-year fix, when the upload year was stored as the film
   year. Re-derive from the stored title and identifier so old
   entries display the right year too. */
function storedYear(entry) {
  if (!entry) return null;
  return deriveYear({ identifier: entry.id, title: entry.title, year: entry.year });
}

function normalizeDoc(doc, fallbackType) {
  return {
    id: String(doc.identifier),
    title: cleanTitle(doc.title),
    year: deriveYear(doc),
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

/* True when a file is one a browser <video> element can play: MP4,
   M4V, WebM or Ogg, and bigger than 1 MB so tiny samples never
   count. MKV, MPEG and MOV do not play in most phone browsers. */
function isPlayableFile(f) {
  return !!(f && f.name && /\.(mp4|m4v|webm|ogv)$/i.test(f.name) &&
    Number(f.size) > 1048576);
}

/* All files a browser <video> element can play, best first: MP4s
   (the 512kb one when there is one, then smallest), then WebM and
   Ogg. The player tries them in order when a file errors. Pure, so
   the node test can drive it. */
function rankedPlayableFiles(files) {
  files = files || [];
  var mp4s = files.filter(function (f) {
    return isPlayableFile(f) && /\.(mp4|m4v)$/i.test(f.name);
  });
  var small = mp4s.filter(function (f) { return f.name.indexOf("512kb") !== -1; });
  var rest = mp4s.filter(function (f) { return f.name.indexOf("512kb") === -1; });
  rest.sort(function (a, b) { return Number(a.size) - Number(b.size); });
  var others = files.filter(function (f) {
    return isPlayableFile(f) && !/\.(mp4|m4v)$/i.test(f.name);
  });
  others.sort(function (a, b) { return Number(a.size) - Number(b.size); });
  return small.concat(rest, others);
}

/* Pick a file a browser <video> element can actually play. Same idea as
   the download picker, but only web playable formats count: MP4 first
   (the 512kb one when there is one), then WebM or Ogg. MKV, MPEG and
   MOV files do not play in most phone browsers, so they are skipped. */
function pickPlayableFile(files) {
  var ranked = rankedPlayableFiles(files);
  return ranked.length ? ranked[0] : null;
}

/* ---------- Seasons and episodes ---------- */
/* How classic_tv episodes are actually represented, verified live
   2026-11-14 against real records. There are NO series, season or
   episode metadata fields on the Archive: season and episode
   numbers live only in titles, identifiers and file names, as
   free text. Episodes come two ways. Per-episode uploads, one item
   per episode, titled "Show - Episode title" (Bonanza, Dragnet),
   sometimes with a code: S01E02, S01 E02, S01- Ep.29, "Season 7,
   Episode 23", "Ep 2x08", "Episode # 18", "#9", or Ep01 in the
   identifier only. Most carry no number at all. And multi-file
   series items, one item holding a whole show: Bonanza_pd (30
   episodes, "Bonanza s01e19.mp4"), Green Acres Complete Series
   (about 170 episodes, "Green Acres Season 1/Green Acres - 001 -
   Oliver Buys A Farm.mp4", season in the folder, number and title
   in the file), Space 1999 Series 1 (24 episodes, "Space 1999
   S01E01 Breakaway.mp4", each twice, once with .ia in the name),
   The Beverly Hillbillies (3 episodes, plain titles like
   "Getting_Settled.mp4", each in four formats). So: group by
   season where the data carries a season, show the rest as a flat
   episode list, and NEVER invent a number that is not in the
   data. Every function here is pure, so the node test can drive
   it with fixtures taken from the real records above. */

/* Season and episode numbers from a title, identifier or file
   path. Returns { season, episode }, either null when the text
   carries no number. A bare number is never guessed at. */
function parseEpisodeRef(text) {
  var t = String(text || "");
  var m;
  m = t.match(/S(\d{1,2})\s*[- ]?\s*E(?:p(?:isode)?\.?)?\s*(\d{1,3})/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = t.match(/Season\s*(\d{1,2})\b[^0-9]{0,25}?Episode\s*(\d{1,3})/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  /* The NxN form needs a non-digit boundary before it, so a video
     resolution like 1280x720 does not parse as season 80, episode
     720. Seasons above 60 are not real either: the longest running
     shows stop well short of that, so a bigger number is data
     noise, not a season. */
  m = t.match(/(?:^|[^\d])(\d{1,2})x(\d{1,3})\b/);
  if (m && Number(m[1]) <= 60) return { season: Number(m[1]), episode: Number(m[2]) };
  var season = null;
  m = t.match(/Season\s*(\d{1,2})/i);
  if (m) season = Number(m[1]);
  m = t.match(/(?:^|[^A-Za-z0-9])Ep\.?\s*(\d{1,3})/i);
  if (m) return { season: season, episode: Number(m[1]) };
  m = t.match(/Episode\s*#?\s*(\d{1,3})/i);
  if (m) return { season: season, episode: Number(m[1]) };
  m = t.match(/#\s*(\d{1,3})\b/);
  if (m) return { season: season, episode: Number(m[1]) };
  /* Numbered files in a season folder: "Season 1/... - 001 - Title". */
  if (season != null) {
    var base = t.split("/").pop();
    m = base.match(/-\s*0*(\d{1,3})\s*-/);
    if (m) return { season: season, episode: Number(m[1]) };
    return { season: season, episode: null };
  }
  return { season: null, episode: null };
}

/* The episode's own title, with the show name, season and episode
   codes, year and file extension stripped. "" when the text
   carries no episode title of its own. */
function episodeTitleFrom(text, showName) {
  var t = String(text || "");
  /* File paths ("Season 1/... - 001 - Title.mp4") reduce to the base
     name; plain titles keep their whole text, since a title can
     carry a slash of its own ("The Big Seventeen w/commercials").
     Only a real media extension counts as a file: "Ep.29" ends in
     ".29", which is an episode number, not an extension. */
  if (/\.(mp4|m4v|webm|ogv|mkv|avi|mov|mpg|mpeg|jpg|jpeg|png|webp)$/i.test(t)) {
    t = t.split("/").pop();
    t = t.replace(/\.[A-Za-z0-9]{2,4}$/, "");
    t = t.replace(/\.ia$/i, "");
  }
  t = t.replace(/_/g, " ");
  t = t.replace(/["\u201c\u201d]/g, "");
  t = t.replace(/S\d{1,2}\s*[- ]?\s*E(?:p(?:isode)?\.?)?\s*\d{1,3}/ig, " ");
  t = t.replace(/Season\s*\d{1,2}\b[^0-9]{0,25}?Episode\s*\d{1,3}/ig, " ");
  t = t.replace(/\bEp\.?\s*\d{1,2}x\d{1,3}\b/ig, " ");
  /* Same non-digit boundary as parseEpisodeRef, so a resolution
     like 1280x720 in a title is not mangled into "12". */
  t = t.replace(/(^|[^\d])\d{1,2}x\d{1,3}\b/g, "$1 ");
  t = t.replace(/(?:^|[^A-Za-z0-9])Ep\.?\s*\d{1,3}/ig, " ");
  t = t.replace(/Episode\s*#?\s*\d{1,3}/ig, " ");
  t = t.replace(/#\s*\d{1,3}\b/g, " ");
  t = t.replace(/[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]/g, " ");
  t = t.replace(/-\s*0*\d{1,3}\s*-/g, " ");
  t = t.replace(/\(TV Rip\)/ig, " ");
  if (showName) {
    /* The same show is spelled with and without "The" across
       uploads ("The Beverly Hillbillies" vs "Beverly Hillbillies
       Ep01 ..."), so strip both spellings. */
    var names = [showName];
    if (/^the\s+/i.test(showName)) names.push(showName.replace(/^the\s+/i, ""));
    else names.push("The " + showName);
    names.forEach(function (n) {
      var rx = new RegExp("^" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\s*[-:\u2013\u2014]?\\s*", "i");
      t = t.replace(rx, "");
    });
  }
  t = t.replace(/\s+/g, " ").trim()
    .replace(/^[-:\u2013\u2014\s]+/, "").replace(/[-:\u2013\u2014\s]+$/, "").trim();
  return t;
}

/* Subject tags that name a medium, not a show. */
var GENERIC_SHOW_SUBJECTS = ["tv", "series", "television", "classic tv",
  "classic television", "public domain", "movies", "feature films",
  "feature film", "movingimage", "video", "vhs", "dvd", "color", "sound"];

/* The show's name from an item's title, for finding its sibling
   episodes. Strips years, season and episode codes, air dates and
   "Complete Series" style suffixes, then takes the part before
   the first separator, or a subject tag the title starts with, or
   a short whole title. Returns null when no show name can be
   trusted, so no sibling search runs on a guess. */
function deriveShowName(item, subjects) {
  var t = cleanTitle(item.title || "");
  if (/^\s*\d{4}s classic tv\s*$/i.test(t)) return null;
  t = t.replace(/["\u201c\u201d]/g, "");
  t = t.replace(/[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]/g, " ");
  t = t.replace(/S\d{1,2}\s*[- ]?\s*E(?:p(?:isode)?\.?)?\s*\d{1,3}/ig, " ");
  t = t.replace(/Season\s*\d{1,2}\b[^0-9]{0,25}?Episode\s*\d{1,3}/ig, " ");
  /* Same non-digit boundary as parseEpisodeRef, so a resolution
     like 1280x720 in a title is not mangled into "12". */
  t = t.replace(/(^|[^\d])\d{1,2}x\d{1,3}\b/g, "$1 ");
  t = t.replace(/(?:^|[^A-Za-z0-9])Ep\.?\s*\d{1,3}/ig, " ");
  t = t.replace(/Episode\s*#?\s*\d{1,3}/ig, " ");
  t = t.replace(/#\s*\d{1,3}\b/g, " ");
  t = t.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/ig, " ");
  t = t.replace(/\s*[\(\[]?(Complete Series|TV Show|TV Series|public domain episodes)[^\)\]]*[\)\]]?\s*$/i, "");
  t = t.replace(/\s+/g, " ").trim().replace(/[-:\u2013\u2014\s]+$/, "").trim();
  var parts = t.split(/\s+[-:\u2013\u2014]\s+|:\s+/);
  if (parts.length > 1) {
    var first = parts[0].trim();
    if (first.length >= 2 && first.length <= 40) return first;
  }
  var lower = t.toLowerCase();
  var found = null;
  (subjects || []).forEach(function (s) {
    if (found) return;
    var sub = String(s || "").trim();
    if (!sub || sub.length < 3 || sub.length > 40) return;
    if (GENERIC_SHOW_SUBJECTS.indexOf(sub.toLowerCase()) !== -1) return;
    if (lower.indexOf(sub.toLowerCase()) === 0) found = sub;
  });
  if (found) return found;
  if (t.length >= 2 && t.length <= 32 && t.split(/\s+/).length <= 4) return t;
  return null;
}

/* "S1 E19", "Episode 18", "Season 1", or "" when the episode
   carries no number at all. */
function episodeLabel(ep) {
  if (ep.season != null && ep.episode != null) return "S" + ep.season + " E" + ep.episode;
  if (ep.episode != null) return "Episode " + ep.episode;
  if (ep.season != null) return "Season " + ep.season;
  return "";
}

/* Group episodes by season, seasons in order, unnumbered episodes
   last in their own group. Inside a group, numbered episodes come
   first in episode order, then unnumbered ones by title. */
function groupEpisodes(episodes) {
  var groups = {};
  var order = [];
  (episodes || []).forEach(function (ep) {
    var key = ep.season != null ? "s" + ep.season : "other";
    if (!groups[key]) { groups[key] = { season: ep.season, episodes: [] }; order.push(key); }
    groups[key].episodes.push(ep);
  });
  var out = order.map(function (k) { return groups[k]; });
  out.forEach(function (g) {
    g.episodes.sort(function (a, b) {
      if (a.episode != null && b.episode != null) return a.episode - b.episode;
      if (a.episode != null) return -1;
      if (b.episode != null) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });
  });
  out.sort(function (a, b) {
    if (a.season == null) return 1;
    if (b.season == null) return -1;
    return a.season - b.season;
  });
  return out;
}

/* A short slug for an episode title inside a history key: lower
   case, words joined by dashes, capped at 60 characters. */
function episodeKeySlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
}

/* The history key for one episode inside a multi-file item, so
   each episode keeps its own place instead of sharing the show's.
   Keyed by season, episode and title, so a metadata change (a new
   512kb copy, a renamed file) does not orphan the saved place.
   When the episode carries no number and no title, the key falls
   back to the file's base name without its format suffix. A plain
   file name argument builds the legacy itemId::file key, which
   episodeHistoryEntry still honours for entries saved before this
   change. */
function episodeHistoryId(itemId, ep) {
  if (typeof ep === "string") return itemId + "::" + ep;
  ep = ep || {};
  if (ep.season != null || ep.episode != null || ep.title) {
    return itemId + "::ep:" +
      (ep.season == null ? "" : String(ep.season)) + ":" +
      (ep.episode == null ? "" : String(ep.episode)) + ":" +
      episodeKeySlug(ep.title);
  }
  return itemId + "::ep:file:" + episodeKeySlug(episodeBaseName(ep.file || ""));
}

/* The key an item's progress is stored under: a file episode's own
   key, otherwise the item id. */
function historyKey(item) {
  if (!item) return null;
  return item.historyId || item.id;
}

/* An episode's history entry, migrating a legacy itemId::file key
   to the new season/episode/title key when the new key has no
   entry yet. Old keys keep working; new saves use the new key.
   Plain items (no file episode) just read their own key. */
function episodeHistoryEntry(item) {
  if (!item) return null;
  var key = historyKey(item);
  var entry = key ? state.history[key] : null;
  if (entry) return entry;
  if (item.file && item.historyId) {
    var legacyKey = item.id + "::" + item.file;
    var legacy = state.history[legacyKey];
    if (legacy) {
      var moved = {};
      Object.keys(legacy).forEach(function (k) { moved[k] = legacy[k]; });
      moved.historyId = key;
      state.history[key] = moved;
      delete state.history[legacyKey];
      saveState();
      return moved;
    }
  }
  return null;
}

/* One episode per video file base name inside a multi-file series
   item. Same episode in several formats (MP4, MPG, OGV, AVI, the
   .ia duplicate, the 512kb copy) collapses to one episode, played
   from its best playable file. Episodes with no playable file are
   left out, so every listed episode can actually play. */
function episodeBaseName(name) {
  var base = String(name || "").replace(/\.(mp4|m4v|webm|ogv|mkv|avi|mov|mpg|mpeg)$/i, "");
  base = base.replace(/\.ia$/i, "").replace(/_512kb$/i, "");
  return base;
}

function episodesFromFiles(itemId, showName, files) {
  var byBase = {};
  (files || []).forEach(function (f) {
    if (!f || !f.name) return;
    if (!/\.(mp4|m4v|webm|ogv|mkv|avi|mov|mpg|mpeg)$/i.test(f.name)) return;
    if (Number(f.size) <= 1048576) return;
    var base = episodeBaseName(f.name);
    if (!byBase[base]) byBase[base] = [];
    byBase[base].push(f);
  });
  var out = [];
  Object.keys(byBase).forEach(function (base) {
    var group = byBase[base];
    var playable = pickPlayableFile(group);
    if (!playable) return;
    var ref = parseEpisodeRef(group[0].name);
    var ep = {
      itemId: itemId,
      file: playable.name,
      historyId: null,
      season: ref.season,
      episode: ref.episode,
      title: episodeTitleFrom(group[0].name, showName),
      length: Number(playable.length) || 0,
      size: Number(playable.size) || 0
    };
    /* The key comes from the episode's season, episode and title,
       not the picked file, so a metadata change does not orphan it. */
    ep.historyId = episodeHistoryId(itemId, ep);
    out.push(ep);
  });
  return out;
}

/* The dedupe key for one episode across the two episode blocks:
   season and episode when the data carries them, else the episode
   title. Two blocks listing the same episode collapse to one row. */
function episodeDedupeKey(ep) {
  if (!ep) return null;
  if (ep.season != null || ep.episode != null) {
    return "se:" + (ep.season == null ? "" : ep.season) + ":" +
      (ep.episode == null ? "" : ep.episode);
  }
  var t = (ep.title || "").toLowerCase().trim();
  return t ? "t:" + t : null;
}

/* Titles that name a series container, not one episode. */
var EPISODE_CONTAINER_TITLES = ["public domain episodes", "complete series",
  "complete collection", "tv show", "tv series", "all episodes", "collection"];

/* Per-episode uploads (search results) as episodes. The same
   episode uploaded twice collapses to one row: by season and
   episode number when the data carries them, by episode title
   otherwise, and a numbered copy replaces an unnumbered copy of
   the same episode title (the same upload often exists both ways:
   "Bonanza - Bitter Water" and "Bonanza - Bitter Water S01-
   Ep.29"). Results arrive most downloaded first, so the kept copy
   is the most popular one. Items that carry neither a number nor
   an episode title, and series containers like "Dragnet (1951)"
   or "Bonanza public domain episodes", are not episodes and are
   left out. */
function episodesFromItems(items, currentId, showName) {
  var seenSe = {};
  var titleIndex = {};
  var out = [];
  (items || []).forEach(function (it) {
    if (!it || !it.id) return;
    var ref = parseEpisodeRef(it.title);
    if (ref.season == null && ref.episode == null) ref = parseEpisodeRef(it.id);
    var title = episodeTitleFrom(it.title, showName);
    if (!title && ref.season == null && ref.episode == null) return;
    if (EPISODE_CONTAINER_TITLES.indexOf(title.toLowerCase()) !== -1) return;
    var seKey = (ref.season != null || ref.episode != null)
      ? "se:" + (ref.season == null ? "" : ref.season) + ":" +
        (ref.episode == null ? "" : ref.episode)
      : null;
    var tKey = title ? "t:" + title.toLowerCase() : null;
    if (seKey && seenSe[seKey]) return;
    var ep = {
      itemId: it.id,
      file: null,
      historyId: null,
      season: ref.season,
      episode: ref.episode,
      title: title,
      year: it.year != null ? it.year : null,
      downloads: it.downloads || 0,
      current: it.id === currentId
    };
    if (tKey && titleIndex[tKey] != null) {
      var existing = out[titleIndex[tKey]];
      if (existing.season == null && existing.episode == null) {
        if (seKey) { out[titleIndex[tKey]] = ep; seenSe[seKey] = true; }
        return;
      }
      if (!seKey) return;
      /* Same title, different numbers: a real second episode. */
    }
    if (seKey) seenSe[seKey] = true;
    if (tKey && titleIndex[tKey] == null) titleIndex[tKey] = out.length;
    out.push(ep);
  });
  return out;
}

/* ---------- State (localStorage) ---------- */
/* Two stores. The device store (archiveflix.v1) holds only the API
   keys and the OMDb ratings cache, shared across profiles. The
   profiles store (archiveflix.profiles.v1) holds up to 5 profiles,
   each with its own history, My List, reactions, hide-watched
   setting and theme. The rest of the app reads one merged `state`
   object, so the profile code stays in this section and saveState()
   splits it back into the two stores. Nothing personal ever leaves
   the browser: export is a button the user taps in Settings. */

var nodeStore = {}; /* in-memory fallback for node tests and browsers
                       that block storage. Nothing here is shipped. */

/* Storage health. When a real browser write fails (quota exceeded,
   storage blocked), saves fall back to memory, so the app keeps
   working but everything vanishes on reload. That must never be
   silent: the failure sets storageFailed and shows a persistent
   warning with an export and an erase option. In node there is no
   window, so the in-memory store is the intended store and no
   failure is recorded; node tests force a failure through the
   storageSimulateFailure flag instead. */
var storageFailed = false;
var storageFailureReason = "";
var storageSimulateFailure = false;

function storeGet(key) {
  try { return window.localStorage.getItem(key); }
  catch (e) { return Object.prototype.hasOwnProperty.call(nodeStore, key) ? nodeStore[key] : null; }
}

/* Returns true when the value reached real storage, false when it
   only reached memory. A false in a real browser means the data
   will vanish on reload, so the failure is recorded and warned
   about instead of swallowed. */
function storeSet(key, value) {
  try {
    if (storageSimulateFailure) {
      var err = new Error("Storage quota exceeded");
      err.name = "QuotaExceededError";
      throw err;
    }
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    nodeStore[key] = value;
    if (storageSimulateFailure || typeof window !== "undefined") noteStorageFailure(e);
    return false;
  }
}

function storeRemove(key) {
  try { window.localStorage.removeItem(key); }
  catch (e) { delete nodeStore[key]; }
}

function noteStorageFailure(err) {
  storageFailed = true;
  storageFailureReason = (err && err.name) || "StorageError";
  showStorageWarning();
}

/* The persistent storage warning: a fixed banner at the bottom of
   the screen that stays until storage works again. Export saves a
   copy of everything, Clear posters frees the poster cache (often
   enough on its own), and Erase everything frees the lot. Built in
   code because the markup cannot change. */
function showStorageWarning() {
  if (typeof document === "undefined" || !document.body) return;
  var existing = document.getElementById("storageWarning");
  if (existing) { existing.hidden = false; return; }
  var bar = document.createElement("div");
  bar.id = "storageWarning";
  bar.setAttribute("role", "alert");
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
    "padding:10px 12px;background:#7f1d1d;color:#fff;font-size:14px;" +
    "line-height:1.4;text-align:center;";
  var text = document.createElement("span");
  text.textContent = "ARCHIVEFLIX cannot save to this browser's storage " +
    "(" + storageFailureReason + "). Your history, My List and keys are only " +
    "in memory and will vanish when this page closes. Export a backup now, " +
    "or free space. ";
  bar.appendChild(text);
  function warnBtn(label, fn) {
    var b = document.createElement("button");
    b.className = "btn small";
    b.type = "button";
    b.textContent = label;
    b.style.margin = "4px 2px 0";
    b.addEventListener("click", fn);
    bar.appendChild(b);
  }
  warnBtn("Export backup", function () {
    var btn = document.getElementById("exportBtn");
    if (btn) btn.click();
  });
  warnBtn("Clear posters", function () {
    clearPosterCache();
    saveState();
    toast("Poster cache cleared");
  });
  warnBtn("Erase everything", function () {
    var btn = document.getElementById("wipeBtn");
    if (btn) btn.click();
  });
  document.body.appendChild(bar);
}

function hideStorageWarning() {
  if (typeof document === "undefined") return;
  var bar = document.getElementById("storageWarning");
  if (bar) bar.remove();
}

function defaultProfileData() {
  return {
    history: {},
    myList: [],
    reactions: {},
    hideWatched: false,
    theme: "flix",
    customAccent: "",
    adultEnabled: false,
    density: "comfortable"
  };
}

function defaultDeviceState() {
  return { version: 2, omdbKey: "", omdbCache: {}, tmdbKey: "" };
}

/* The merged shape the rest of the app reads: device fields plus the
   active profile's fields. */
function defaultState() {
  var s = defaultProfileData();
  s.version = 2;
  s.omdbKey = "";
  s.omdbCache = {};
  s.tmdbKey = "";
  return s;
}

function sanitizeProfileData(d) {
  var out = defaultProfileData();
  if (d && typeof d === "object") {
    PROFILE_FIELDS.forEach(function (k) { if (d[k] != null) out[k] = d[k]; });
  }
  if (!out.history || typeof out.history !== "object") out.history = {};
  out.history = pruneHistory(out.history);
  if (!Array.isArray(out.myList)) out.myList = [];
  if (!out.reactions || typeof out.reactions !== "object") out.reactions = {};
  if (typeof out.hideWatched !== "boolean") out.hideWatched = false;
  if (typeof out.theme !== "string" || !out.theme) out.theme = "flix";
  if (typeof out.customAccent !== "string") out.customAccent = "";
  if (typeof out.adultEnabled !== "boolean") out.adultEnabled = false;
  if (out.density !== "compact" && out.density !== "comfortable") out.density = "comfortable";
  return out;
}

function sanitizeProfile(p) {
  if (!p || typeof p !== "object" || !p.id || !p.name) return null;
  return {
    id: String(p.id),
    name: String(p.name).slice(0, 20),
    color: PROFILE_COLORS.indexOf(p.color) !== -1 ? p.color : PROFILE_COLORS[0],
    pinHash: typeof p.pinHash === "string" ? p.pinHash : "",
    pinSalt: typeof p.pinSalt === "string" ? p.pinSalt : "",
    data: sanitizeProfileData(p.data)
  };
}

function loadDeviceState() {
  var d = defaultDeviceState();
  try {
    var raw = storeGet(STORE_KEY);
    if (!raw) return d;
    var s = JSON.parse(raw);
    if (!s || typeof s !== "object") return d;
    /* Whitelist: only device fields survive. Profile fields from an
       old v1 store are dropped here; the migration below moves them
       into a profile first, reading the raw store itself. */
    DEVICE_FIELDS.forEach(function (k) { if (s[k] != null) d[k] = s[k]; });
    if (d.omdbCache && typeof d.omdbCache === "object") pruneOmdbCache(d.omdbCache);
    return d;
  } catch (e) { return d; }
}

/* A damaged profiles store is preserved here, verbatim, before
   anything overwrites it, so the user can download it or try a
   recovery instead of losing everything silently. */
var PROFILES_BACKUP_KEY = "archiveflix.profiles.v1.corrupt";
var storeDamaged = false;
var corruptProfilesRaw = null;

function profilesStoreFromParsed(s) {
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) return null;
  var profiles = [];
  s.profiles.forEach(function (p) {
    var clean = sanitizeProfile(p);
    if (clean) profiles.push(clean);
  });
  if (!profiles.length) return null;
  var activeId = s.activeId;
  if (!profiles.some(function (p) { return p.id === activeId; })) activeId = profiles[0].id;
  return { version: 1, activeId: activeId, profiles: profiles.slice(0, MAX_PROFILES) };
}

function loadProfilesStore() {
  try {
    var raw = storeGet(PROFILES_KEY);
    if (!raw) return null;
    return profilesStoreFromParsed(JSON.parse(raw));
  } catch (e) { return null; }
}

/* A fresh profiles store with one Main profile, in memory only.
   Used when the stored one is damaged (never persisted until the
   user chooses a fresh start) and by wipeAllData. */
function freshProfilesStore() {
  return {
    version: 1,
    activeId: "p-main",
    profiles: [{
      id: "p-main",
      name: "Main",
      color: PROFILE_COLORS[0],
      pinHash: "",
      pinSalt: "",
      data: defaultProfileData()
    }]
  };
}

/* Try to salvage a damaged store: a straight parse first, then a
   parse of the text up to its last closing brace, which recovers
   a store with trailing garbage after an otherwise complete
   object. Returns a profiles store, or null when nothing parses
   into at least one usable profile. */
function salvageProfiles(raw) {
  if (!raw) return null;
  try {
    var store = profilesStoreFromParsed(JSON.parse(raw));
    if (store) return store;
  } catch (e) { /* fall through to the trimmed attempt */ }
  try {
    var end = raw.lastIndexOf("}");
    if (end > 0) {
      var trimmed = profilesStoreFromParsed(JSON.parse(raw.slice(0, end + 1)));
      if (trimmed) return trimmed;
    }
  } catch (e) { /* not salvageable */ }
  return null;
}

/* The user chose to try recovery. Returns true when the preserved
   damaged store parsed into usable profiles and was adopted. */
function tryRecoverDamaged() {
  var raw = corruptProfilesRaw || storeGet(PROFILES_BACKUP_KEY);
  var store = salvageProfiles(raw);
  if (!store) return false;
  profilesStore = store;
  storeDamaged = false;
  corruptProfilesRaw = null;
  state = mergeState();
  persistStores();
  return true;
}

/* The user chose a fresh start. Only now may the damaged store be
   overwritten. The preserved copy stays under the backup key. */
function resolveDamagedFresh() {
  storeDamaged = false;
  corruptProfilesRaw = null;
  persistStores();
}

/* First load after the profiles update: move the existing single
   profile data (the old v1 device store) into the first profile, so
   nothing is lost. Runs only when there is no profiles store yet,
   which makes it safe to run twice: the second run finds the store
   and skips. */
function migrateFromDevice(deviceRaw) {
  var data = defaultProfileData();
  try {
    var s = deviceRaw ? JSON.parse(deviceRaw) : null;
    if (s && typeof s === "object") data = sanitizeProfileData(s);
  } catch (e) { /* corrupt old store: start empty, do not crash */ }
  return {
    version: 1,
    activeId: "p-main",
    profiles: [{
      id: "p-main",
      name: "Main",
      color: PROFILE_COLORS[0],
      pinHash: "",
      pinSalt: "",
      data: data
    }]
  };
}

var deviceState = null;
var profilesStore = null;
var state = null;

/* Returns true when both stores reached real storage. While a
   damaged profiles store is unresolved, the profiles store is
   never written: overwriting it would destroy the only copy of
   the user's data. A fully successful persist clears a storage
   failure warning, since space evidently came back. */
function persistStores() {
  var okDevice = storeSet(STORE_KEY, JSON.stringify(deviceState));
  var okProfiles = true;
  if (!storeDamaged) okProfiles = storeSet(PROFILES_KEY, JSON.stringify(profilesStore));
  if (okDevice && okProfiles && storageFailed) {
    storageFailed = false;
    storageFailureReason = "";
    hideStorageWarning();
  }
  return okDevice && okProfiles;
}

function activeProfile() {
  if (!profilesStore) return null;
  var found = null;
  profilesStore.profiles.forEach(function (p) {
    if (p.id === profilesStore.activeId) found = p;
  });
  return found || profilesStore.profiles[0] || null;
}

function findProfile(id) {
  var found = null;
  (profilesStore.profiles || []).forEach(function (p) {
    if (p.id === id) found = p;
  });
  return found;
}

/* The merged view the rest of the app reads: device fields plus the
   active profile's fields. Profile data objects are shared by
   reference, so in place edits (recordProgress and friends) land in
   the profile and saveState only has to persist the stores. */
function mergeState() {
  var p = activeProfile();
  var s = defaultState();
  DEVICE_FIELDS.forEach(function (k) { s[k] = deviceState[k]; });
  if (p) PROFILE_FIELDS.forEach(function (k) { s[k] = p.data[k]; });
  return s;
}

function loadStores() {
  deviceState = loadDeviceState();
  var rawProfiles = storeGet(PROFILES_KEY);
  profilesStore = loadProfilesStore();
  if (!profilesStore) {
    if (rawProfiles) {
      /* A store exists but nothing usable parses out of it: it is
         damaged, not missing. Preserve the raw text under the
         backup key, run on a temporary in-memory profile, and do
         NOT persist: persistStores refuses to touch the profiles
         store while storeDamaged is set, so the damaged store
         survives until the user chooses recovery or a fresh start
         in the damaged-data state shown at boot. */
      storeDamaged = true;
      corruptProfilesRaw = rawProfiles;
      storeSet(PROFILES_BACKUP_KEY, rawProfiles);
      profilesStore = freshProfilesStore();
    } else {
      storeDamaged = false;
      corruptProfilesRaw = null;
      profilesStore = migrateFromDevice(storeGet(STORE_KEY));
      persistStores();
    }
  } else {
    storeDamaged = false;
    corruptProfilesRaw = null;
  }
  state = mergeState();
  return state;
}

/* Playback re-saves all profiles every few seconds, and each save
   re-serializes the whole dataset. Deferred saves batch those
   together: at most one persist every 20 seconds during playback,
   flushed at once on pause, hide and close, where saveState is
   called directly. saveState clears any pending deferred save, so
   a flush never double writes. */
var PERSIST_DEBOUNCE_MS = 20000;
var persistTimer = null;
var persistDirty = false;

function saveStateSoon() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(function () {
    persistTimer = null;
    if (persistDirty) {
      persistDirty = false;
      saveState();
    }
  }, PERSIST_DEBOUNCE_MS);
}

function flushSaveState() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistDirty) {
    persistDirty = false;
    saveState();
  }
}

function saveState() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistDirty = false;
  DEVICE_FIELDS.forEach(function (k) { deviceState[k] = state[k]; });
  var p = activeProfile();
  if (p) PROFILE_FIELDS.forEach(function (k) { p.data[k] = state[k]; });
  persistStores();
}

loadStores();

/* ---------- Damaged saved data ---------- */
/* Shown at boot when the profiles store is damaged, instead of
   silently starting over. The app runs on a temporary empty
   profile until the user chooses: try to recover the preserved
   copy, download it, start fresh (the only choice that overwrites
   the damaged store), or carry on for now without saving profile
   data. Built in code because the markup cannot change. */

function hideDamagedState() {
  if (typeof document === "undefined") return;
  var overlay = document.getElementById("damagedOverlay");
  if (overlay) overlay.remove();
  var banner = document.getElementById("damagedBanner");
  if (banner) banner.remove();
}

function showDamagedBanner() {
  if (typeof document === "undefined" || !document.body) return;
  if (document.getElementById("damagedBanner")) return;
  var bar = document.createElement("div");
  bar.id = "damagedBanner";
  bar.setAttribute("role", "alert");
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
    "padding:10px 12px;background:#7f1d1d;color:#fff;font-size:14px;" +
    "line-height:1.4;text-align:center;";
  var text = document.createElement("span");
  text.textContent = "Your saved data looks damaged, so changes to profiles " +
    "are not being saved. ";
  bar.appendChild(text);
  var btn = document.createElement("button");
  btn.className = "btn small";
  btn.type = "button";
  btn.textContent = "Review damaged data";
  btn.style.margin = "4px 2px 0";
  btn.addEventListener("click", showDamagedState);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}

function showDamagedState() {
  if (typeof document === "undefined" || !document.body) return;
  hideDamagedState();
  var overlay = document.createElement("div");
  overlay.id = "damagedOverlay";
  overlay.className = "sheet-backdrop";
  overlay.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="damagedTitle">' +
    '<h2 id="damagedTitle">Your saved data looks damaged</h2>' +
    '<p class="sub">ARCHIVEFLIX could not read your saved profiles, history ' +
    "and My List. Nothing has been erased: the damaged copy is kept, and " +
    "the app is running on a temporary empty profile until you choose " +
    "what to do.</p>" +
    '<p class="sub" id="damagedResult" hidden></p>' +
    '<div class="key-row">' +
    '<button class="btn btn-primary" id="damagedRecover">Try to recover</button>' +
    '<button class="btn" id="damagedDownload">Download damaged data</button>' +
    "</div>" +
    '<div class="key-row">' +
    '<button class="btn btn-danger" id="damagedFresh">Start fresh (erases the damaged data)</button>' +
    '<button class="btn btn-ghost" id="damagedLater">Carry on for now without saving</button>' +
    "</div></div>";
  document.body.appendChild(overlay);
  overlay.querySelector("#damagedRecover").addEventListener("click", function () {
    if (tryRecoverDamaged()) {
      hideDamagedState();
      bootProfiles();
      toast("Your saved data was recovered");
    } else {
      var result = overlay.querySelector("#damagedResult");
      result.hidden = false;
      result.textContent = "Recovery did not work: the damaged copy could " +
        "not be read as profiles. You can still download it to keep it, " +
        "or start fresh.";
    }
  });
  overlay.querySelector("#damagedDownload").addEventListener("click", function () {
    var raw = corruptProfilesRaw || storeGet(PROFILES_BACKUP_KEY) || "";
    var blob = new Blob([raw], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "archiveflix-damaged-data.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Damaged data downloaded");
  });
  overlay.querySelector("#damagedFresh").addEventListener("click", function () {
    resolveDamagedFresh();
    hideDamagedState();
    bootProfiles();
    toast("Started fresh with an empty profile");
  });
  overlay.querySelector("#damagedLater").addEventListener("click", function () {
    hideDamagedState();
    showDamagedBanner();
    bootProfiles();
  });
}

/* ---------- PIN lock ---------- */
/* A 4 digit PIN, stored as a salted hash, never plaintext. This is
   a casual lock screen for the device, not encryption, and
   Settings says so. New PINs hash with SHA-256 through the browser
   crypto API, with a per-profile salt from crypto.getRandomValues.
   Stored hashes carry their format: "sha256:" plus 64 hex
   characters, or "fnv:" plus 8 hex characters when crypto.subtle
   is unavailable (a non-secure context), where the old FNV-1a
   hash runs with far more rounds instead. Bare 8 hex character
   hashes are the pre-1.6.0 format: they keep verifying through
   legacyHashPin, and a successful unlock re-hashes them in the
   new format, so nobody is ever locked out by the migration.
   One honest limit: a "sha256:" hash cannot be verified where
   crypto.subtle is missing, so a profile created on https and
   opened on plain http cannot unlock until it is back on a secure
   context; the Forgot PIN reset still works there. */

var PIN_FALLBACK_ROUNDS = 100000;
var PIN_HASH_SHA256_PREFIX = "sha256:";
var PIN_HASH_FALLBACK_PREFIX = "fnv:";

/* The original FNV-1a hash, kept for verification of old hashes
   and as the no-crypto fallback only. Never used for new PINs
   where SHA-256 is available. */
function legacyHashPin(pin, salt, rounds) {
  var input = String(salt) + ":" + String(pin);
  var h = 2166136261;
  for (var round = 0; round < rounds; round++) {
    for (var i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    input = (h >>> 0).toString(16);
  }
  return ("0000000" + (h >>> 0).toString(16)).slice(-8);
}

function hashPinFallback(pin, salt) {
  return PIN_HASH_FALLBACK_PREFIX + legacyHashPin(pin, salt, PIN_FALLBACK_ROUNDS);
}

/* Hash a PIN with SHA-256. Async: returns a Promise of the stored
   hash string. Falls back to the iterated FNV hash when the crypto
   API is unavailable, and notes that in code rather than failing. */
function hashPin(pin, salt) {
  var subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
  if (subtle && subtle.digest && typeof TextEncoder !== "undefined") {
    var data = new TextEncoder().encode(String(salt) + ":" + String(pin));
    return subtle.digest("SHA-256", data).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var hex = "";
      for (var i = 0; i < bytes.length; i++) {
        hex += ("0" + bytes[i].toString(16)).slice(-2);
      }
      return PIN_HASH_SHA256_PREFIX + hex;
    }).catch(function () {
      return hashPinFallback(pin, salt);
    });
  }
  return Promise.resolve(hashPinFallback(pin, salt));
}

function makePinSalt() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += ("0" + bytes[i].toString(16)).slice(-2);
    return s;
  }
  var fallback = "";
  var chars = "0123456789abcdef";
  for (var j = 0; j < 32; j++) fallback += chars[Math.floor(Math.random() * chars.length)];
  return fallback;
}

function isPinLocked(profile) {
  return !!(profile && profile.pinHash);
}

/* Check a PIN. Async: returns a Promise of true or false. A
   correct PIN on an old-format hash migrates that profile to
   SHA-256 on the spot (same salt, new hash), so old hashes
   disappear one successful unlock at a time. */
function checkProfilePin(id, pin) {
  var p = findProfile(id);
  if (!p || !p.pinHash) return Promise.resolve(false);
  if (!/^\d{4}$/.test(String(pin == null ? "" : pin))) return Promise.resolve(false);
  var stored = p.pinHash;
  var okPromise;
  if (stored.indexOf(PIN_HASH_SHA256_PREFIX) === 0) {
    okPromise = hashPin(pin, p.pinSalt).then(function (h) { return h === stored; });
  } else if (stored.indexOf(PIN_HASH_FALLBACK_PREFIX) === 0) {
    okPromise = Promise.resolve(
      legacyHashPin(pin, p.pinSalt, PIN_FALLBACK_ROUNDS) === stored.slice(PIN_HASH_FALLBACK_PREFIX.length));
  } else {
    okPromise = Promise.resolve(legacyHashPin(pin, p.pinSalt, 256) === stored);
  }
  return okPromise.then(function (ok) {
    if (!ok) return false;
    if (stored.indexOf(PIN_HASH_SHA256_PREFIX) === 0) return true;
    return hashPin(pin, p.pinSalt).then(function (h) {
      if (p.pinHash === stored) {
        p.pinHash = h;
        saveState();
      }
      return true;
    });
  });
}

/* ---------- PIN attempt limit ---------- */
/* A 4 digit PIN is 10,000 possibilities, so guessing must get
   slower and then stop: each wrong PIN blocks the pad for a
   growing delay (2, 4, 6, 8 seconds), and the 5th wrong PIN locks
   the profile for a minute. The lockout survives a sheet close
   and an app restart: it is stored under its own key, not in the
   profiles store. A successful unlock clears it, and the lockout
   expiring clears the failure count, so a legitimate user gets a
   fresh set of tries after waiting out the minute. Forgot PIN
   still works during a lockout. */
var PIN_LOCK_KEY = "archiveflix.pinlock.v1";
var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MS = 60000;
var PIN_DELAY_STEP_MS = 2000;

function loadPinLockState() {
  try {
    var raw = storeGet(PIN_LOCK_KEY);
    if (!raw) return {};
    var s = JSON.parse(raw);
    return (s && typeof s === "object") ? s : {};
  } catch (e) { return {}; }
}

var pinLockState = loadPinLockState();

function savePinLockState() {
  storeSet(PIN_LOCK_KEY, JSON.stringify(pinLockState));
}

/* Milliseconds until this profile's pad accepts input again, or 0.
   Reading it after a lockout has expired clears the failure count. */
function pinLockoutRemainingMs(id) {
  var entry = pinLockState[id];
  if (!entry || !entry.blockedUntil) return 0;
  var remaining = entry.blockedUntil - Date.now();
  if (remaining > 0) return remaining;
  if (entry.fails >= PIN_MAX_ATTEMPTS) {
    delete pinLockState[id];
    savePinLockState();
  }
  return 0;
}

function pinIsBlocked(id) {
  return pinLockoutRemainingMs(id) > 0;
}

function pinAttemptFailed(id) {
  var entry = pinLockState[id] || { fails: 0, blockedUntil: 0 };
  entry.fails = (entry.fails || 0) + 1;
  var delay = entry.fails >= PIN_MAX_ATTEMPTS
    ? PIN_LOCKOUT_MS : entry.fails * PIN_DELAY_STEP_MS;
  entry.blockedUntil = Date.now() + delay;
  pinLockState[id] = entry;
  savePinLockState();
  return entry.fails;
}

function pinAttemptSucceeded(id) {
  if (pinLockState[id]) {
    delete pinLockState[id];
    savePinLockState();
  }
}

/* ---------- Profiles ---------- */

function newProfileId() {
  return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

function cleanProfileName(name) {
  return String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, 20);
}

function createProfile(name) {
  name = cleanProfileName(name);
  if (!name) return null;
  if (profilesStore.profiles.length >= MAX_PROFILES) return null;
  var used = profilesStore.profiles.map(function (p) { return p.color; });
  var color = null;
  for (var i = 0; i < PROFILE_COLORS.length; i++) {
    if (used.indexOf(PROFILE_COLORS[i]) === -1) { color = PROFILE_COLORS[i]; break; }
  }
  if (!color) color = PROFILE_COLORS[profilesStore.profiles.length % PROFILE_COLORS.length];
  var p = {
    id: newProfileId(),
    name: name,
    color: color,
    pinHash: "",
    pinSalt: "",
    data: defaultProfileData()
  };
  profilesStore.profiles.push(p);
  saveState();
  return p;
}

function renameProfile(id, name) {
  var p = findProfile(id);
  name = cleanProfileName(name);
  if (!p || !name) return false;
  p.name = name;
  saveState();
  return true;
}

function deleteProfile(id) {
  if (profilesStore.profiles.length <= 1) return false;
  var idx = -1;
  profilesStore.profiles.forEach(function (p, i) { if (p.id === id) idx = i; });
  if (idx === -1) return false;
  profilesStore.profiles.splice(idx, 1);
  pinAttemptSucceeded(id);
  if (profilesStore.activeId === id) {
    profilesStore.activeId = profilesStore.profiles[0].id;
    state = mergeState();
  }
  saveState();
  return true;
}

/* Set a PIN. Async: returns a Promise of true or false, since
   hashing is async now. */
function setProfilePin(id, pin) {
  var p = findProfile(id);
  if (!p || !/^\d{4}$/.test(String(pin == null ? "" : pin))) return Promise.resolve(false);
  p.pinSalt = makePinSalt();
  return hashPin(pin, p.pinSalt).then(function (h) {
    p.pinHash = h;
    pinAttemptSucceeded(id);
    saveState();
    return true;
  });
}

/* Removing the PIN also turns the 18+ section off for that
   profile: the section needs a PIN to stay private, and leaving
   it enabled with no lock would open it to anyone. */
function removeProfilePin(id) {
  var p = findProfile(id);
  if (!p) return false;
  p.pinHash = "";
  p.pinSalt = "";
  pinAttemptSucceeded(id);
  if (p.data) p.data.adultEnabled = false;
  if (profilesStore.activeId === id) {
    state.adultEnabled = false;
    adultUnlocked = false;
  }
  saveState();
  return true;
}

/* Wipe one profile's personal data and its lock, keeping the profile
   itself. Used by the Forgot PIN reset, so a forgotten PIN never
   exposes the profile and never locks the app. */
function resetProfileData(id) {
  var p = findProfile(id);
  if (!p) return false;
  p.data = defaultProfileData();
  p.pinHash = "";
  p.pinSalt = "";
  pinAttemptSucceeded(id);
  if (profilesStore.activeId === id) state = mergeState();
  saveState();
  return true;
}

function switchProfile(id) {
  if (!findProfile(id)) return false;
  saveState();
  profilesStore.activeId = id;
  state = mergeState();
  saveState();
  return true;
}

/* ---------- Backup ---------- */
/* A backup covers all profiles plus the device keys. Import takes
   this format, and also the old single profile format, whose fields
   land in the currently open profile. */

function buildBackup() {
  saveState();
  return {
    format: "archiveflix-backup",
    backupVersion: 2,
    exportedAt: Date.now(),
    device: {
      omdbKey: deviceState.omdbKey || "",
      omdbCache: deviceState.omdbCache || {},
      tmdbKey: deviceState.tmdbKey || ""
    },
    profiles: {
      version: 1,
      activeId: profilesStore.activeId,
      profiles: profilesStore.profiles
    }
  };
}

/* What a backup file holds, for the import confirmation: the
   format, and the profile names it would bring in. Returns null
   when the file is not a backup. Pure, so the node test can drive
   it. */
function describeBackup(data) {
  if (!data || typeof data !== "object") return null;
  if (data.backupVersion === 2 && data.profiles && Array.isArray(data.profiles.profiles)) {
    var names = [];
    data.profiles.profiles.forEach(function (p) {
      if (p && p.name) names.push(String(p.name).slice(0, 20));
    });
    if (!names.length) return null;
    return { kind: "v2", names: names };
  }
  if (data.history && typeof data.history === "object") {
    return { kind: "v1", names: [] };
  }
  return null;
}

/* An imported profile with the 18+ section enabled but no PIN is
   the same hole as removing a PIN: close it by turning the section
   off on import, instead of letting the section open to anyone. */
function closeAdultWithoutPin(profiles) {
  (profiles || []).forEach(function (p) {
    if (p && p.data && p.data.adultEnabled && !p.pinHash) p.data.adultEnabled = false;
  });
}

/* Returns "v2" for a full multi profile backup, "v1" for an old
   single profile backup, or "" when the file is not a backup.
   Importing is an explicit replacement, so it also clears a
   damaged-store state: the user chose to overwrite. */
function parseBackup(data) {
  if (!data || typeof data !== "object") return "";
  if (data.backupVersion === 2 && data.profiles && Array.isArray(data.profiles.profiles)) {
    var profiles = [];
    data.profiles.profiles.forEach(function (p) {
      var clean = sanitizeProfile(p);
      if (clean) profiles.push(clean);
    });
    if (!profiles.length) return "";
    profiles = profiles.slice(0, MAX_PROFILES);
    closeAdultWithoutPin(profiles);
    var activeId = data.profiles.activeId;
    if (!profiles.some(function (p) { return p.id === activeId; })) activeId = profiles[0].id;
    profilesStore = { version: 1, activeId: activeId, profiles: profiles };
    deviceState = defaultDeviceState();
    if (data.device && typeof data.device === "object") {
      DEVICE_FIELDS.forEach(function (k) { if (data.device[k] != null) deviceState[k] = data.device[k]; });
    }
    state = mergeState();
    storeDamaged = false;
    corruptProfilesRaw = null;
    adultUnlocked = false;
    adultLoaded = false;
    persistStores();
    return "v2";
  }
  if (data.history && typeof data.history === "object") {
    var p = activeProfile();
    if (!p) return "";
    p.data = sanitizeProfileData(data);
    closeAdultWithoutPin([p]);
    if (data.omdbKey != null) deviceState.omdbKey = data.omdbKey;
    if (data.omdbCache != null) deviceState.omdbCache = data.omdbCache;
    if (data.tmdbKey != null) deviceState.tmdbKey = data.tmdbKey;
    state = mergeState();
    storeDamaged = false;
    corruptProfilesRaw = null;
    adultUnlocked = false;
    adultLoaded = false;
    persistStores();
    return "v1";
  }
  return "";
}

function wipeAllData() {
  deviceState = defaultDeviceState();
  profilesStore = freshProfilesStore();
  state = mergeState();
  storeDamaged = false;
  corruptProfilesRaw = null;
  storeRemove(PROFILES_BACKUP_KEY);
  pinLockState = {};
  storeRemove(PIN_LOCK_KEY);
  adultUnlocked = false;
  adultLoaded = false;
  persistStores();
}

/* History and the OMDb ratings cache both grow without bound,
   and both are serialized into local storage on every save, so
   long-term use marches toward the storage quota. Caps live in
   the constants block above; these are the pruners. */
function pruneHistory(history) {
  var keys = Object.keys(history || {});
  if (keys.length <= HISTORY_MAX_ENTRIES) return history;
  var entries = keys.map(function (k) { return { key: k, h: history[k] }; });
  entries.sort(function (a, b) { return (a.h.lastWatchedAt || 0) - (b.h.lastWatchedAt || 0); });
  var over = entries.length - HISTORY_MAX_ENTRIES;
  var finished = entries.filter(function (e) { return e.h.progress >= 1; });
  var rest = entries.filter(function (e) { return e.h.progress < 1; });
  var drop = finished.slice(0, over);
  if (drop.length < over) drop = drop.concat(rest.slice(0, over - drop.length));
  drop.forEach(function (e) { delete history[e.key]; });
  return history;
}

function pruneOmdbCache(cache) {
  var keys = Object.keys(cache || {});
  if (keys.length > OMDB_CACHE_MAX) {
    keys.slice(0, keys.length - OMDB_CACHE_MAX).forEach(function (k) { delete cache[k]; });
  }
  return cache;
}

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
   titles keep showing, so Continue Watching still works. The check
   uses the episode history key, not the bare item id, so an episode
   card hides when that episode is finished. A show also hides once
   every episode entry recorded for it is finished, since episode
   progress lives under per-episode keys, not the item id. Only
   episodes with a saved entry count here; episodes never opened are
   not known, so a show hides once every episode it has entries for
   is finished. */
function shouldHide(item) {
  if (!item || !state.hideWatched) return false;
  if (isFinished(historyKey(item))) return true;
  var anyEpisode = false;
  var allFinished = true;
  Object.keys(state.history).forEach(function (k) {
    var h = state.history[k];
    if (!h || h.id !== item.id || k === item.id) return;
    anyEpisode = true;
    if (h.progress < 1) allFinished = false;
  });
  return anyEpisode && allFinished;
}

function filterVisible(items) {
  return items.filter(function (it) { return !shouldHide(it); });
}

/* Position and duration are seconds. A finished title keeps its
   duration but its position goes back to 0, so playing it again
   starts from the beginning. Older entries without a position keep
   working: they just have the progress fraction. Pass deferPersist
   true for the steady playback tick, so position saves batch into
   one persist every 20 seconds instead of re-serializing every
   profile every 5 seconds; pause, hide and close save at once. */
function recordProgress(item, progress, position, duration, deferPersist) {
  /* A file episode stores its progress under its own key, so each
     episode keeps its own place. The entry still carries the real
     item id, so its card opens the show and its poster resolves. */
  var key = historyKey(item);
  var prev = state.history[key];
  var wasFinished = !!(prev && prev.progress >= 1);
  var now = Date.now();
  state.history[key] = {
    id: item.id,
    historyId: key,
    file: item.file || null,
    title: item.title,
    year: item.year,
    type: item.type,
    subjects: item.subjects || (prev && prev.subjects) || [],
    adult: isAdultItem(item) || !!(prev && prev.adult),
    progress: progress,
    position: progress >= 1 ? 0 :
      (position != null ? Math.round(position) : (prev ? prev.position || 0 : 0)),
    duration: duration != null ? Math.round(duration) : (prev ? prev.duration || 0 : 0),
    lastWatchedAt: now,
    watchCount: (prev ? prev.watchCount : 0) + (progress >= 1 && !wasFinished ? 1 : 0)
  };
  pruneHistory(state.history);
  if (deferPersist) saveStateSoon();
  else saveState();
}

function toggleMyList(item) {
  var i = state.myList.findIndex(function (m) { return m.id === item.id; });
  if (i === -1) {
    state.myList.unshift({ id: item.id, title: item.title, year: item.year, type: item.type,
      subjects: item.subjects || [], adult: isAdultItem(item) });
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

/* ---------- Adult backfill ---------- */
/* History and My List entries from before v1.4.0 carry no adult
   flag and no subjects, so adult titles watched or saved back
   then leak into normal History, Continue Watching, Watch Again
   and My List. This fetches the metadata subjects for entries
   that lack them and flags the adult ones, so the normal views
   split correctly. Bounded: at most 10 metadata fetches per run,
   each entry checked at most once per session, and the metadata
   itself is cached per session, so it never hammers the Archive
   on every load. Runs when a profile is entered and lazily when
   History renders. Returns a Promise of true when any entry was
   newly flagged adult, so the caller can re-render. */
var BACKFILL_BATCH_MAX = 10;
var backfillCheckedIds = {};

function backfillAdultFlags() {
  var byId = {};
  function consider(id, entry) {
    if (!id || !entry || entry.adult) return;
    if (entry.subjects && entry.subjects.length) return;
    if (backfillCheckedIds[id]) return;
    if (!byId[id]) byId[id] = [];
    byId[id].push(entry);
  }
  Object.keys(state.history).forEach(function (k) {
    consider(state.history[k].id, state.history[k]);
  });
  state.myList.forEach(function (m) { consider(m.id, m); });
  Object.keys(state.reactions).forEach(function (id) {
    consider(id, state.reactions[id]);
  });
  var ids = Object.keys(byId).slice(0, BACKFILL_BATCH_MAX);
  if (!ids.length) return Promise.resolve(false);
  ids.forEach(function (id) { backfillCheckedIds[id] = true; });
  var jobs = ids.map(function (id) {
    return Promise.resolve().then(function () { return getMetadata(id); })
      .then(function (json) {
        var subjects = subjectsOf(((json || {}).metadata) || {});
        var adult = isAdultItem({ id: id, subjects: subjects });
        byId[id].forEach(function (entry) {
          entry.subjects = subjects;
          if (adult) entry.adult = true;
        });
        return { adult: adult, stored: true };
      }).catch(function () { return { adult: false, stored: false }; });
  });
  return Promise.all(jobs).then(function (results) {
    var anyAdult = results.some(function (r) { return r.adult; });
    var anyStored = results.some(function (r) { return r.stored; });
    if (anyStored) saveState();
    return anyAdult;
  });
}

/* ---------- Fetch with a deadline ---------- */
/* No network call in the app used to have a timeout, so a hung
   request left rows on skeletons forever. Every fetch below goes
   through this helper: about 15 seconds for search and metadata,
   10 seconds for posters and ratings. A timeout rejects with an
   Error named TimeoutError, which flows into the same Retry states
   as any other fetch failure. Later builders reuse this helper, so
   the name and signature stay simple: fetchWithTimeout(url, ms). */
var FETCH_TIMEOUT_SEARCH_MS = 15000;
var FETCH_TIMEOUT_POSTER_MS = 10000;

function fetchWithTimeout(url, ms) {
  ms = ms || FETCH_TIMEOUT_SEARCH_MS;
  if (typeof AbortController === "undefined") return fetch(url);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms);
  return fetch(url, { signal: controller.signal }).then(function (res) {
    clearTimeout(timer);
    return res;
  }, function (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      var timeoutErr = new Error("Request timed out after " + ms + " ms");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    }
    throw err;
  });
}

/* ---------- Archive.org API ---------- */

/* Session caches, capped with simple least-recently-used eviction:
   a hit moves its entry to the back, and a put drops the oldest
   entries past the cap. Plain objects keep insertion order for
   string keys, which is all the ordering this needs. */
var SEARCH_CACHE_MAX = 100;
var META_CACHE_MAX = 100;
var searchCache = {};
var metaCache = {};
/* Queries with a fetch already running, so identical simultaneous
   queries share one request instead of fetching twice. */
var searchInFlight = {};

function cacheGet(cache, key) {
  if (!Object.prototype.hasOwnProperty.call(cache, key)) return undefined;
  var value = cache[key];
  delete cache[key];
  cache[key] = value;
  return value;
}

function cachePut(cache, key, value, max) {
  if (Object.prototype.hasOwnProperty.call(cache, key)) delete cache[key];
  cache[key] = value;
  var keys = Object.keys(cache);
  if (keys.length > max) {
    for (var i = 0; i < keys.length - max; i++) delete cache[keys[i]];
  }
}

/* A fresh result object with its own items array, so a caller can
   sort or filter without mutating the cached copy. */
function searchResultCopy(out) {
  return { total: out.total, items: out.items.slice() };
}

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

/* The one choke point for catalog searches. Adult titles are
   excluded at the query level unless the caller passes
   allowAdult (only the 18+ section does), and the results are
   filtered client side too, so a query syntax quirk can never leak
   an adult title into the normal catalog. */
function searchArchive(query, opts) {
  opts = opts || {};
  var q = opts.allowAdult ? query : applyAdultExclusion(query);
  var key = q + "|" + (opts.rows || ROW_SIZE) + "|" + (opts.sort || "") + "|" + (opts.start || 0);
  var cached = cacheGet(searchCache, key);
  if (cached) return Promise.resolve(searchResultCopy(cached));
  if (searchInFlight[key]) return searchInFlight[key].then(searchResultCopy);
  var promise = fetchWithTimeout(searchUrl(q, opts), FETCH_TIMEOUT_SEARCH_MS).then(function (res) {
    if (!res.ok) throw new Error("Archive search failed: " + res.status);
    return res.json();
  }).then(function (json) {
    var docs = ((json.response || {}).docs || []).map(function (d) {
      return normalizeDoc(d, opts.type);
    }).filter(function (it) {
      return it.id && !isBlocked(it.id) && (opts.allowAdult || !isAdultItem(it));
    });
    var total = (json.response || {}).numFound || 0;
    if (opts.allowAdult) {
      /* The section still drops mistagged titles on the override
         list, which are not adult whatever their tags say. */
      docs = docs.filter(function (it) { return !isAdultOverridden(it.id); });
      var out = { total: total, items: docs };
      cachePut(searchCache, key, out, SEARCH_CACHE_MAX);
      return out;
    }
    /* The identity gate drops untagged duplicates of 18+ titles,
       which neither the server exclusion nor the subject filter
       can catch. The gated result is what gets cached. */
    return applyIdentityGate(docs).then(function (gated) {
      var gatedOut = { total: total, items: gated };
      cachePut(searchCache, key, gatedOut, SEARCH_CACHE_MAX);
      return gatedOut;
    });
  });
  searchInFlight[key] = promise;
  /* Clear the in-flight slot however the fetch ends, so a failed
     query can be retried and a finished one reads from the cache. */
  promise.then(function () { delete searchInFlight[key]; },
               function () { delete searchInFlight[key]; });
  return promise.then(searchResultCopy);
}

function getMetadata(id) {
  var cached = cacheGet(metaCache, id);
  if (cached) return Promise.resolve(cached);
  return fetchWithTimeout(META_API + encodeURIComponent(id), FETCH_TIMEOUT_SEARCH_MS).then(function (res) {
    if (!res.ok) throw new Error("Archive metadata failed: " + res.status);
    return res.json();
  }).then(function (json) {
    cachePut(metaCache, id, json, META_CACHE_MAX);
    return json;
  });
}

/* ---------- OMDb and TMDB provider health ---------- */
/* A bad key used to burn calls on every Home load forever, with no
   message. Now an invalid-key or rate-limit response disables that
   provider for the session (detected once, from the HTTP status or
   from OMDb's own error text), Settings shows a warning, and
   failed lookups are negative cached briefly in memory so one bad
   title is not re-fetched on every row. Saving a new key resets
   the provider, since the new key may be valid. */
var providerDisabledReason = { omdb: null, tmdb: null };
var NEGATIVE_CACHE_MS = 10 * 60 * 1000;
var providerNegativeCache = {};

function providerDisabled(name) {
  return !!providerDisabledReason[name];
}

function disableProvider(name, reason) {
  if (providerDisabledReason[name]) return;
  providerDisabledReason[name] = reason;
  if (typeof document !== "undefined") {
    toast(name === "omdb" ? "OMDb stopped answering: " +
      (reason === "invalid-key" ? "that key was rejected." : "the daily request limit was reached.") +
      " Check the key in Settings."
      : "TMDB stopped answering: " +
      (reason === "invalid-key" ? "that key was rejected." : "too many requests.") +
      " Check the key in Settings.");
  }
}

function resetProvider(name) {
  providerDisabledReason[name] = null;
  Object.keys(providerNegativeCache).forEach(function (k) {
    if (k.indexOf(name + "|") === 0) delete providerNegativeCache[k];
  });
}

function negativeCached(key) {
  var ts = providerNegativeCache[key];
  if (!ts) return false;
  if (Date.now() - ts > NEGATIVE_CACHE_MS) {
    delete providerNegativeCache[key];
    return false;
  }
  return true;
}

function negativeCachePut(key) {
  providerNegativeCache[key] = Date.now();
}

/* What kind of provider failure is this, if any? OMDb reports an
   invalid key as HTTP 401 and a spent quota as HTTP 200 with
   "Request limit reached" in the body, so both the status and the
   error text are checked. Returns "invalid-key", "rate-limit", or
   null. Pure, so the node test can drive it. */
function omdbErrorKind(j, status) {
  if (status === 401) return "invalid-key";
  if (status === 429) return "rate-limit";
  if (j && j.Response === "False" && typeof j.Error === "string") {
    if (/invalid api key/i.test(j.Error)) return "invalid-key";
    if (/request limit/i.test(j.Error)) return "rate-limit";
  }
  return null;
}

/* OMDb is only ever called when the user saved their own free key. */
function omdbRating(title, year) {
  var key = state.omdbKey;
  if (!key) return Promise.resolve(null);
  if (providerDisabled("omdb")) return Promise.resolve(null);
  var cacheKey = title.toLowerCase() + "|" + (year || "");
  if (state.omdbCache[cacheKey]) return Promise.resolve(state.omdbCache[cacheKey]);
  var negKey = "omdb|rating|" + cacheKey;
  if (negativeCached(negKey)) return Promise.resolve(null);
  var url = "https://www.omdbapi.com/?apikey=" + encodeURIComponent(key) +
    "&t=" + encodeURIComponent(title) + (year ? "&y=" + year : "") + "&type=movie";
  return fetchWithTimeout(url, FETCH_TIMEOUT_POSTER_MS).then(function (res) {
    var kind = omdbErrorKind(null, res.status);
    if (kind) {
      disableProvider("omdb", kind);
      negativeCachePut(negKey);
      return null;
    }
    if (!res.ok) {
      negativeCachePut(negKey);
      return null;
    }
    return res.json();
  }).then(function (j) {
    if (!j) return null;
    var kind = omdbErrorKind(j, 200);
    if (kind) {
      disableProvider("omdb", kind);
      return null;
    }
    var out = null;
    if (j.Response === "True" && j.imdbRating && j.imdbRating !== "N/A") {
      out = { rating: Number(j.imdbRating), votes: j.imdbVotes || "" };
      state.omdbCache[cacheKey] = out;
      pruneOmdbCache(state.omdbCache);
      saveState();
    } else {
      negativeCachePut(negKey);
    }
    return out;
  }).catch(function () {
    negativeCachePut(negKey);
    return null;
  });
}

/* Look up a release year by title from OMDb, then TMDB, when a key
   is saved. Used only for suspicious years in the details sheet
   (see isSuspiciousYear). Positive answers are cached for the
   session, failures briefly, so opening the same title twice
   costs one lookup. Respects the provider health flags: a
   disabled provider is never called. */
var YEAR_LOOKUP_NEGATIVE_MS = 10 * 60 * 1000;
var yearLookupCache = {};

function tmdbResultYear(r) {
  var d = (r && (r.release_date || r.first_air_date)) || "";
  var y = parseInt(String(d).slice(0, 4), 10);
  return isNaN(y) ? null : y;
}

function tmdbYearSearch(endpoint, t) {
  return tmdbSearchRaw(endpoint, t, null, state.tmdbKey).then(function (results) {
    if (!results) return null;
    var want = normalizeTitleForMatch(t);
    var fallback = null;
    for (var i = 0; i < results.length; i++) {
      var y = tmdbResultYear(results[i]);
      if (y == null) continue;
      if (fallback == null) fallback = y;
      if (normalizeTitleForMatch(results[i].title || results[i].name) === want) return y;
    }
    return fallback;
  });
}

function lookupReleaseYear(title) {
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var key = t.toLowerCase();
  var hit = yearLookupCache[key];
  if (hit) {
    if (hit.year != null || Date.now() - hit.ts <= YEAR_LOOKUP_NEGATIVE_MS) {
      return Promise.resolve(hit.year);
    }
    delete yearLookupCache[key];
  }
  function done(year) {
    yearLookupCache[key] = { year: year || null, ts: Date.now() };
    return year || null;
  }
  var omdb = null;
  if (state.omdbKey && !providerDisabled("omdb")) {
    var url = "https://www.omdbapi.com/?apikey=" + encodeURIComponent(state.omdbKey) +
      "&t=" + encodeURIComponent(t);
    omdb = fetchWithTimeout(url, FETCH_TIMEOUT_POSTER_MS).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (j) {
      if (!j) return null;
      var kind = omdbErrorKind(j, 200);
      if (kind) {
        disableProvider("omdb", kind);
        return null;
      }
      if (j.Response === "True" && j.Year) {
        var m = String(j.Year).match(/((?:19|20)\d{2})/);
        if (m) return Number(m[1]);
      }
      return null;
    }).catch(function () { return null; });
  } else {
    omdb = Promise.resolve(null);
  }
  return omdb.then(function (y) {
    if (y != null) return done(y);
    if (!state.tmdbKey || providerDisabled("tmdb")) return done(null);
    return tmdbYearSearch("movie", t).then(function (y2) {
      if (y2 != null) return done(y2);
      return tmdbYearSearch("tv", t).then(function (y3) { return done(y3); });
    });
  });
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
/* A failed lookup is cached as "no poster" for a day only, not 30:
   a single offline moment or API outage must not mean no poster
   retry for a month. */
var POSTER_NULL_CACHE_MS = 24 * 60 * 60 * 1000;

/* Is a cached poster entry still good? Real posters live 30 days;
   nulls (no poster found) live a day. Pure, so the node test can
   drive it. */
function posterCacheValid(entry, now) {
  if (!entry || typeof entry.ts !== "number") return false;
  var age = (now || Date.now()) - entry.ts;
  if (entry.url) return age <= POSTER_CACHE_MS;
  return age <= POSTER_NULL_CACHE_MS;
}

function loadPosterCache() {
  try {
    var raw = storeGet(POSTER_CACHE_KEY);
    if (!raw) return {};
    var c = JSON.parse(raw);
    if (!c || typeof c !== "object") return {};
    var now = Date.now();
    Object.keys(c).forEach(function (k) {
      if (!posterCacheValid(c[k], now)) delete c[k];
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
    /* Drop expired entries first, then cap the real posters at 400
       oldest first. Nulls never count toward the cap, so a failed
       lookup cannot push a good poster out. */
    var now = Date.now();
    Object.keys(posterCache).forEach(function (k) {
      if (!posterCacheValid(posterCache[k], now)) delete posterCache[k];
    });
    var positives = Object.keys(posterCache).filter(function (k) {
      return posterCache[k] && posterCache[k].url;
    });
    if (positives.length > POSTER_CACHE_MAX) {
      positives.sort(function (a, b) { return (posterCache[a].ts || 0) - (posterCache[b].ts || 0); });
      positives.slice(0, positives.length - POSTER_CACHE_MAX).forEach(function (k) { delete posterCache[k]; });
    }
    storeSet(POSTER_CACHE_KEY, JSON.stringify(posterCache));
  } catch (e) { /* private mode or full: posters just re-resolve next visit */ }
}

function clearPosterCache() {
  posterCache = {};
  posterAttempted = {};
  storeRemove(POSTER_CACHE_KEY);
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
   that actually has a poster. "N/A" means no poster. A provider
   failure (bad key, spent quota, HTTP error) disables the provider
   and skips the search call: doubling calls on a failure only
   burns quota. Failures are negative cached briefly. */
function omdbPoster(title, year) {
  var key = state.omdbKey;
  if (!key) return Promise.resolve(null);
  if (providerDisabled("omdb")) return Promise.resolve(null);
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var negKey = "omdb|poster|" + t.toLowerCase() + "|" + (year || "");
  if (negativeCached(negKey)) return Promise.resolve(null);
  var base = "https://www.omdbapi.com/?apikey=" + encodeURIComponent(key);
  if (year) base += "&y=" + encodeURIComponent(year);
  function posterOf(j) {
    if (!j || j.Poster == null || j.Poster === "N/A") return null;
    return j.Poster;
  }
  return fetchWithTimeout(base + "&t=" + encodeURIComponent(t), FETCH_TIMEOUT_POSTER_MS)
    .then(function (res) {
      if (!res.ok) {
        var kind = omdbErrorKind(null, res.status);
        if (kind) disableProvider("omdb", kind);
        throw new Error("omdb-failed");
      }
      return res.json();
    })
    .then(function (j) {
      var kind = omdbErrorKind(j, 200);
      if (kind) {
        disableProvider("omdb", kind);
        return null;
      }
      var p = posterOf(j);
      if (p) return p;
      return fetchWithTimeout(base + "&s=" + encodeURIComponent(t), FETCH_TIMEOUT_POSTER_MS)
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (j2) {
          if (!j2) return null;
          var kind2 = omdbErrorKind(j2, 200);
          if (kind2) {
            disableProvider("omdb", kind2);
            return null;
          }
          var list = (j2 && j2.Search) || [];
          for (var i = 0; i < list.length; i++) {
            var q = posterOf(list[i]);
            if (q) return q;
          }
          return null;
        });
    })
    .then(function (p) {
      if (!p) negativeCachePut(negKey);
      return p;
    })
    .catch(function () {
      negativeCachePut(negKey);
      return null;
    });
}

/* One TMDB search, returning the raw results array or null. A 401
   (bad key) or 429 (too many requests) disables TMDB for the
   session, so a bad key is detected once instead of once per card. */
function tmdbSearchRaw(endpoint, q, year, key) {
  var url = "https://api.themoviedb.org/3/search/" + endpoint +
    "?api_key=" + encodeURIComponent(key) + "&query=" + encodeURIComponent(q) +
    "&include_adult=false";
  if (year) url += "&" + (endpoint === "tv" ? "first_air_date_year=" : "year=") +
    encodeURIComponent(year);
  return fetchWithTimeout(url, FETCH_TIMEOUT_POSTER_MS).then(function (res) {
    if (res.status === 401) {
      disableProvider("tmdb", "invalid-key");
      return null;
    }
    if (res.status === 429) {
      disableProvider("tmdb", "rate-limit");
      return null;
    }
    if (!res.ok) return null;
    return res.json();
  }).then(function (j) {
    if (!j) return null;
    return j.results || [];
  }).catch(function () { return null; });
}

/* Pick the best poster from TMDB results, preferring a result whose
   title and year match the item, the way the Commons layer's year
   guard already does. A same-title remake or a fuzzy match must
   not supply the wrong poster just because TMDB listed it first.
   Ties and no-match cases fall back to TMDB's relevance order.
   Pure, so the node test can drive it. */
function pickTmdbPoster(results, title, year) {
  var want = normalizeTitleForMatch(title);
  var best = null, bestScore = -1;
  (results || []).forEach(function (r) {
    if (!r.poster_path) return;
    var score = 0;
    var name = normalizeTitleForMatch(r.title || r.name);
    if (want && name === want) score += 4;
    else if (want && name && (name.indexOf(want) !== -1 || want.indexOf(name) !== -1)) score += 2;
    var y = tmdbResultYear(r);
    if (year && y && y === Number(year)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  });
  return best ? tmdbPosterUrl(best.poster_path) : null;
}

function tmdbSearch(endpoint, q, year, key) {
  if (providerDisabled("tmdb")) return Promise.resolve(null);
  return tmdbSearchRaw(endpoint, q, year, key).then(function (results) {
    if (!results) return null;
    return pickTmdbPoster(results, q, year);
  });
}

/* TMDB poster, matched by title and year. Shows search TV first,
   everything else searches movies first, then the other side.
   Failures are negative cached briefly. */
function tmdbPoster(title, year, type) {
  var key = state.tmdbKey;
  if (!key) return Promise.resolve(null);
  if (providerDisabled("tmdb")) return Promise.resolve(null);
  var t = cleanSearchTitle(title);
  if (!t) return Promise.resolve(null);
  var negKey = "tmdb|poster|" + t.toLowerCase() + "|" + (year || "") + "|" + (type || "");
  if (negativeCached(negKey)) return Promise.resolve(null);
  var first = type === "show" ? "tv" : "movie";
  var second = first === "tv" ? "movie" : "tv";
  return tmdbSearch(first, t, year, key).then(function (p) {
    if (p) return p;
    return tmdbSearch(second, t, year, key);
  }).then(function (p) {
    if (!p) negativeCachePut(negKey);
    return p;
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
  return fetchWithTimeout(url, FETCH_TIMEOUT_POSTER_MS).then(function (res) { return res.json(); }).then(function (j) {
    var pages = ((j.query || {}).pages) || {};
    var list = Object.keys(pages).map(function (k) { return pages[k]; });
    return pickCommonsPoster(list, title, year);
  }).catch(function () { return null; });
}

/* Run the layers in order. Returns a poster URL or null (keep the
   Archive thumbnail). Positive results are cached for 30 days and
   nulls for a day, so a failure is retried tomorrow, not next
   month. */
function resolvePoster(item) {
  var id = item.id;
  var cached = posterCache[id];
  if (cached && posterCacheValid(cached)) return Promise.resolve(cached.url);
  if (cached) delete posterCache[id];
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
    if (url) applyRealPoster(job.img, url);
    else if (!posterCache[job.item.id]) {
      /* The lookup threw without writing the cache, so the item is
         neither cached nor retried unless the attempt flag is
         cleared here. A cached null stays attempted: it already
         has its answer for the day. */
      delete posterAttempted[job.item.id];
    }
    posterQueuePump();
  }).catch(function () {
    posterInFlight--;
    delete posterAttempted[job.item.id];
    posterQueuePump();
  });
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
   handler hides the image first; this restores it with the thumbnail,
   unless the thumbnail was already rejected as a bad frame, in which
   case the title card stays. If the thumbnail itself fails, the
   title card is the fallback. The listener stays attached so a
   restored thumbnail that also fails still lands on the title card;
   it cannot loop, because the restore only runs when the current
   source is not already the thumbnail. */
function posterErrorGuard(img, item, kind) {
  function onErr() {
    if (img.src !== posterUrl(item.id)) {
      if (thumbVerdict[item.id] === false) {
        rejectThumbnail(img, item, kind);
      } else {
        img.style.display = "";
        img.src = posterUrl(item.id);
      }
    } else {
      rejectThumbnail(img, item, kind);
    }
  }
  img.addEventListener("error", onErr);
}

/* Show a resolved real poster on an image, undoing a title card if
   one is showing. Real posters are trusted and never validated. */
function applyRealPoster(img, url) {
  if (!img || !url || img.src === url) return;
  img.style.display = "";
  if (img.dataset) delete img.dataset.thumbRejected;
  if (img.parentElement && img.parentElement.classList) {
    img.parentElement.classList.remove("hero-noart");
  }
  img.src = url;
}

/* Upgrade one image to a real poster when one resolves. The Archive
   thumbnail stays put until something better arrives, and nothing
   here ever blocks the rows. */
function upgradePoster(img, item, kind) {
  if (!img || !item || !item.id) return;
  posterErrorGuard(img, item, kind);
  var cached = posterCache[item.id];
  if (cached && posterCacheValid(cached)) {
    if (cached.url) applyRealPoster(img, cached.url);
    return;
  }
  if (cached) delete posterCache[item.id];
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

/* ---------- Thumbnail validation ---------- */
/* The Archive thumbnail is a random video frame, and random frames
   are often blank, black, or an end credits screen. Those look lazy
   on a card, so a thumbnail is validated before it is trusted: its
   pixels are sampled on a canvas, and a blank or nearly all black
   frame is rejected in favour of a designed title card showing the
   film's title and year. Only the Archive thumbnail is validated;
   real posters from OMDb, TMDB, the item's own poster files, and
   Commons are trusted sources and are shown as-is.
   HONEST LIMIT: a canvas check needs the image served with CORS
   headers, and archive.org serves its images without them (verified
   2026-11-14: services/img, download/__ia_thumb.jpg, and the direct
   petabox host all answer without Access-Control-Allow-Origin, even
   when an Origin header is sent, while the JSON APIs do send it).
   So in practice the probe cannot read Archive thumbnails: it fails,
   validation switches itself off for the session after two failed
   probes instead of burning a failed request on every card, and the
   thumbnail is left showing. The title card still covers every
   failed thumbnail load, and the validation runs in full the day
   Archive images carry CORS headers. */

var THUMB_NEAR_BLACK = 24;
var THUMB_MAX_NEAR_BLACK = 0.90;
var THUMB_MIN_STDDEV = 5;
var THUMB_PROBE_ERROR_LIMIT = 2;

function luminanceOf(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* Analyze an array of luminance samples (0-255). Pure, so the node
   test can drive it with fixtures. A frame is bad when nearly all of
   it is near black (a blank black frame, or an end credits screen:
   black with a little white text) or when it is flat (a blank frame
   of any colour). */
function analyzeFrame(samples) {
  var n = samples.length;
  if (!n) return { mean: 0, stddev: 0, nearBlackFrac: 1, bad: true };
  var sum = 0, nearBlack = 0, i;
  for (i = 0; i < n; i++) {
    sum += samples[i];
    if (samples[i] < THUMB_NEAR_BLACK) nearBlack++;
  }
  var mean = sum / n;
  var sq = 0;
  for (i = 0; i < n; i++) sq += (samples[i] - mean) * (samples[i] - mean);
  var stddev = Math.sqrt(sq / n);
  var nearBlackFrac = nearBlack / n;
  var bad = nearBlackFrac >= THUMB_MAX_NEAR_BLACK || stddev < THUMB_MIN_STDDEV;
  return { mean: mean, stddev: stddev, nearBlackFrac: nearBlackFrac, bad: bad };
}

function isBadThumbnail(samples) {
  return analyzeFrame(samples).bad;
}

/* Is this URL an Archive thumbnail (services/img)? Only those are
   validated; every real poster source bypasses validation. */
function isArchiveThumbnailUrl(url) {
  return typeof url === "string" &&
    url.indexOf("https://archive.org/services/img/") === 0;
}

/* The designed title card shown when a thumbnail is rejected or
   fails to load: the film's title and year on a theme-aware card.
   Pure markup, so the node test can check it. */
function titleCardHtml(item) {
  var meta = [item.year ? String(item.year) : "", typeLabel(item.type)]
    .filter(Boolean).join(" · ");
  return '<span class="title-card-mark">ARCHIVEFLIX</span>' +
    '<span class="title-card-title">' + esc(item.title) + "</span>" +
    (meta ? '<span class="title-card-year">' + esc(meta) + "</span>" : "");
}

/* Verdicts per item id, so a thumbnail is probed once per session:
   true = good frame, false = rejected (title card). */
var thumbVerdict = {};
var thumbValidationAvailable = true;
var thumbProbeErrors = 0;

function thumbProbeFailed() {
  thumbProbeErrors++;
  if (thumbProbeErrors >= THUMB_PROBE_ERROR_LIMIT) {
    thumbValidationAvailable = false;
  }
}

/* Hide the image to reveal the designed title card behind it (for
   the hero, the gradient backdrop plus the title treatment already
   in the hero content). Records the rejection so the frame is never
   shown again this session. */
function rejectThumbnail(img, item, kind) {
  if (item && item.id) thumbVerdict[item.id] = false;
  if (!img) return;
  img.style.display = "none";
  if (img.dataset) img.dataset.thumbRejected = "1";
  if (kind === "hero" && img.parentElement && img.parentElement.classList) {
    img.parentElement.classList.add("hero-noart");
  }
}

/* Probe one thumbnail through a canvas and reject it if it is blank
   or nearly all black. Runs only while the image still shows the
   Archive thumbnail; a real poster bypasses it entirely. A probe
   that cannot read its pixels (no CORS headers, network failure)
   leaves the thumbnail showing: fail open, never blank a card that
   might be fine. */
function probeThumbnail(img, item, kind) {
  if (!img || !item || !item.id) return;
  if (thumbVerdict[item.id] !== undefined) return;
  if (!thumbValidationAvailable) return;
  if (!isArchiveThumbnailUrl(img.src)) return;
  if (typeof Image === "undefined" || typeof document === "undefined") return;
  var probe = new Image();
  probe.crossOrigin = "anonymous";
  probe.onload = function () {
    try {
      var canvas = document.createElement("canvas");
      var W = 32, H = 18;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(probe, 0, 0, W, H);
      var data = ctx.getImageData(0, 0, W, H).data;
      var samples = [];
      for (var i = 0; i < data.length; i += 4) {
        samples.push(luminanceOf(data[i], data[i + 1], data[i + 2]));
      }
      /* The card may have upgraded to a real poster while the probe
         was in flight; only the thumbnail gets a verdict. */
      if (!isArchiveThumbnailUrl(img.src)) return;
      if (isBadThumbnail(samples)) {
        rejectThumbnail(img, item, kind);
      } else {
        thumbVerdict[item.id] = true;
      }
      thumbProbeErrors = 0;
    } catch (e) {
      thumbProbeFailed();
    }
  };
  probe.onerror = function () { thumbProbeFailed(); };
  probe.src = img.src;
}

/* Guard one thumbnail image: validate it when it loads (and again
   whenever a thumbnail is restored after an upgraded poster fails).
   A known-bad thumbnail is rejected at once instead of flashing on
   screen first. Call after upgradePoster, so a cached real poster
   is already showing and no probe starts for it. */
function guardThumbnail(img, item, kind) {
  if (!img || !item || !item.id) return;
  if (thumbVerdict[item.id] === false && isArchiveThumbnailUrl(img.src)) {
    rejectThumbnail(img, item, kind);
    return;
  }
  img.addEventListener("load", function () { probeThumbnail(img, item, kind); });
  if (img.complete && img.naturalWidth > 0) probeThumbnail(img, item, kind);
}

/* ---------- Toasts ---------- */
/* One toast at a time, queued in order, never replaced mid-read.
   Short confirmations show 4 seconds; longer messages (over 50
   characters) get 7 seconds, inside the library's 4 to 10 second
   range. An optional second argument adds one action button, used
   for Undo on destructive toasts. Existing toast(msg) callers are
   unaffected. */

var TOAST_SHORT_MS = 4000;
var TOAST_LONG_MS = 7000;
var TOAST_LONG_MIN_LENGTH = 50;
var TOAST_QUEUE_MAX = 5;

/* How long a message stays up. Pure, so the node test can drive it. */
function toastDurationFor(msg) {
  return String(msg || "").length > TOAST_LONG_MIN_LENGTH ? TOAST_LONG_MS : TOAST_SHORT_MS;
}

/* A tiny FIFO queue for toasts. Pure, so the node test can drive
   the ordering without a DOM. */
function makeToastQueue() {
  var queue = [];
  return {
    push: function (item) {
      queue.push(item);
      /* A runaway burst (repeated errors) drops its oldest queued
         message rather than stacking up minutes of toasts. The one
         on screen is never dropped. */
      if (queue.length > TOAST_QUEUE_MAX) queue.shift();
    },
    next: function () { return queue.length ? queue.shift() : null; },
    length: function () { return queue.length; }
  };
}

var toastQueue = makeToastQueue();
var toastShowing = false;
var toastTimer = null;

function toast(msg, options) {
  toastQueue.push({ msg: msg, options: options || null });
  showNextToast();
}

function showNextToast() {
  if (toastShowing) return;
  var next = toastQueue.next();
  if (!next) return;
  toastShowing = true;
  var el = document.getElementById("toast");
  el.innerHTML = "";
  var span = document.createElement("span");
  span.textContent = next.msg;
  el.appendChild(span);
  if (next.options && next.options.action) {
    var btn = document.createElement("button");
    btn.className = "btn small";
    btn.type = "button";
    btn.textContent = next.options.action.label;
    btn.style.marginLeft = "12px";
    btn.addEventListener("click", function () {
      hideToast();
      next.options.action.onClick();
    });
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastDurationFor(next.msg));
}

function hideToast() {
  clearTimeout(toastTimer);
  var el = document.getElementById("toast");
  el.hidden = true;
  toastShowing = false;
  showNextToast();
}

/* ---------- Dialog focus management ---------- */
/* One shared helper for all four dialogs (details sheet, player
   sheet, profile picker, PIN pad). On open, the element that had
   focus is saved and focus moves to the dialog's Close button or
   first heading. While a dialog is open, Tab stays inside it. On
   close, focus returns to the saved element, so a keyboard user
   who opens a title and closes it lands back on the card they
   came from. A stack handles the PIN pad opening over the picker:
   each dialog restores to the element focused before it opened. */

var dialogFocusStack = [];

function dialogElFor(sheetId) {
  var sheet = document.getElementById(sheetId);
  return sheet ? sheet.querySelector('[role="dialog"]') : null;
}

/* The tabbable elements inside a dialog, in tab order. */
function focusableIn(el) {
  if (!el || !el.querySelectorAll) return [];
  var nodes = el.querySelectorAll("a[href], button, input, select, textarea, [tabindex]");
  return Array.prototype.filter.call(nodes, function (n) {
    if (n.disabled) return false;
    if (n.hidden) return false;
    if (n.getAttribute("tabindex") === "-1") return false;
    if (typeof n.getClientRects === "function" && n.getClientRects().length === 0) return false;
    return true;
  });
}

/* Pure Tab trap: given the tabbable list and the focused element,
   which element should Tab (or Shift+Tab) move to? Returns the
   element to focus when the tab would leave the list, or null
   when Tab should proceed normally. Pure, so the node test can
   drive it with plain values. */
function nextTabTarget(list, current, shift) {
  if (!list || !list.length) return null;
  var idx = list.indexOf(current);
  if (idx === -1) return shift ? list[list.length - 1] : list[0];
  if (!shift && idx === list.length - 1) return list[0];
  if (shift && idx === 0) return list[list.length - 1];
  return null;
}

/* Focus the dialog's Close button, or its first heading when the
   Close button is hidden (the picker at boot, the PIN pad with no
   Cancel). Headings are not focusable by default, so a heading
   gets tabindex -1 first: focusable by script, never in tab order. */
function focusDialogStart(dialogEl) {
  if (!dialogEl) return;
  var close = dialogEl.querySelector(".sheet-close");
  if (close && !close.hidden) { close.focus(); return; }
  var heading = dialogEl.querySelector("h2, h3");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus();
    return;
  }
  var first = focusableIn(dialogEl)[0];
  if (first) first.focus();
}

function dialogOpened(dialogEl) {
  if (!dialogEl) return;
  var already = dialogFocusStack.some(function (entry) { return entry.el === dialogEl; });
  if (!already) {
    dialogFocusStack.push({ el: dialogEl, previous: document.activeElement });
  }
  /* Always move focus in: a re-rendered details sheet destroys the
     button that had focus, so focus would otherwise land on body. */
  focusDialogStart(dialogEl);
}

function dialogClosed(dialogEl) {
  if (!dialogEl) return;
  for (var i = dialogFocusStack.length - 1; i >= 0; i--) {
    if (dialogFocusStack[i].el !== dialogEl) continue;
    var entry = dialogFocusStack.splice(i, 1)[0];
    var prev = entry.previous;
    if (prev && typeof prev.focus === "function" && document.contains(prev)) {
      prev.focus();
    }
    return;
  }
}

/* The Tab trap: one document listener, active while any dialog is
   open, scoping Tab to the topmost dialog. Wired once in init. */
function onDialogKeydown(e) {
  if (e.key !== "Tab" || !dialogFocusStack.length) return;
  var top = dialogFocusStack[dialogFocusStack.length - 1];
  if (!top.el || !document.contains(top.el)) return;
  var target = nextTabTarget(focusableIn(top.el), document.activeElement, e.shiftKey);
  if (target) {
    e.preventDefault();
    target.focus();
  }
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

/* A card button. opts.adultContext marks cards inside the 18+
   section, so the details sheet they open knows its More Like This
   row may include adult titles. The flag travels with the card,
   never read back from the DOM. */
function cardEl(item, opts) {
  var adultCtx = !!(opts && opts.adultContext);
  var btn = document.createElement("button");
  btn.className = "card";
  btn.setAttribute("aria-label", item.title + (item.year ? " (" + item.year + ")" : ""));
  var badge = ratingBadge(item);
  var h = item.id && state.history[historyKey(item)];
  var prog = h ? h.progress : 0;
  var meta = [item.year ? String(item.year) : "", typeLabel(item.type)].filter(Boolean).join(" · ");
  btn.innerHTML =
    '<span class="poster"><span class="title-card">' + titleCardHtml(item) + "</span>" +
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
  if (posterImg) {
    upgradePoster(posterImg, item, "card");
    guardThumbnail(posterImg, item, "card");
  }
  btn.addEventListener("click", function () { openDetails(item, { adultContext: adultCtx }); });
  return btn;
}

/* Carousel arrows: translucent left and right arrows at the edges
   of each row, Netflix style. They appear on hover on a computer,
   and briefly whenever the row is scrolled or touched on a phone,
   where there is no hover. Tapping one scrolls the row by a page
   of cards; swiping still works alongside. An arrow is disabled
   when its end of the row is reached, and both stay hidden when
   the row fits without scrolling. */
function rowEl(title, subtitle) {
  var section = document.createElement("section");
  section.className = "row";
  section.innerHTML = '<div class="row-head"><h2>' + esc(title) + "</h2>" +
    (subtitle ? '<p class="row-sub">' + esc(subtitle) + "</p>" : "") + "</div>" +
    '<div class="row-viewport"><button class="row-arrow row-arrow-left" type="button" ' +
    'aria-label="Scroll row left" disabled>&#8249;</button>' +
    '<div class="row-scroll"></div>' +
    '<button class="row-arrow row-arrow-right" type="button" ' +
    'aria-label="Scroll row right" disabled>&#8250;</button></div>';
  wireRowArrows(section.querySelector(".row-viewport"));
  return section;
}

/* Pure arrow state, for the node test: given a row's scroll
   position, which arrows can move it? */
function rowArrowState(scrollLeft, clientWidth, scrollWidth) {
  var canScroll = scrollWidth > clientWidth + 4;
  return {
    left: canScroll && scrollLeft > 4,
    right: canScroll && scrollLeft + clientWidth < scrollWidth - 4,
    any: canScroll
  };
}

/* One page of cards, leaving a peek of the next card. */
function rowScrollStep(clientWidth) {
  return Math.max(120, Math.round(clientWidth * 0.9));
}

function updateRowArrows(viewport) {
  if (!viewport) return;
  var scroll = viewport.querySelector(".row-scroll");
  var left = viewport.querySelector(".row-arrow-left");
  var right = viewport.querySelector(".row-arrow-right");
  if (!scroll || !left || !right) return;
  var st = rowArrowState(scroll.scrollLeft, scroll.clientWidth, scroll.scrollWidth);
  left.disabled = !st.left;
  right.disabled = !st.right;
}

var rowArrowsResizeWired = false;

function wireRowArrows(viewport) {
  if (!viewport || viewport.getAttribute("data-arrows-wired")) return;
  viewport.setAttribute("data-arrows-wired", "1");
  var scroll = viewport.querySelector(".row-scroll");
  var left = viewport.querySelector(".row-arrow-left");
  var right = viewport.querySelector(".row-arrow-right");
  if (!scroll || !left || !right) return;
  left.addEventListener("click", function () {
    scroll.scrollBy({ left: -rowScrollStep(scroll.clientWidth), behavior: "smooth" });
  });
  right.addEventListener("click", function () {
    scroll.scrollBy({ left: rowScrollStep(scroll.clientWidth), behavior: "smooth" });
  });
  var hideTimer = null;
  function showBriefly() {
    viewport.classList.add("arrows-shown");
    clearTimeout(hideTimer);
    /* 1.2 seconds, not 2.4: on a phone the arrows sit over the edge
       cards, and a long window turns taps on those cards into taps
       on the arrows. */
    hideTimer = setTimeout(function () { viewport.classList.remove("arrows-shown"); }, 1200);
  }
  scroll.addEventListener("scroll", function () {
    updateRowArrows(viewport);
    showBriefly();
  });
  scroll.addEventListener("touchstart", showBriefly, { passive: true });
  /* Once the finger lifts and scrolling stops, the arrows go away
     quickly instead of lingering over the edge cards. Momentum
     scrolling keeps firing scroll events, which re-show them until
     the row actually stops. */
  scroll.addEventListener("touchend", function () {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { viewport.classList.remove("arrows-shown"); }, 400);
  }, { passive: true });
  if (!rowArrowsResizeWired) {
    rowArrowsResizeWired = true;
    window.addEventListener("resize", function () {
      var viewports = document.querySelectorAll(".row-viewport");
      Array.prototype.forEach.call(viewports, function (v) { updateRowArrows(v); });
    });
  }
  updateRowArrows(viewport);
}

/* The entrance delay for the card at this index in a row: 20ms
   per card, capped at 250ms, so delay plus the 250ms run stays
   inside 500ms. Pure, so the node test can drive it. */
function enterDelayFor(index) {
  return Math.min(index * 20, 250);
}

/* Rows that have already played their entrance this session, keyed
   by container and row title, so a re-scan, a profile switch or a
   personal-shelf refresh never re-animates a row the user has
   already seen. */
var enteredRows = {};

function rowEnterKey(section) {
  var h = section.querySelector(".row-head h2");
  var title = h ? h.textContent : "";
  var parent = section.parentElement;
  var where = parent && parent.id ? parent.id : "";
  return where + "|" + title;
}

function fillRow(section, items, emptyText, opts) {
  var scroll = section.querySelector(".row-scroll");
  scroll.innerHTML = "";
  if (!items.length) {
    var p = document.createElement("p");
    p.className = "row-error";
    p.textContent = emptyText || "Nothing here yet.";
    scroll.appendChild(p);
    updateRowArrows(section.querySelector(".row-viewport"));
    return;
  }
  /* First render of this row only: cards stagger in, 20ms apart.
     Repeat renders show the cards at once. Reduced motion kills
     the animation in CSS. */
  var enterKey = rowEnterKey(section);
  var firstRender = !enteredRows[enterKey];
  if (firstRender) enteredRows[enterKey] = true;
  items.forEach(function (it, i) {
    var card = cardEl(it, opts);
    if (firstRender) {
      card.classList.add("enter");
      card.style.setProperty("--enter-delay", enterDelayFor(i) + "ms");
    }
    scroll.appendChild(card);
  });
  updateRowArrows(section.querySelector(".row-viewport"));
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
  updateRowArrows(section.querySelector(".row-viewport"));
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

/* Year clauses for Archive queries. The indexed `year` field holds
   upload years for a share of items (verified live: a 1958 film
   with year 2024), so a year filter also matches the year in the
   title, which is where the release year reliably lives. A single
   year and a range up to 40 years get the title OR; wider ranges
   stay year-only so the query stays sane. The client-side filter
   in matchesYearFilter then keeps only items whose derived release
   year really matches, so a 2024 filter never returns a 1958 film. */
var TITLE_YEAR_OR_MAX_SPAN = 40;

function yearClauseSingle(y) {
  return "(year:" + y + " OR title:" + y + ")";
}

function yearClauseRange(from, to) {
  from = Number(from); to = Number(to);
  var base = "year:[" + from + " TO " + to + "]";
  if (to - from > TITLE_YEAR_OR_MAX_SPAN) return base;
  var terms = [];
  for (var y = from; y <= to; y++) terms.push(String(y));
  return "(" + base + " OR title:(" + terms.join(" OR ") + "))";
}

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
  { id: "golden",    title: "Golden Age 1930s", q: MOVIES + " AND " + yearClauseRange(1930, 1939), sort: "downloads desc", yearRange: [1930, 1939] },
  { id: "silent",    title: "Silent Era", q: MOVIES + " AND " + yearClauseRange(1890, 1929), sort: "downloads desc", yearRange: [1890, 1929] },
  { id: "directors", title: "Directors Picks", subtitle: "Hitchcock, Chaplin, Keaton and Welles", special: "directors" },
  { id: "imdb",      title: "Top IMDb", special: "imdb" }
];

function loadRow(def) {
  if (def.special === "directors") return loadDirectors();
  if (def.special === "cartoons") return loadCartoons();
  if (def.special === "imdb") return loadTopImdb();
  return searchArchive(def.q, { rows: def.rows || 30, sort: def.sort, type: def.type,
      allowAdult: !!def.allowAdult })
    .then(function (res) {
      var items = res.items;
      if (def.noYoutube) items = items.filter(function (it) { return !isYoutubeRip(it.id); });
      if (def.yearRange) items = items.filter(function (it) {
        return it.year != null && it.year >= def.yearRange[0] && it.year <= def.yearRange[1];
      });
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
      { rows: 8, sort: "downloads desc", type: "movie" })
      .then(function (res) { return { ok: true, items: res.items }; },
            function () { return { ok: false, items: [] }; });
  });
  return Promise.all(jobs).then(function (results) {
    /* One failed query still shows the directors that loaded. All
       four failing is an outage, and the row must show its Retry
       state, not "Nothing found". */
    var anyOk = results.some(function (r) { return r.ok; });
    if (!anyOk) throw new Error("Directors row failed");
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
    { rows: 30, sort: "downloads desc", type: "cartoon" })
    .then(function (res) { return { ok: true, items: res.items }; },
          function () { return { ok: false, items: [] }; });
  var extra = searchArchive("mediatype:movies AND subject:cartoons",
    { rows: 30, sort: "downloads desc", type: "cartoon" })
    .then(function (res) { return { ok: true, items: res.items }; },
          function () { return { ok: false, items: [] }; });
  return Promise.all([curated, extra]).then(function (res) {
    /* Both queries failing is an outage, and the row must show its
       Retry state, not "Nothing found". */
    if (!res[0].ok && !res[1].ok) throw new Error("Cartoons row failed");
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
          /* Copy before enriching: the item objects come from the
             shared search cache, and writing imdbRating onto them
             would leak the badge into every other row showing the
             same title. */
          if (!r) return it;
          var copy = {};
          Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
          copy.imdbRating = r.rating;
          return copy;
        });
      });
      return Promise.all(jobs).then(function (done) {
        var rated = done.filter(function (it) { return it.imdbRating != null; })
          .sort(function (a, b) { return b.imdbRating - a.imdbRating; });
        var ratedIds = {};
        rated.forEach(function (it) { ratedIds[it.id] = true; });
        var rest = items.filter(function (it) { return !ratedIds[it.id]; });
        return { items: rated.concat(rest).slice(0, ROW_SIZE), imdb: rated.length > 0 };
      });
    });
}

/* ---------- Home ---------- */

var homeLoaded = false;

/* How many Home rows load at once. The hero row is first, so the
   hero and the top of the page fill immediately; rows past this
   count load when they near the viewport. */
var HOME_IMMEDIATE_ROWS = 3;

function rowLoadsImmediately(index) {
  return index < HOME_IMMEDIATE_ROWS;
}

/* Loads for Home rows waiting on the viewport, keyed by section. */
var homeRowLoaders = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
var homeRowObserver = null;

function ensureHomeRowObserver() {
  if (homeRowObserver) return homeRowObserver;
  if (typeof IntersectionObserver === "undefined") return null;
  homeRowObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var section = entry.target;
      homeRowObserver.unobserve(section);
      var load = homeRowLoaders ? homeRowLoaders.get(section) : null;
      if (load) {
        homeRowLoaders.delete(section);
        load();
      }
    });
  }, { rootMargin: "800px 0px" });
  return homeRowObserver;
}

/* Decides which row supplies the hero: Trending first, else the
   first non-empty row once Trending has settled. Pure, so the node
   test can drive it. */
function makeHeroPicker() {
  var done = false;
  var trendingDone = false;
  var firstItems = null;
  return {
    /* Offer one row's items. Returns the items the hero should use,
       or null when no hero decision is made yet. */
    consider: function (items, isTrending) {
      if (done) return null;
      if (items && items.length && !firstItems) firstItems = items;
      if (isTrending) trendingDone = true;
      if (items && items.length && (isTrending || trendingDone)) {
        done = true;
        return items;
      }
      if (trendingDone && firstItems) {
        done = true;
        return firstItems;
      }
      return null;
    },
    isDone: function () { return done; }
  };
}

function heroPick(items) {
  if (!items.length) return null;
  var day = Math.floor(Date.now() / 86400000);
  return items[day % Math.min(items.length, 5)];
}

/* The hero skeleton: a scrim plus grey title, text and button
   blocks, rendered into the hero on page load so the top of the
   page is never a tall blank slab while the catalog loads. The
   real hero (or the fallback message, when the catalog fails)
   replaces it. */
function renderHeroSkeleton() {
  var hero = document.getElementById("hero");
  if (!hero) return;
  hero.innerHTML = '<div class="hero-skeleton"><div class="hero-skeleton-content">' +
    '<div class="hero-skeleton-title"></div>' +
    '<div class="hero-skeleton-text"></div>' +
    '<div class="hero-skeleton-text"></div>' +
    '<div class="hero-skeleton-btn"></div>' +
    "</div></div>";
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
  if (heroImg) {
    upgradePoster(heroImg, item, "hero");
    guardThumbnail(heroImg, item, "hero");
  }
  document.getElementById("heroPlay").addEventListener("click", function () { openPlayer(item); });
  document.getElementById("heroDetails").addEventListener("click", function () { openDetails(item); });
  wireExpandableDescs(hero);
}

/* Home shelves show only non-adult titles. The 18+ section calls
   these with adultOnly true and gets only the adult ones, so adult
   viewing never surfaces on Home. */
function continueWatchingItems(adultOnly) {
  return Object.keys(state.history).map(function (id) { return state.history[id]; })
    .filter(function (h) {
      return h.progress > 0 && h.progress < 1 && isAdultEntry(h) === !!adultOnly;
    })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; })
    .map(function (h) {
      return { id: h.id, title: h.title, year: storedYear(h), type: h.type,
        subjects: h.subjects || [], rating: null, downloads: 0,
        file: h.file || null, historyId: h.historyId || null };
    });
}

function watchAgainItems(adultOnly) {
  return Object.keys(state.history).map(function (id) { return state.history[id]; })
    .filter(function (h) {
      return h.progress >= 1 && isAdultEntry(h) === !!adultOnly;
    })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; })
    .map(function (h) {
      return { id: h.id, title: h.title, year: storedYear(h), type: h.type,
        subjects: h.subjects || [], rating: null, downloads: 0,
        file: h.file || null, historyId: h.historyId || null };
    });
}

/* Subject tags that name a medium, a format or a vague bucket, not
   a taste: useless as a recommendation signal. Shared by the
   Because You Watched rows and More Like This. */
var GENERIC_SUBJECT_STOPLIST = ["movies", "feature films", "feature film",
  "movingimage", "video", "pre-code", "public domain", "classic",
  "vhs", "dvd", "colorized"];

/* The Archive query for one catalog type, so recommendations match
   the item they come from instead of always querying movies. */
function typeQueryFor(type) {
  if (type === "show") return "collection:classic_tv";
  if (type === "cartoon") return "(collection:classic_cartoons OR subject:cartoons)";
  return MOVIES;
}

/* The Archive query for a set of types, OR-ed together. */
function typeQueryForTypes(types) {
  var parts = [];
  (types || []).forEach(function (t) {
    var q = typeQueryFor(t);
    if (parts.indexOf(q) === -1) parts.push(q);
  });
  if (!parts.length) return MOVIES;
  if (parts.length === 1) return parts[0];
  return "(" + parts.join(" OR ") + ")";
}

/* The first subject worth recommending on: not stop-listed, not a
   generic show medium tag, and a sane length. */
function firstSignalSubject(subjects) {
  var list = subjects || [];
  for (var i = 0; i < list.length; i++) {
    var s = String(list[i] || "").trim();
    if (!s) continue;
    var low = s.toLowerCase();
    if (GENERIC_SUBJECT_STOPLIST.indexOf(low) !== -1) continue;
    if (GENERIC_SHOW_SUBJECTS.indexOf(low) !== -1) continue;
    if (low.length < 3 || low.length > 40) continue;
    return s;
  }
  return null;
}

/* The user's strongest taste signals: finished titles count 1,
   in-progress titles count a half, likes count 2. Returns the top
   two subjects with the types of the items that seeded them, so a
   user who only watches shows gets show rows, not movie rows. */
function topSignalSubjects() {
  var counts = {};
  var typesBySubject = {};
  function addSubjects(subjects, weight, type) {
    (subjects || []).forEach(function (s) {
      var k = String(s).toLowerCase();
      counts[k] = (counts[k] || 0) + weight;
      if (!typesBySubject[k]) typesBySubject[k] = [];
      if (type && typesBySubject[k].indexOf(type) === -1) typesBySubject[k].push(type);
    });
  }
  Object.keys(state.history).forEach(function (id) {
    var h = state.history[id];
    if (isAdultEntry(h)) return;
    /* An old entry with no flag and no subjects cannot be told
       from its own data; the identity gate catches it when the
       adult pool has loaded. */
    if (adultPoolSet && isInAdultPool(h.title, storedYear(h))) return;
    if (h.progress >= 1) addSubjects(h.subjects, 1, h.type);
    else if (h.progress > 0) addSubjects(h.subjects, 0.5, h.type);
  });
  /* Reactions never stored an adult field, so an old reaction on
     an adult title would seed normal rows. Skip reactions whose
     title is flagged adult in history, or matches the adult pool. */
  var adultHistoryIds = {};
  Object.keys(state.history).forEach(function (id) {
    var h = state.history[id];
    if (isAdultEntry(h)) adultHistoryIds[h.id] = true;
  });
  Object.keys(state.reactions).forEach(function (id) {
    var r = state.reactions[id];
    if (r.value !== 1) return;
    if (isAdultItem(r)) return;
    if (adultHistoryIds[id]) return;
    if (adultPoolSet && isInAdultPool(r.title, r.year)) return;
    addSubjects(r.subjects, 2, r.type);
  });
  return Object.keys(counts)
    .filter(function (k) { return GENERIC_SUBJECT_STOPLIST.indexOf(k) === -1 && k.length > 2 && k.length < 40; })
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, 2)
    .map(function (k) { return { subject: k, types: typesBySubject[k] || ["movie"] }; });
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
  subjects.forEach(function (sig) {
    var label = sig.subject.charAt(0).toUpperCase() + sig.subject.slice(1);
    var s3 = rowEl("Because you watched " + label, "Picked from what you watch and like");
    s3.classList.add("personal-shelf");
    container.appendChild(s3);
    var scroll = s3.querySelector(".row-scroll");
    scroll.innerHTML = '<div class="skeleton-row"><div class="skeleton-card"></div>' +
      '<div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    /* The row matches the seeded items' types, not movies only. */
    searchArchive(typeQueryForTypes(sig.types) + ' AND subject:"' + sig.subject.replace(/"/g, "") + '"',
      { rows: 30, sort: "downloads desc", type: sig.types.length === 1 ? sig.types[0] : undefined })
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
  /* A rebuild drops the old sections, so stop watching them first. */
  if (homeRowObserver) homeRowObserver.disconnect();
  container.innerHTML = "";
  renderPersonalShelves(container);
  var heroPicker = makeHeroPicker();
  var immediateSettled = 0;

  ROW_DEFS.forEach(function (def, index) {
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
        var heroItems = heroPicker.consider(items, def.id === "trending");
        if (heroItems) renderHero(heroPick(heroItems));
        fillRow(section, items, "Nothing found here right now.");
        settleImmediate();
      }).catch(function () {
        /* A failed Trending row still settles the hero decision,
           so the first non-empty row can supply the hero. */
        var heroItems = heroPicker.consider([], def.id === "trending");
        if (heroItems) renderHero(heroPick(heroItems));
        rowError(section, load);
        settleImmediate();
      });
    };
    /* Once every above-the-fold row has settled with no hero, show
       the fallback rather than a blank slab. A below-the-fold row
       that loads later with items can still replace it. */
    function settleImmediate() {
      if (!rowLoadsImmediately(index)) return;
      immediateSettled++;
      if (immediateSettled >= HOME_IMMEDIATE_ROWS && !heroPicker.isDone()) {
        renderHero(null);
      }
    }
    /* The first rows load at once, so the hero and the top of the
       page fill immediately. Rows further down load when they near
       the viewport, so a fresh Home visit fires a handful of
       searches instead of all 17 at once. Without
       IntersectionObserver, every row loads at once as before. */
    if (rowLoadsImmediately(index)) {
      load();
    } else {
      var obs = ensureHomeRowObserver();
      if (obs && homeRowLoaders) {
        homeRowLoaders.set(section, load);
        obs.observe(section);
      } else {
        load();
      }
    }
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
  metaCache = {};
  /* searchInFlight is deliberately left alone: a query already
     running holds data fetched seconds ago, and clearing the map
     would let its late resolve overwrite the fresh cache. */
  homeLoaded = false;
  showView("home");
}

/* ---------- Browse ---------- */

var browseState = { query: "", type: "all", genre: "", sub: "", decade: "",
  year: "", yearFrom: "", yearTo: "",
  minRating: 0, sort: "trending", start: 0, total: 0 };
var searchTimer = null;

/* A tiny request sequencer for Browse. Each run gets a number;
   a response whose number is not the latest is stale and dropped,
   and a run requested while one is in flight is queued for one
   re-run when the flight lands, so a search typed during a slow
   fetch is never silently dropped. Pure, so the node test can
   drive it. */
function makeSequencer() {
  var seq = 0;
  var loading = false;
  var pending = false;
  var pendingReset = false;
  return {
    /* Start a run. Returns its sequence number, or 0 when a run is
       already in flight and this one was queued instead. */
    start: function (reset) {
      seq++;
      if (loading) {
        pending = true;
        if (reset) pendingReset = true;
        return 0;
      }
      loading = true;
      return seq;
    },
    /* True when this sequence number is no longer the latest run,
       so its response must be dropped. */
    isStale: function (s) { return s !== seq; },
    /* End the in-flight run. Returns the queued re-run, if any:
       "reset", "more", or null. */
    finish: function () {
      loading = false;
      var rerun = pending ? (pendingReset ? "reset" : "more") : null;
      pending = false;
      pendingReset = false;
      return rerun;
    },
    isLoading: function () { return loading; }
  };
}

var browseSequencer = makeSequencer();

var YEAR_MIN = 1890;
/* The current year, derived at load so a new year of releases never
   needs a code change. */
var YEAR_MAX = new Date().getFullYear();

function isYear(v) {
  return /^\d{4}$/.test(String(v || "")) &&
    Number(v) >= YEAR_MIN && Number(v) <= YEAR_MAX;
}

/* Does a normalized item's derived release year satisfy the year
   constraints in a browse-state-like object? A year filter only
   ever matches on the derived year, so an item whose indexed year
   is an upload year can never slip through. Items with no
   derivable year fail an active year filter. Pure, so the node
   test can drive it. */
function matchesYearFilter(item, s) {
  var y = item ? item.year : null;
  if (s.decade) {
    var d = String(s.decade).split("-");
    var hi = d[1] ? Number(d[1]) : YEAR_MAX;
    if (y == null || y < Number(d[0]) || y > hi) return false;
  }
  if (s.year && isYear(s.year)) {
    if (y !== Number(s.year)) return false;
  } else if (s.yearFrom || s.yearTo) {
    var from = isYear(s.yearFrom) ? Number(s.yearFrom) : YEAR_MIN;
    var to = isYear(s.yearTo) ? Number(s.yearTo) : YEAR_MAX;
    if (y == null || y < from || y > to) return false;
  }
  return true;
}

function yearFilterActive(s) {
  return !!(s.decade || (s.year && isYear(s.year)) || s.yearFrom || s.yearTo);
}

/* Escape the characters the Archive search treats as operators, so
   a title search for "C++" or "20,000 Leagues" cannot break the
   query or change its meaning. Pure, so the node test can drive it. */
function escapeSearchTerm(term) {
  return String(term).replace(/([+\-=&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

/* Builds the Archive query from a browse state object, so the node smoke
   test can drive it without a DOM. Year, range and decade are all ANDed
   in; a year outside its decade simply matches nothing, and Browse shows
   the honest empty state. Year clauses also match the year in the
   title, because the indexed year field holds upload years for a
   share of items; runBrowse then keeps only items whose derived
   release year really matches. The minimum rating is a server-side
   avg_rating range, so a strict filter does not crawl the catalog
   page by page. Title terms are escaped and AND-ed, so "golden
   age" matches titles with both words, not either. */
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
    parts.push(yearClauseRange(d[0], d[1] || String(YEAR_MAX)));
  }
  if (s.year && isYear(s.year)) {
    parts.push(yearClauseSingle(s.year));
  } else if (s.yearFrom || s.yearTo) {
    var from = isYear(s.yearFrom) ? s.yearFrom : String(YEAR_MIN);
    var to = isYear(s.yearTo) ? s.yearTo : String(YEAR_MAX);
    parts.push(yearClauseRange(from, to));
  }
  if (s.minRating > 0) {
    parts.push("avg_rating:[" + s.minRating + " TO 5]");
  }
  if (s.query) {
    var terms = s.query.trim().split(/\s+/).map(escapeSearchTerm)
      .filter(function (term) { return term.length > 0; });
    if (terms.length) parts.push("title:(" + terms.join(" AND ") + ")");
  }
  return parts.join(" AND ");
}

function browseQuery() {
  return buildBrowseQuery(browseState);
}

/* The server-side sort for a Browse sort choice. Title A to Z and
   the year sorts run on the server (titleSorter and the year
   field, verified live against advancedsearch.php), so they page
   through the whole catalog with Load More instead of capping at
   the first 100 titles. Year order follows the Archive's indexed
   year field, which sometimes holds the upload year; the count
   line says so. */
function sortParamFor(sort) {
  if (sort === "trending") return "downloads desc";
  if (sort === "rated") return "avg_rating desc";
  if (sort === "newest") return "addeddate desc";
  if (sort === "az") return "titleSorter asc";
  if (sort === "year-desc") return "year desc";
  if (sort === "year-asc") return "year asc";
  return "downloads desc";
}

function browseSortParam() {
  return sortParamFor(browseState.sort);
}

/* Client-side re-sort, only for the Top rated sort, where the
   server order and the displayed Archive rating can disagree
   slightly within a page. A to Z and the year sorts are ordered
   by the server now, so they are not re-sorted here: re-sorting
   one page would break the global order. */
function sortClientSide(items) {
  var s = browseState.sort;
  var copy = items.slice();
  if (s === "rated") copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
  return copy;
}

/* Should this item be dropped by the YouTube-rip filter for this
   browse type? Rips are dropped whenever cartoon results are
   included: the "all" type query includes classic cartoons too,
   not just the cartoon type. Only cartoon items are dropped, so
   a movie with a yt- identifier is not caught by it. */
function isYoutubeRipFiltered(item, type) {
  if (type !== "cartoon" && type !== "all") return false;
  return item.type === "cartoon" && isYoutubeRip(item.id);
}

/* The client-side filters for one fetched Browse page, in order:
   YouTube rips, minimum rating, year, hide-watched, not-for-me,
   then the client-side sort. */
function filterBrowseItems(items) {
  items = items.filter(function (it) { return !isYoutubeRipFiltered(it, browseState.type); });
  if (browseState.minRating > 0) {
    items = items.filter(function (it) { return it.rating != null && it.rating >= browseState.minRating; });
  }
  if (yearFilterActive(browseState)) {
    items = items.filter(function (it) { return matchesYearFilter(it, browseState); });
  }
  items = filterVisible(items).filter(function (it) { return reactionOf(it.id) !== -1; });
  return sortClientSide(items);
}

function renderSubChips() {
  var wrap = document.getElementById("subGenreChips");
  wrap.innerHTML = "";
  var g = GENRES[browseState.genre];
  if (!g) return;
  var all = document.createElement("button");
  all.className = "chip" + (browseState.sub === "" ? " active" : "");
  all.setAttribute("aria-pressed", browseState.sub === "" ? "true" : "false");
  all.textContent = "All " + g.label;
  all.addEventListener("click", function () { browseState.sub = ""; runBrowse(true); });
  wrap.appendChild(all);
  g.subs.forEach(function (pair) {
    var chip = document.createElement("button");
    chip.className = "chip" + (browseState.sub === pair[0] ? " active" : "");
    chip.setAttribute("aria-pressed", browseState.sub === pair[0] ? "true" : "false");
    chip.textContent = pair[1];
    chip.addEventListener("click", function () {
      browseState.sub = (browseState.sub === pair[0]) ? "" : pair[0];
      runBrowse(true);
    });
    wrap.appendChild(chip);
  });
}

/* An empty state with one clear next action, never a dead end. */
function emptyStateWithAction(text, btnLabel, onClick) {
  var div = document.createElement("div");
  div.className = "empty-state";
  var p = document.createElement("p");
  p.textContent = text;
  div.appendChild(p);
  var b = document.createElement("button");
  b.className = "btn";
  b.type = "button";
  b.textContent = btnLabel;
  b.addEventListener("click", onClick);
  div.appendChild(b);
  return div;
}

function runBrowse(reset) {
  var seq = browseSequencer.start(reset);
  /* A run requested mid-flight is queued by the sequencer and
     re-runs once below, so a search typed during a slow fetch is
     never silently dropped. */
  if (!seq) return;
  if (reset) { browseState.start = 0; document.getElementById("browseGrid").innerHTML = ""; }
  renderSubChips();
  document.getElementById("browseCount").textContent = "Searching archive.org...";
  var sortParam = browseSortParam();
  function done() {
    var rerun = browseSequencer.finish();
    if (rerun) runBrowse(rerun === "reset");
  }
  /* Fetch one page. When client-side filters empty a page that is
     not the last, fetch the next page instead of adding nothing,
     so Load More never adds zero cards. Bounded, so a filter that
     matches nothing still ends. */
  function fetchPage(emptyPages) {
    searchArchive(browseQuery(), {
      rows: 48,
      start: browseState.start,
      sort: sortParam
    }).then(function (res) {
      if (browseSequencer.isStale(seq)) { done(); return; }
      browseState.total = res.total;
      var items = filterBrowseItems(res.items);
      browseState.start += res.items.length;
      if (!items.length && emptyPages < 4 && browseState.start < res.total) {
        fetchPage(emptyPages + 1);
        return;
      }
      var grid = document.getElementById("browseGrid");
      if (!items.length && grid.querySelectorAll(".card").length === 0) {
        grid.innerHTML = "";
        grid.appendChild(emptyStateWithAction(
          "Nothing matched those filters. Try a different genre, decade, year or search term.",
          "Clear filters",
          function () { document.getElementById("clearFilters").click(); }));
      } else {
        items.forEach(function (it) { grid.appendChild(cardEl(it)); });
      }
      if (!items.length && browseState.start < res.total) {
        toast("No more titles match those filters on the next pages. Try widening them.");
      }
      var shown = grid.querySelectorAll(".card").length;
      /* The total matches the query before personal filters; the
         shown count is what is actually on screen after them. */
      var countText = res.total + " titles match this search. Showing " + shown + " after your filters.";
      if (browseState.sort === "year-desc" || browseState.sort === "year-asc") {
        countText += " Year order follows the Archive year field.";
      }
      document.getElementById("browseCount").textContent = countText;
      document.getElementById("loadMoreBtn").style.display =
        (browseState.start >= res.total) ? "none" : "inline-block";
      done();
    }).catch(function () {
      if (browseSequencer.isStale(seq)) { done(); return; }
      if (browseState.start === 0) {
        document.getElementById("browseCount").textContent = "";
        var grid = document.getElementById("browseGrid");
        grid.innerHTML = "";
        grid.appendChild(emptyStateWithAction(
          "Could not reach archive.org. Check your connection and try again.",
          "Retry",
          function () { runBrowse(true); }));
      } else {
        toast("Could not load more titles. Check your connection and try again.");
      }
      done();
    });
  }
  fetchPage(0);
}

/* ---------- Details sheet ---------- */

var currentDetails = null;

/* opts.adultContext marks details opened from inside the 18+
   section, so More Like This may include adult titles. Callers
   pass it explicitly; the sheet never reads it back from the DOM. */
function openDetails(item, opts) {
  var adultCtx = !!(opts && opts.adultContext);
  currentDetails = item;
  var body = document.getElementById("detailsBody");
  body.innerHTML = "<p>Loading details from archive.org...</p>";
  document.getElementById("detailsSheet").hidden = false;
  document.body.style.overflow = "hidden";
  dialogOpened(dialogElFor("detailsSheet"));

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
    /* Never trust the metadata date on its own: it holds the upload
       date just as often as the release date. Re-derive the release
       year from the full metadata the same way normalizeDoc does. */
    var yearInfo = deriveYearWithSource({ identifier: item.id,
      title: toArray(m.title)[0] || item.title, year: m.year, date: m.date });
    var detYear = yearInfo.year;
    if (detYear == null) detYear = item.year;
    var year = detYear != null ? String(detYear) : "";
    var creator = toArray(m.creator)[0] ? String(toArray(m.creator)[0]) : item.creator;
    var h = state.history[historyKey(item)];
    var progress = h ? h.progress : 0;
    var inList = inMyList(item.id);
    var reaction = reactionOf(item.id);
    var badge = ratingBadge(item);
    var fullItem = {
      id: item.id, title: item.title, year: detYear, type: item.type,
      subjects: subjects.length ? subjects : (item.subjects || []),
      rating: item.rating, downloads: item.downloads
    };

    /* Keep the stored entries honest: an adult title opened here
       gets flagged in My List and in history, so it only ever
       shows inside the 18+ section, even if it was saved or
       watched before the section existed. */
    if (isAdultItem(fullItem)) {
      var flagged = false;
      state.myList.forEach(function (m) {
        if (m.id === fullItem.id && !m.adult) {
          m.adult = true;
          if (!m.subjects || !m.subjects.length) m.subjects = fullItem.subjects;
          flagged = true;
        }
      });
      Object.keys(state.history).forEach(function (k) {
        var h = state.history[k];
        if (h.id === fullItem.id && !h.adult) {
          h.adult = true;
          if (!h.subjects || !h.subjects.length) h.subjects = fullItem.subjects;
          flagged = true;
        }
      });
      if (flagged) saveState();
    }

    /* The meta parts stay in scope so the year cross-check below
       can patch the year in place when OMDb or TMDB disagrees. */
    var metaParts = [year, typeLabel(item.type),
      creator ? "By " + creator : "", runtime,
      badge, h ? "Watched " + h.watchCount + " time" + (h.watchCount === 1 ? "" : "s") : ""]
      .filter(Boolean);

    body.innerHTML =
      '<div class="details-top">' +
      '<div class="details-poster-wrap"><div class="title-card">' + titleCardHtml(item) + "</div>" +
      '<img class="details-poster" src="' + posterUrl(item.id) + '" alt="" onerror="this.style.display=\'none\'"></div>' +
      '<div class="details-info"><h2 id="detailsTitle">' + esc(item.title) + "</h2>" +
      '<p class="details-meta">' + esc(metaParts.join(" · ")) + "</p>" +
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
      '<button class="btn' + (reaction === -1 ? " dislike-active" : "") + '" id="dNope" ' +
      'aria-pressed="' + (reaction === -1 ? "true" : "false") + '">' +
      (reaction === -1 ? "Not for you, noted" : "Not for me") + "</button>" +
      "</div>" +
      '<div class="place-row"><p class="sub">' + esc(placeText(h)) +
      " Your place is saved automatically as you watch.</p></div>" +
      "</div></div>" +
      '<div id="episodeSection" hidden><h3 class="similar-head">Episodes</h3>' +
      '<div id="episodeList" class="episode-list"></div></div>' +
      '<h3 class="similar-head">More Like This</h3>' +
      '<div class="row-viewport"><button class="row-arrow row-arrow-left" type="button" ' +
      'aria-label="Scroll row left" disabled>&#8249;</button>' +
      '<div class="row-scroll" id="similarRow"></div>' +
      '<button class="row-arrow row-arrow-right" type="button" ' +
      'aria-label="Scroll row right" disabled>&#8250;</button></div>';

    var detImg = body.querySelector(".details-poster");
    if (detImg) {
      upgradePoster(detImg, item, "details");
      guardThumbnail(detImg, item, "details");
    }
    document.getElementById("dPlay").addEventListener("click", function () { openPlayer(fullItem); });
    document.getElementById("dDownload").addEventListener("click", function () {
      var url = dl ? downloadUrl(item.id, dl.name) : detailsUrl(item.id);
      window.open(url, "_blank");
      toast(dl ? "Download started from archive.org" : "No video file found, opened the Archive page instead");
    });
    document.getElementById("dList").addEventListener("click", function () {
      toggleMyList(fullItem);
      openDetails(item, { adultContext: adultCtx });
    });
    document.getElementById("dLike").addEventListener("click", function () {
      setReaction(fullItem, 1);
      openDetails(item, { adultContext: adultCtx });
    });
    document.getElementById("dNope").addEventListener("click", function () {
      setReaction(fullItem, -1);
      openDetails(item, { adultContext: adultCtx });
    });
    wireExpandableDescs(body);
    wireRowArrows(body.querySelector(".row-viewport"));
    renderEpisodeSection(item, files, subjects);

    /* A year that came from the year or date field and equals the
       upload year is often the upload year, not the release year.
       With a saved key, cross-check it against OMDb or TMDB by
       title and use the looked-up year when it disagrees. Without
       a key the residual stands, as documented above deriveYear. */
    var uploadYear = yearFromField(m.publicdate) || yearFromField(m.addeddate);
    if (isSuspiciousYear(detYear, yearInfo.source, uploadYear) &&
        (state.omdbKey || state.tmdbKey)) {
      lookupReleaseYear(item.title).then(function (lookedUp) {
        if (!lookedUp || lookedUp === detYear) return;
        if (document.getElementById("detailsSheet").hidden) return;
        if (!currentDetails || currentDetails.id !== item.id) return;
        fullItem.year = lookedUp;
        var metaEl = body.querySelector(".details-meta");
        if (metaEl && metaParts.length && metaParts[0] === String(detYear)) {
          metaParts[0] = String(lookedUp);
          metaEl.textContent = metaParts.join(" · ");
        }
      });
    }

    var similarRow = document.getElementById("similarRow");
    /* Skip generic subjects ("movies", "feature films") that would
       make the row near-random, and match the current item's type
       and collection instead of always querying movies. */
    var topSub = firstSignalSubject(subjects);
    /* More Like This stays adult only when the details were opened
       from inside the 18+ section; the flag arrives with the
       caller, never read back from the DOM. */
    if (topSub) {
      searchArchive(typeQueryFor(item.type) + ' AND subject:"' + topSub.replace(/"/g, "") + '"',
        { rows: 20, sort: "downloads desc", type: item.type, allowAdult: adultCtx })
        .then(function (res) {
          var sims = filterVisible(res.items).filter(function (it) {
            return it.id !== item.id && reactionOf(it.id) !== -1;
          }).slice(0, 12);
          if (!sims.length) {
            similarRow.innerHTML = '<p class="row-error">No close matches found.</p>';
            updateRowArrows(similarRow.closest(".row-viewport"));
            return;
          }
          sims.forEach(function (it) { similarRow.appendChild(cardEl(it, { adultContext: adultCtx })); });
          updateRowArrows(similarRow.closest(".row-viewport"));
        }).catch(function () {
          similarRow.innerHTML = '<p class="row-error">Could not load similar titles.</p>';
          updateRowArrows(similarRow.closest(".row-viewport"));
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
  dialogClosed(dialogElFor("detailsSheet"));
}

/* ---------- Episodes in the details sheet ---------- */
/* Two sources, both real Archive data. A multi-file series item
   lists the episodes inside its own upload, grouped by season
   where the file names carry one. A per-episode upload lists its
   sibling uploads of the same show, found by the show name in the
   title. A show with no episode data anywhere still gets its
   Episodes heading with one line saying so, plus the Play button
   for the main file when one exists, instead of a silent dead end. */

function episodeRowEl(ep, showItem, showName) {
  var btn = document.createElement("button");
  btn.className = "episode-row";
  btn.type = "button";
  var h = episodeHistoryEntry({ id: ep.itemId, file: ep.file || null, historyId: ep.historyId || null });
  var prog = h ? h.progress : 0;
  var label = episodeLabel(ep);
  var title = ep.title || label || "Untitled episode";
  var meta = [];
  if (ep.length) meta.push(formatRuntime(ep.length));
  if (ep.year) meta.push(String(ep.year));
  if (prog >= 1) meta.push("Watched");
  else if (prog > 0) meta.push(Math.round(prog * 100) + "% watched");
  btn.innerHTML =
    '<span class="episode-num">' + esc(label || "") + "</span>" +
    '<span class="episode-main"><span class="episode-title">' + esc(title) + "</span>" +
    (meta.length ? '<span class="episode-meta">' + esc(meta.join(" · ")) + "</span>" : "") + "</span>" +
    (ep.current ? '<span class="episode-current">This one</span>' : "") +
    '<span class="episode-play">' + (prog >= 1 ? "Watch Again" : (prog > 0 ? "Resume" : "Play")) + "</span>";
  btn.setAttribute("aria-label", title + (label && ep.title ? " (" + label + ")" : ""));
  btn.addEventListener("click", function () {
    var name = showName || showItem.title;
    openPlayer({
      id: ep.itemId,
      title: name + (label ? " " + label : "") + (ep.title ? ": " + ep.title : ""),
      year: ep.year != null ? ep.year : showItem.year,
      type: showItem.type || "show",
      subjects: showItem.subjects || [],
      file: ep.file || null,
      historyId: ep.historyId || null
    });
  });
  return btn;
}

function renderEpisodeSection(item, files, subjects) {
  var section = document.getElementById("episodeSection");
  var list = document.getElementById("episodeList");
  /* Shows and cartoon series both get episode lists; episodic
     cartoons are series too. */
  if (!section || !list || (item.type !== "show" && item.type !== "cartoon")) return;
  var showName = deriveShowName(item, subjects);
  var own = episodesFromFiles(item.id, showName, files);
  var shown = false;
  /* One seen-set across both blocks, so an episode listed in the
     upload and again as a sibling upload shows once. */
  var seenEpisodes = {};

  function appendBlock(heading, episodes) {
    episodes = episodes.filter(function (ep) {
      var k = episodeDedupeKey(ep);
      if (!k) return true;
      if (seenEpisodes[k]) return false;
      seenEpisodes[k] = true;
      return true;
    });
    if (!episodes.length) return;
    var groups = groupEpisodes(episodes);
    var head = document.createElement("h4");
    head.className = "episode-source-head";
    head.textContent = heading;
    list.appendChild(head);
    groups.forEach(function (g) {
      var label = g.season != null ? "Season " + g.season :
        (groups.length > 1 ? "Other episodes" : "Episodes");
      var gh = document.createElement("h5");
      gh.className = "episode-group-head";
      gh.textContent = label + " (" + g.episodes.length + ")";
      list.appendChild(gh);
      g.episodes.forEach(function (ep) {
        list.appendChild(episodeRowEl(ep, item, showName));
      });
    });
    shown = true;
    section.hidden = false;
  }

  /* A show with no episode data anywhere still gets its Episodes
     heading, with one line saying why, plus the Play button for
     the main file when one exists. Never a silent dead end. */
  function renderNoEpisodes(message) {
    if (shown) return;
    var msg = document.createElement("p");
    msg.className = "row-error";
    msg.textContent = message;
    list.appendChild(msg);
    if (pickPlayableFile(files)) {
      var play = document.createElement("button");
      play.className = "btn btn-primary";
      play.textContent = "Play";
      play.addEventListener("click", function () { openPlayer(item); });
      list.appendChild(play);
    }
    shown = true;
    section.hidden = false;
  }

  appendBlock("Episodes in this upload", own);
  if (!showName) {
    renderNoEpisodes("No episode list is available for this title on archive.org.");
    return;
  }
  var note = null;
  if (!own.length) {
    note = document.createElement("p");
    note.className = "row-error";
    note.textContent = "Looking for episodes of " + showName + "...";
    list.appendChild(note);
    section.hidden = false;
  }
  /* Sibling uploads of the same show. The normal adult exclusion
     applies here, so an adult tagged upload can never land in a
     show's episode list. Cartoon series search their own
     collection for siblings. */
  var siblingCollection = item.type === "cartoon" ? "collection:classic_cartoons" : "collection:classic_tv";
  searchArchive(siblingCollection + ' AND title:"' + showName.replace(/"/g, "") + '"',
    { rows: 200, sort: "downloads desc", type: item.type })
    .then(function (res) {
      if (note) note.remove();
      /* The sheet may have closed or moved on to another title. */
      if (document.getElementById("detailsSheet").hidden) return;
      if (!currentDetails || currentDetails.id !== item.id) return;
      appendBlock("More episodes of " + showName,
        episodesFromItems(res.items, item.id, showName));
      if (!shown) {
        renderNoEpisodes("No episode list is available for this title on archive.org.");
      }
    }).catch(function () {
      if (note) note.remove();
      if (!shown) {
        renderNoEpisodes("The episode list could not be loaded. Check your connection and reopen this title.");
      }
    });
}

/* ---------- Player sheet ---------- */

var currentPlayer = null;
var currentVideo = null;
var playerMode = "";
var finishHandled = false;
var lastSavedAt = 0;
var lastSavedPos = -1;
/* Stream recovery state. playerOpenToken guards stale metadata
   responses: opening a second episode while the first is still
   loading must not be overwritten by the first response.
   playerCandidates is the ranked list of playable files for the
   current title, tried in order when one errors. */
var playerOpenToken = 0;
var playerCandidates = [];
var playerFileIndex = 0;
var playerSameFileRetried = false;
var playerRecoveryTimer = null;
var playerRecoveredAt = 0;
var RECOVERY_MAX_ATTEMPTS = 3;
var ERROR_RETRY_DELAY_MS = 1500;
var recoveryBudget = makeRetryBudget(RECOVERY_MAX_ATTEMPTS);

/* A stream dying mid-film makes the browser fire "ended" with the
   playhead far from the end. Only a playhead within a few seconds
   of the end counts as genuinely finished. An unknown duration
   can never count: the safe answer is to recover, not to finish. */
var END_FINISH_WINDOW_SECONDS = 10;

function isGenuinelyFinished(video) {
  if (!video) return false;
  var dur = Number(video.duration);
  var pos = Number(video.currentTime);
  if (!dur || isNaN(dur) || !isFinite(dur)) return false;
  if (isNaN(pos)) return false;
  return pos >= dur - END_FINISH_WINDOW_SECONDS;
}

/* A small retry budget: tryUse hands out attempts up to max and
   then says no, reset clears the count. Pure, so the node test can
   drive the recovery counting. */
function makeRetryBudget(max) {
  var attempts = 0;
  return {
    tryUse: function () {
      if (attempts >= max) return false;
      attempts++;
      return true;
    },
    reset: function () { attempts = 0; },
    used: function () { return attempts; }
  };
}

/* Save the video element's real position right now. Pass defer
   true for the steady playback tick, so the persist batches into
   one write every 20 seconds; pause, hide, close, errors and
   recovery save at once. */
function saveVideoPosition(defer) {
  if (!currentPlayer || !currentVideo) return;
  var dur = Number(currentVideo.duration) || 0;
  var pos = Number(currentVideo.currentTime) || 0;
  if (!dur) return;
  recordProgress(currentPlayer, Math.min(1, pos / dur), pos, dur, defer);
  updatePlayerPlace();
}

/* Same, but at most once every 5 seconds while playing, and the
   persist itself deferred, so playback writes storage at most
   every 20 seconds instead of every 5. */
function saveVideoPositionThrottled() {
  if (!currentVideo) return;
  var now = Date.now();
  var pos = Number(currentVideo.currentTime) || 0;
  /* A minute of clean playback past a recovery point clears the
     recovery budget, so separate blips in a long film do not add up. */
  if (recoveryBudget.used() > 0 && pos > playerRecoveredAt + 60) {
    recoveryBudget.reset();
  }
  if (now - lastSavedAt < 5000 && Math.abs(pos - lastSavedPos) < 5) return;
  lastSavedAt = now;
  lastSavedPos = pos;
  saveVideoPosition(true);
}

function updatePlayerPlace() {
  var el = document.getElementById("playerPlace");
  var h = currentPlayer && episodeHistoryEntry(currentPlayer);
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
  playerOpenToken++;
  var token = playerOpenToken;
  currentPlayer = item;
  currentVideo = null;
  finishHandled = false;
  lastSavedAt = 0;
  lastSavedPos = -1;
  playerCandidates = [];
  playerFileIndex = 0;
  playerSameFileRetried = false;
  playerRecoveredAt = 0;
  recoveryBudget.reset();
  clearTimeout(playerRecoveryTimer);
  document.getElementById("playerTitle").textContent = item.title +
    (item.year ? " (" + item.year + ")" : "");
  document.getElementById("playerFrame").innerHTML =
    '<p class="player-loading">Finding a playable file on archive.org...</p>';
  document.getElementById("playerSheet").hidden = false;
  document.body.style.overflow = "hidden";
  dialogOpened(dialogElFor("playerSheet"));
  setPlayerMode("loading");
  updatePlayerPlace();
  getMetadata(item.id).then(function (meta) {
    /* Guarded by the per-open token, not just the item id: episodes
       of one series share an item id, so a late response for the
       first episode opened must never overwrite the second. */
    if (token !== playerOpenToken || !currentPlayer) return;
    var files = meta.files || [];
    if (item.file) {
      /* One episode inside a multi-file series item: play that
         file, not the item's default pick. */
      var found = null;
      for (var i = 0; i < files.length; i++) {
        if (files[i] && files[i].name === item.file) { found = files[i]; break; }
      }
      if (!found || !isPlayableFile(found)) {
        /* Never fall through to the whole-item embed here: it would
           play the item's default video, not the episode. */
        showPlayerError(item, "This episode file is no longer available.");
        return;
      }
      playerCandidates = [found];
      playerFileIndex = 0;
      startNativePlayer(item, found);
      return;
    }
    var candidates = rankedPlayableFiles(files);
    if (candidates.length) {
      playerCandidates = candidates;
      playerFileIndex = 0;
      startNativePlayer(item, candidates[0]);
    } else {
      startEmbedPlayer(item);
    }
  }).catch(function () {
    if (token !== playerOpenToken || !currentPlayer) return;
    /* No metadata, no embed either: when archive.org is down the
       iframe would just be blank. Show the error with a Retry. */
    showPlayerError(item,
      "Could not reach archive.org to find a playable file. Check your connection and try again.",
      function () { openPlayer(item); });
  });
}

/* An error state inside the player frame, with a way back: Retry
   when a retry function is given, else a Back button that closes
   the player. */
function showPlayerError(item, message, retry) {
  currentVideo = null;
  var frame = document.getElementById("playerFrame");
  frame.innerHTML = "";
  var p = document.createElement("p");
  p.className = "player-loading";
  p.textContent = message;
  frame.appendChild(p);
  var btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = retry ? "Retry" : "Back";
  btn.addEventListener("click", function () {
    if (retry) retry();
    else closePlayer();
  });
  frame.appendChild(btn);
  setPlayerMode("loading");
}

function startNativePlayer(item, file) {
  /* Stop any previous video before replacing it, so a failed
     stream stops downloading once its element is gone. */
  if (currentVideo) {
    try { currentVideo.pause(); } catch (e) { /* ignore */ }
    try { currentVideo.removeAttribute("src"); currentVideo.load(); } catch (e) { /* ignore */ }
  }
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
  var resumed = false;
  video.addEventListener("loadedmetadata", function () {
    if (currentVideo !== video) return;
    if (resumed) return;
    resumed = true;
    /* Read the saved place fresh: after a recovery the history
       entry holds the place the stream died at, not the place
       the title opened at. */
    var saved = episodeHistoryEntry(item);
    var at = resumeSeconds(saved, video.duration);
    if (at > 0) {
      try { video.currentTime = at; } catch (e) { /* seek failed, plays from the start */ }
      toast("Resuming from " + formatTime(at));
    }
  });
  video.addEventListener("timeupdate", saveVideoPositionThrottled);
  video.addEventListener("pause", saveVideoPosition);
  video.addEventListener("ended", function () {
    if (currentVideo !== video) return;
    /* A stream dying mid-film fires "ended" too. Only a playhead
       genuinely near the end finishes the title; anything else is
       a dropped stream to recover from. */
    if (!isGenuinelyFinished(video)) { recoverStream(item); return; }
    finishTitle(item);
  });
  video.addEventListener("error", function () {
    if (currentVideo !== video) return;
    onVideoError(item, video);
  });
  var playPromise = null;
  try { playPromise = video.play(); } catch (e) { playPromise = null; }
  if (playPromise && playPromise.catch) {
    playPromise.catch(function () { /* autoplay blocked, press play */ });
  }
}

/* A video error does not abandon native playback at once. Retry
   the same file once after a short delay, then try the next
   playable candidate from the ranked list, and only then fall back
   to the embed player, with a toast explaining why. */
function onVideoError(item, video) {
  if (!currentPlayer || currentPlayer !== item) return;
  saveVideoPosition();
  if (!playerSameFileRetried) {
    playerSameFileRetried = true;
    toast("The stream hiccuped. Trying the same file again...");
    clearTimeout(playerRecoveryTimer);
    playerRecoveryTimer = setTimeout(function () {
      if (!currentPlayer || currentPlayer !== item || currentVideo !== video) return;
      startNativePlayer(item, playerCandidates[playerFileIndex]);
    }, ERROR_RETRY_DELAY_MS);
    return;
  }
  if (playerFileIndex + 1 < playerCandidates.length) {
    playerFileIndex++;
    playerSameFileRetried = false;
    toast("That file would not play. Trying the next copy...");
    startNativePlayer(item, playerCandidates[playerFileIndex]);
    return;
  }
  if (item.file) {
    /* An episode never falls back to the whole-item embed: it
       would play the item's default video, not the episode. */
    showPlayerError(item, "This episode file would not play. Check your connection and try again.");
    return;
  }
  toast("This title would not play here. Opening the Archive player instead.");
  startEmbedPlayer(item);
}

/* A false end: the stream died mid-film and the browser fired
   "ended" with the playhead far from the end. Reload the same
   file, seek back to the saved place, and resume in place. After
   a few tries, fall back to the embed player. */
function recoverStream(item) {
  saveVideoPosition();
  var h = state.history[historyKey(item)];
  playerRecoveredAt = h ? h.position || 0 : 0;
  if (!recoveryBudget.tryUse()) {
    if (item.file) {
      /* An episode never falls back to the whole-item embed: it
         would play the item's default video, not the episode. */
      showPlayerError(item, "The stream kept dropping and this episode file would not play.");
      return;
    }
    toast("The stream kept dropping, so this title is opening in the Archive player instead.");
    startEmbedPlayer(item);
    return;
  }
  toast("The stream dropped. Picking up where you left off...");
  startNativePlayer(item, playerCandidates[playerFileIndex]);
}

function startEmbedPlayer(item) {
  /* Save the place first: the embed player cannot report position,
     so up to 5 seconds would otherwise be lost on the error path. */
  saveVideoPosition();
  if (currentVideo) {
    try { currentVideo.pause(); } catch (e) { /* ignore */ }
    currentVideo = null;
  }
  var frame = document.getElementById("playerFrame");
  frame.innerHTML =
    '<iframe src="' + embedUrl(item.id) + '" allowfullscreen allow="fullscreen"></iframe>';
  setPlayerMode("embed");
}

/* The film ended. Mark it finished, stop everything, re-scan the
   catalog and go back to Home. */
function finishTitle(item) {
  if (finishHandled) return;
  /* Never finish on a false end: a stream that died mid-film fires
     "ended" with the playhead far from the end, and finishing here
     would record progress 1 with position 0 and throw away the
     user's place. Recover the stream instead. Embed mode has no
     video element, so its Finished button always finishes. */
  if (playerMode === "video" && currentVideo && !isGenuinelyFinished(currentVideo)) {
    recoverStream(item);
    return;
  }
  finishHandled = true;
  var dur = currentVideo && Number(currentVideo.duration)
    ? Math.round(Number(currentVideo.duration)) : 0;
  if (!dur) {
    /* Embed mode knows no duration: keep the stored one. */
    var prev = state.history[historyKey(item)];
    dur = prev ? prev.duration || 0 : 0;
  }
  recordProgress(item, 1, 0, dur);
  toast("Finished. Back to Home.");
  stopPlayback();
  document.getElementById("playerSheet").hidden = true;
  document.body.style.overflow = "";
  currentPlayer = null;
  playerMode = "";
  dialogClosed(dialogElFor("playerSheet"));
  /* An update that arrived mid-film reloads now, and the fresh page
     loads the catalog itself, so there is no need to re-scan first. */
  if (reloadForUpdateIfPending()) return;
  refreshPersonalViews();
  rescanCatalog();
}

function stopPlayback() {
  clearTimeout(playerRecoveryTimer);
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
  dialogClosed(dialogElFor("playerSheet"));
  refreshPersonalViews();
  refreshHomePersonal();
  refreshAdultPersonal();
  reloadForUpdateIfPending();
}

/* ---------- My List and History views ---------- */

/* My List entries as card items, split by adult flag. The normal
   list shows only non-adult titles; the 18+ section shows only the
   adult ones. */
function myListItems(adultOnly) {
  return state.myList.filter(function (m) { return !!m.adult === !!adultOnly; })
    .map(function (m) {
      return { id: m.id, title: m.title, year: storedYear(m), type: m.type,
        subjects: [], rating: null, downloads: 0 };
    });
}

/* History entries, newest first, split by adult flag. */
function historyEntries(adultOnly) {
  return Object.keys(state.history).map(function (id) { return state.history[id]; })
    .filter(function (h) { return isAdultEntry(h) === !!adultOnly; })
    .sort(function (a, b) { return b.lastWatchedAt - a.lastWatchedAt; });
}

function renderMyList() {
  var grid = document.getElementById("myListGrid");
  grid.innerHTML = "";
  var saved = myListItems(false);
  var items = filterVisible(saved);
  if (!items.length) {
    grid.appendChild(emptyStateWithAction(
      saved.length
        ? "Your saved titles are all finished and hidden by Hide watched. Turn it off to see them here."
        : "Nothing saved yet. Open any title and tap Add to My List.",
      "Browse titles",
      function () { showView("browse"); }));
    return;
  }
  items.forEach(function (it) { grid.appendChild(cardEl(it)); });
}

function renderHistory() {
  var list = document.getElementById("historyList");
  list.innerHTML = "";
  /* Lazily backfill adult flags for pre-v1.4.0 entries, then
     re-render if any entry was newly flagged adult. Each entry is
     checked at most once per session, so the re-render cannot
     loop. */
  backfillAdultFlags().then(function (changed) {
    if (changed) {
      renderHistory();
      refreshHomePersonal();
      refreshAdultPersonal();
    }
  });
  /* Adult viewing stays inside the 18+ section, never in this list. */
  var entries = historyEntries(false);
  if (!entries.length) {
    list.appendChild(emptyStateWithAction(
      "No history yet. Play something and it shows up here.",
      "Browse titles",
      function () { showView("browse"); }));
    return;
  }
  entries.forEach(function (h) {
    var item = { id: h.id, title: h.title, year: storedYear(h), type: h.type, subjects: h.subjects || [],
      file: h.file || null, historyId: h.historyId || null };
    var div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML =
      '<span class="history-thumb-wrap"><span class="title-card title-card-mini">' + titleCardHtml(item) + "</span>" +
      '<img class="history-thumb" src="' + posterUrl(h.id) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"></span>' +
      '<div class="history-main"><div class="card-title">' + esc(h.title) + "</div>" +
      '<div class="card-meta">' + esc([item.year ? String(item.year) : "", typeLabel(h.type),
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
      delete state.history[h.historyId || h.id];
      saveState();
      renderHistory();
      toast("Removed from history");
    });
    /* History thumbs are never upgraded to real posters, so they get
       the thumbnail guard plus their own error handler: any load
       failure here is the thumbnail failing, and the title card is
       the fallback. */
    var thumb = div.querySelector(".history-thumb");
    if (thumb) {
      thumb.addEventListener("error", function () { rejectThumbnail(thumb, item, "history"); });
      guardThumbnail(thumb, item, "history");
    }
    list.appendChild(div);
  });
}

function refreshPersonalViews() {
  renderMyList();
  renderHistory();
}

/* ---------- Themes ---------- */

/* WCAG 2.1 relative luminance and contrast, for the custom accent
   guard. The old button-text choice used a crude linear luminance
   threshold; a mid-tone pick like the Midnight blue got white text
   at 3.68:1, a fail. These are the real formulas. */

var CONTRAST_MIN = 4.5;
var ACCENT_DARK_TEXT = "#1c1300";
var ACCENT_LIGHT_TEXT = "#ffffff";

function hexToRgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  var n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(rgb) {
  function two(v) {
    var h = Math.max(0, Math.min(255, Math.round(v))).toString(16);
    return h.length === 1 ? "0" + h : h;
  }
  return "#" + two(rgb.r) + two(rgb.g) + two(rgb.b);
}

/* One sRGB channel linearized, per the WCAG definition. */
function linearChannel(c) {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return 0.2126 * linearChannel(rgb.r) +
    0.7152 * linearChannel(rgb.g) +
    0.0722 * linearChannel(rgb.b);
}

/* The WCAG contrast ratio between two hex colors: 1 for identical
   colors, 21 for black against white. Pure, so the node test can
   drive it. Returns null for an unparseable color. */
function contrastBetween(hexA, hexB) {
  var a = hexToRgb(hexA);
  var b = hexToRgb(hexB);
  if (!a || !b) return null;
  var l1 = relativeLuminance(a);
  var l2 = relativeLuminance(b);
  var hi = Math.max(l1, l2);
  var lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/* Mix a hex color toward another by fraction f (0 keeps the color,
   1 is the target). Pure. */
function mixHex(hex, targetHex, f) {
  var a = hexToRgb(hex);
  var b = hexToRgb(targetHex);
  if (!a || !b) return hex;
  return rgbToHex({
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f
  });
}

/* Text color for a background color: the option (white or near-black)
   with the higher WCAG contrast. Used for profile avatars, whose
   background color is fixed, so the best available text wins. */
function accentTextFor(hex) {
  if (!hexToRgb(hex)) return ACCENT_LIGHT_TEXT;
  var white = contrastBetween(ACCENT_LIGHT_TEXT, hex);
  var dark = contrastBetween(ACCENT_DARK_TEXT, hex);
  return white >= dark ? ACCENT_LIGHT_TEXT : ACCENT_DARK_TEXT;
}

/* The button pair for a custom accent: the accent itself (possibly
   shifted) and the text color on it. When one of the two text
   options already passes 4.5:1 on the accent as picked, the accent
   is untouched. When neither passes (a mid-tone pick), the accent
   is darkened toward black (for white text) or lightened toward
   white (for dark text) in 5 percent steps, taking whichever
   direction reaches 4.5:1 with the smaller shift. Pure. */
function accentPairFor(hex) {
  if (!hexToRgb(hex)) return { accent: hex, text: ACCENT_LIGHT_TEXT };
  var white = contrastBetween(ACCENT_LIGHT_TEXT, hex);
  var dark = contrastBetween(ACCENT_DARK_TEXT, hex);
  if (white >= CONTRAST_MIN || dark >= CONTRAST_MIN) {
    return { accent: hex, text: white >= dark ? ACCENT_LIGHT_TEXT : ACCENT_DARK_TEXT };
  }
  for (var step = 1; step <= 20; step++) {
    var f = step * 0.05;
    var darker = mixHex(hex, "#000000", f);
    if (contrastBetween(ACCENT_LIGHT_TEXT, darker) >= CONTRAST_MIN) {
      return { accent: darker, text: ACCENT_LIGHT_TEXT };
    }
    var lighter = mixHex(hex, "#ffffff", f);
    if (contrastBetween(ACCENT_DARK_TEXT, lighter) >= CONTRAST_MIN) {
      return { accent: lighter, text: ACCENT_DARK_TEXT };
    }
  }
  return { accent: "#000000", text: ACCENT_LIGHT_TEXT };
}

/* A text-safe variant of an accent for a surface: the accent used
   as text (kicker, Read more, episode numbers, focus ring) must
   pass 4.5:1 on the surface it sits on. On a dark surface the
   accent is lightened; on a light surface it is darkened, in 5
   percent steps until it passes. An accent that already passes
   comes back unchanged. Pure. */
function accentTextSafeFor(accentHex, surfaceHex) {
  if (!hexToRgb(accentHex) || !hexToRgb(surfaceHex)) return accentHex;
  if (contrastBetween(accentHex, surfaceHex) >= CONTRAST_MIN) return accentHex;
  var surfaceLum = relativeLuminance(hexToRgb(surfaceHex));
  var target = surfaceLum < 0.5 ? "#ffffff" : "#000000";
  for (var step = 1; step <= 20; step++) {
    var variant = mixHex(accentHex, target, step * 0.05);
    if (contrastBetween(variant, surfaceHex) >= CONTRAST_MIN) return variant;
  }
  return target;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme || "flix");
  if (state.customAccent) {
    /* The custom accent is guarded: the button pair passes 4.5:1,
       and a text-safe variant is derived for the accent-as-text
       selectors, read against the theme's card surface. The six
       built-in themes never reach this branch, so their looks are
       untouched, and clearing a custom accent removes the inline
       overrides so the theme's own values come back. */
    var pair = accentPairFor(state.customAccent);
    document.documentElement.style.setProperty("--accent", pair.accent);
    document.documentElement.style.setProperty("--accent-text", pair.text);
    var surface = "";
    if (typeof getComputedStyle === "function") {
      surface = getComputedStyle(document.documentElement)
        .getPropertyValue("--card").trim();
    }
    if (!hexToRgb(surface)) surface = state.theme === "light" ? "#ffffff" : "#1c1c1c";
    document.documentElement.style.setProperty("--accent-text-safe",
      accentTextSafeFor(pair.accent, surface));
  } else {
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-text");
    document.documentElement.style.removeProperty("--accent-text-safe");
  }
  applyDensity();
  renderDensityButtons();
  document.querySelectorAll(".theme-btn").forEach(function (b) {
    b.classList.toggle("active", b.dataset.theme === state.theme);
  });
  var picker = document.getElementById("accentPicker");
  if (picker && state.customAccent) picker.value = state.customAccent;
}

/* ---------- Density ---------- */
/* Comfortable is the roomy default; Compact shrinks cards and gaps
   for scanning long grids. Persisted per profile, like the theme,
   and applied through html[data-density="compact"]. */

/* The data-density value for a stored density: "compact", or null
   (no attribute) for Comfortable and anything unknown. Pure, so
   the node test can drive it. */
function densityAttrFor(density) {
  return density === "compact" ? "compact" : null;
}

function applyDensity() {
  var attr = densityAttrFor(state && state.density);
  if (attr) document.documentElement.setAttribute("data-density", attr);
  else document.documentElement.removeAttribute("data-density");
}

function renderDensityButtons() {
  var comfortable = document.getElementById("densityComfortable");
  var compact = document.getElementById("densityCompact");
  if (!comfortable || !compact) return;
  var isCompact = state && state.density === "compact";
  comfortable.classList.toggle("btn-primary", !isCompact);
  compact.classList.toggle("btn-primary", isCompact);
  comfortable.setAttribute("aria-pressed", isCompact ? "false" : "true");
  compact.setAttribute("aria-pressed", isCompact ? "true" : "false");
}

function setDensity(density) {
  state.density = density === "compact" ? "compact" : "comfortable";
  saveState();
  applyDensity();
  renderDensityButtons();
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

/* ---------- Profiles UI ---------- */

var profileEntered = false;

function avatarLetter(name) {
  var n = cleanProfileName(name);
  return n ? n.charAt(0).toUpperCase() : "?";
}

function updateProfileButton() {
  var p = activeProfile();
  var btn = document.getElementById("profileBtn");
  var avatar = document.getElementById("profileAvatar");
  var name = document.getElementById("profileName");
  if (!p || !btn || !avatar || !name) return;
  avatar.textContent = avatarLetter(p.name);
  avatar.style.background = p.color;
  avatar.style.color = accentTextFor(p.color);
  name.textContent = p.name;
  btn.setAttribute("aria-label", "Switch profile, currently " + p.name);
  /* A longer or shorter name can wrap the topbar, which moves the
     pull-to-refresh pill's anchor. */
  syncPtrTop();
}

function renderProfileTiles() {
  var wrap = document.getElementById("profileTiles");
  wrap.innerHTML = "";
  profilesStore.profiles.forEach(function (p) {
    var tile = document.createElement("button");
    tile.className = "profile-tile";
    tile.innerHTML =
      '<span class="profile-tile-avatar" style="background:' + esc(p.color) +
      ";color:" + esc(accentTextFor(p.color)) + '">' + esc(avatarLetter(p.name)) + "</span>" +
      '<span class="profile-tile-name">' + esc(p.name) + "</span>" +
      (isPinLocked(p) ? '<span class="profile-tile-lock">Locked</span>' : "");
    tile.addEventListener("click", function () {
      if (isPinLocked(p)) {
        openPinSheet({ mode: "unlock", profileId: p.id, allowCancel: true });
      } else {
        enterProfile(p.id);
      }
    });
    wrap.appendChild(tile);
  });
  if (profilesStore.profiles.length < MAX_PROFILES) {
    var add = document.createElement("button");
    add.className = "profile-tile profile-tile-add";
    add.innerHTML = '<span class="profile-tile-avatar profile-tile-plus">+</span>' +
      '<span class="profile-tile-name">Add profile</span>';
    add.addEventListener("click", function () {
      document.getElementById("profileAddRow").hidden = false;
      document.getElementById("profileNameInput").focus();
    });
    wrap.appendChild(add);
  }
}

function openPicker(canClose) {
  renderProfileTiles();
  document.getElementById("profileAddRow").hidden = true;
  document.getElementById("profileNameInput").value = "";
  document.getElementById("pickerClose").hidden = !canClose;
  document.getElementById("profileManageBtn").hidden = !profileEntered;
  document.getElementById("profilePicker").hidden = false;
  document.body.style.overflow = "hidden";
  dialogOpened(dialogElFor("profilePicker"));
}

function closePicker() {
  if (!profileEntered) return;
  document.getElementById("profilePicker").hidden = true;
  document.body.style.overflow = "";
  dialogClosed(dialogElFor("profilePicker"));
}

/* The 18+ rows, the 18+ unlock and the Browse grid all belong to
   one profile. A switch invalidates them: the adult rows reload
   on next entry, the section locks again, and Browse re-runs when
   it is next entered instead of showing the last profile's
   progress badges. */
var browseStaleAfterSwitch = false;

function markProfileChanged() {
  adultLoaded = false;
  adultUnlocked = false;
  browseStaleAfterSwitch = true;
}

/* Minimal hash routing for the manifest shortcuts (Browse and My
   List point at ./index.html#browse and ./index.html#mylist).
   Read on load only, the first time a profile is entered: the
   matching view opens instead of Home. Navigation never writes
   the hash, and later profile switches ignore it. */
function viewForHash(hash) {
  if (hash === "#browse") return "browse";
  if (hash === "#mylist") return "mylist";
  return null;
}

var initialHashConsumed = false;

function consumeInitialHash() {
  if (initialHashConsumed) return null;
  initialHashConsumed = true;
  if (typeof window === "undefined" || !window.location) return null;
  return viewForHash(window.location.hash);
}

/* Enter a profile (its PIN, if any, was already checked by the
   caller). Re-renders the home rows with this profile's progress,
   so a switch never shows the last profile's shelves. */
function enterProfile(id) {
  if (!switchProfile(id)) return;
  markProfileChanged();
  profileEntered = true;
  document.getElementById("profilePicker").hidden = true;
  document.body.style.overflow = "";
  dialogClosed(dialogElFor("profilePicker"));
  applyTheme();
  renderThemePresets();
  syncHideWatchedBoxes();
  updateProfileButton();
  var wasLoaded = homeLoaded;
  showView("home");
  var hashView = consumeInitialHash();
  if (hashView) showView(hashView);
  if (wasLoaded) loadHome();
  refreshPersonalViews();
  /* Backfill adult flags for this profile's pre-v1.4.0 entries,
     then re-render the personal views if any entry was flagged. */
  backfillAdultFlags().then(function (changed) {
    if (changed) {
      refreshPersonalViews();
      refreshHomePersonal();
      refreshAdultPersonal();
    }
  });
}

/* PIN pad. Modes:
   unlock: check the PIN, then enter the profile.
   verify: check the PIN, then run pinContext.onSuccess.
   set: enter a new PIN twice, then set it.
   change: check the current PIN, then the set flow.
   remove: check the current PIN, then remove it. */
var pinContext = null;
var pinEntry = "";
var pinFirstEntry = "";
var pinChecking = false;

function pinDotsUpdate() {
  var dots = document.querySelectorAll("#pinDots .pin-dot");
  Array.prototype.forEach.call(dots, function (d, i) {
    d.classList.toggle("filled", i < pinEntry.length);
  });
}

function pinShowError(msg) {
  var el = document.getElementById("pinError");
  el.textContent = msg;
  el.hidden = false;
  var sheet = document.querySelector(".pin-sheet");
  sheet.classList.remove("pin-shake");
  void sheet.offsetWidth; /* restart the shake animation */
  sheet.classList.add("pin-shake");
}

function pinClearError() {
  document.getElementById("pinError").hidden = true;
}

function pinSetTitle(title, sub) {
  document.getElementById("pinTitle").textContent = title;
  document.getElementById("pinSub").textContent = sub || "";
}

function openPinSheet(ctx) {
  pinContext = ctx;
  pinEntry = "";
  pinFirstEntry = "";
  pinClearError();
  pinDotsUpdate();
  var p = findProfile(ctx.profileId);
  var name = p ? p.name : "";
  document.getElementById("pinClose").hidden = !ctx.allowCancel;
  document.getElementById("pinForgotBtn").hidden = ctx.mode !== "unlock";
  if (ctx.mode === "unlock") pinSetTitle("Enter PIN", "Unlock " + name + " to open this profile.");
  else if (ctx.mode === "verify") pinSetTitle("Enter PIN", "Confirm the PIN for " + name + ".");
  else if (ctx.mode === "set") pinSetTitle("Set a PIN", "Choose 4 digits to lock " + name + ".");
  else if (ctx.mode === "change") pinSetTitle("Enter current PIN", "Confirm the current PIN for " + name + " first.");
  else if (ctx.mode === "remove") pinSetTitle("Enter current PIN", "Confirm the current PIN for " + name + " to remove the lock.");
  document.getElementById("pinSheet").hidden = false;
  dialogOpened(dialogElFor("pinSheet"));
  if (pinIsBlocked(ctx.profileId)) pinShowError(pinBlockedMessage(ctx.profileId));
}

/* The lockout message for a blocked profile, or null. */
function pinBlockedMessage(id) {
  var remaining = pinLockoutRemainingMs(id);
  if (!remaining) return null;
  var secs = Math.ceil(remaining / 1000);
  return "Too many wrong PINs. Try again in " + secs + " second" + (secs === 1 ? "" : "s") + ".";
}

function pinKey(digit) {
  if (!pinContext || pinChecking || pinEntry.length >= 4) return;
  if (pinIsBlocked(pinContext.profileId)) {
    pinShowError(pinBlockedMessage(pinContext.profileId));
    return;
  }
  pinClearError();
  pinEntry += digit;
  pinDotsUpdate();
  if (pinEntry.length === 4) {
    var entered = pinEntry;
    pinEntry = "";
    pinDotsUpdate();
    pinSubmit(entered);
  }
}

function pinBackspace() {
  if (!pinContext || !pinEntry.length) return;
  pinEntry = pinEntry.slice(0, -1);
  pinDotsUpdate();
}

/* Hide the PIN pad and restore focus to whatever opened it. Every
   hide site goes through here (close, unlock, verify, remove, set,
   forgot), so focus is never left on a destroyed pad. */
function hidePinSheet() {
  document.getElementById("pinSheet").hidden = true;
  dialogClosed(dialogElFor("pinSheet"));
}

function closePinSheet() {
  if (pinContext && !pinContext.allowCancel) return;
  hidePinSheet();
  pinContext = null;
  pinEntry = "";
}

function pinSubmit(entered) {
  var ctx = pinContext;
  if (!ctx || pinChecking) return;
  var p = findProfile(ctx.profileId);
  if (!p) { closePinSheet(); return; }
  if (ctx.mode === "unlock" || ctx.mode === "verify" || ctx.mode === "change" || ctx.mode === "remove") {
    if (pinIsBlocked(p.id)) {
      pinShowError(pinBlockedMessage(p.id));
      return;
    }
    /* PIN checks are async now (SHA-256), so the pad ignores
       further input until this check settles. */
    pinChecking = true;
    checkProfilePin(p.id, entered).then(function (ok) {
      pinChecking = false;
      if (!pinContext || pinContext !== ctx) return;
      if (!ok) {
        var fails = pinAttemptFailed(p.id);
        if (fails >= PIN_MAX_ATTEMPTS) {
          pinShowError("Too many wrong PINs. This profile is locked for a minute.");
        } else {
          var secs = Math.ceil(pinLockoutRemainingMs(p.id) / 1000);
          pinShowError("Wrong PIN, try again in " + secs + " second" + (secs === 1 ? "" : "s") + ".");
        }
        return;
      }
      pinAttemptSucceeded(p.id);
      if (ctx.mode === "unlock") {
        hidePinSheet();
        pinContext = null;
        enterProfile(p.id);
        return;
      }
      if (ctx.mode === "verify") {
        hidePinSheet();
        var cb = ctx.onSuccess;
        pinContext = null;
        if (cb) cb();
        return;
      }
      if (ctx.mode === "remove") {
        var hadAdult = !!(p.data && p.data.adultEnabled);
        removeProfilePin(p.id);
        hidePinSheet();
        pinContext = null;
        renderProfileList();
        updateAdultNav();
        renderAdultSettings();
        toast(hadAdult
          ? "PIN removed for " + p.name + ". The 18+ section is off for this profile."
          : "PIN removed for " + p.name);
        return;
      }
      /* change: current PIN checked, move to the set flow. */
      ctx.mode = "set";
      ctx.step = "new";
      pinSetTitle("Set a new PIN", "Choose 4 new digits for " + p.name + ".");
    });
    return;
  }
  if (ctx.mode === "set") {
    if (ctx.step !== "confirm") {
      pinFirstEntry = entered;
      ctx.step = "confirm";
      pinSetTitle("Confirm PIN", "Enter the same 4 digits again.");
      return;
    }
    if (entered !== pinFirstEntry) {
      ctx.step = "new";
      pinFirstEntry = "";
      pinSetTitle("Set a PIN", "Choose 4 digits to lock " + p.name + ".");
      pinShowError("Those did not match, try again.");
      return;
    }
    pinChecking = true;
    setProfilePin(p.id, entered).then(function (set) {
      pinChecking = false;
      if (!pinContext || pinContext !== ctx) return;
      if (!set) {
        pinShowError("That PIN could not be saved, try again.");
        return;
      }
      hidePinSheet();
      var cb = ctx.onSuccess;
      pinContext = null;
      renderProfileList();
      toast("PIN set for " + p.name);
      if (cb) cb();
    });
  }
}

/* Forgot PIN: erase that profile's history, My List and likes and
   remove the lock, so a forgotten PIN never exposes the profile and
   never locks the app. Two taps, like the delete buttons. */
var forgotArmed = false;

function pinForgot() {
  if (!pinContext) return;
  var btn = document.getElementById("pinForgotBtn");
  var p = findProfile(pinContext.profileId);
  if (!p) return;
  if (!forgotArmed) {
    forgotArmed = true;
    btn.textContent = "Tap again to erase this profile's data and remove its lock";
    setTimeout(function () {
      forgotArmed = false;
      btn.textContent = "Forgot PIN?";
    }, 5000);
    return;
  }
  forgotArmed = false;
  btn.textContent = "Forgot PIN?";
  resetProfileData(p.id);
  hidePinSheet();
  pinContext = null;
  enterProfile(p.id);
  toast("Profile reset, its history and My List were erased");
}

function renderProfileList() {
  var wrap = document.getElementById("profileList");
  if (!wrap) return;
  wrap.innerHTML = "";
  profilesStore.profiles.forEach(function (p) {
    var row = document.createElement("div");
    row.className = "profile-row";
    var locked = isPinLocked(p);
    var isActive = p.id === profilesStore.activeId;
    row.innerHTML =
      '<span class="profile-avatar" style="background:' + esc(p.color) +
      ";color:" + esc(accentTextFor(p.color)) + '">' + esc(avatarLetter(p.name)) + "</span>" +
      '<span class="profile-row-main"><span class="profile-row-name">' + esc(p.name) + "</span>" +
      '<span class="profile-row-sub">' +
      (isActive ? "This profile" : "") +
      (isActive && locked ? " · " : "") +
      (locked ? "PIN locked" : "") +
      (!isActive && !locked ? "Not locked" : "") + "</span></span>" +
      '<span class="profile-row-btns"></span>';
    var btns = row.querySelector(".profile-row-btns");
    /* Locked profiles ask for their PIN before they can be changed,
       so one person cannot rename, unlock or delete someone else's
       profile. */
    function gated(fn) {
      if (locked) openPinSheet({ mode: "verify", profileId: p.id, allowCancel: true, onSuccess: fn });
      else fn();
    }
    if (!isActive) {
      var switchBtn = document.createElement("button");
      switchBtn.className = "btn small btn-primary";
      switchBtn.textContent = "Switch";
      switchBtn.addEventListener("click", function () {
        if (locked) openPinSheet({ mode: "unlock", profileId: p.id, allowCancel: true });
        else enterProfile(p.id);
      });
      btns.appendChild(switchBtn);
    }
    var renameBtn = document.createElement("button");
    renameBtn.className = "btn small";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", function () {
      gated(function () { startProfileRename(row, p); });
    });
    btns.appendChild(renameBtn);
    if (!locked) {
      var setBtn = document.createElement("button");
      setBtn.className = "btn small";
      setBtn.textContent = "Set PIN";
      setBtn.addEventListener("click", function () {
        openPinSheet({ mode: "set", step: "new", profileId: p.id, allowCancel: true });
      });
      btns.appendChild(setBtn);
    } else {
      var changeBtn = document.createElement("button");
      changeBtn.className = "btn small";
      changeBtn.textContent = "Change PIN";
      changeBtn.addEventListener("click", function () {
        openPinSheet({ mode: "change", profileId: p.id, allowCancel: true });
      });
      btns.appendChild(changeBtn);
      var removeBtn = document.createElement("button");
      removeBtn.className = "btn small btn-ghost";
      removeBtn.textContent = "Remove PIN";
      removeBtn.addEventListener("click", function () {
        openPinSheet({ mode: "remove", profileId: p.id, allowCancel: true });
      });
      btns.appendChild(removeBtn);
    }
    var delBtn = document.createElement("button");
    delBtn.className = "btn small btn-danger";
    delBtn.textContent = "Delete";
    var armed = false;
    delBtn.addEventListener("click", function () {
      if (profilesStore.profiles.length <= 1) { toast("You need at least one profile"); return; }
      if (!armed) {
        armed = true;
        delBtn.textContent = "Tap again to delete";
        setTimeout(function () { armed = false; delBtn.textContent = "Delete"; }, 5000);
        return;
      }
      gated(function () {
        var wasActive = p.id === profilesStore.activeId;
        deleteProfile(p.id);
        renderProfileList();
        updateProfileButton();
        updateAdultNav();
        renderAdultSettings();
        if (wasActive) {
          markProfileChanged();
          applyTheme();
          renderThemePresets();
          syncHideWatchedBoxes();
          if (homeLoaded) loadHome();
          refreshPersonalViews();
        }
        toast("Profile deleted");
      });
    });
    btns.appendChild(delBtn);
    wrap.appendChild(row);
  });
  var addBtn = document.getElementById("addProfileBtn");
  if (addBtn) {
    addBtn.disabled = profilesStore.profiles.length >= MAX_PROFILES;
    addBtn.textContent = profilesStore.profiles.length >= MAX_PROFILES ?
      "5 profiles is the most" : "Add a profile";
  }
}

function startProfileRename(row, p) {
  var main = row.querySelector(".profile-row-main");
  var input = document.createElement("input");
  input.type = "text";
  input.className = "profile-rename-input";
  input.value = p.name;
  input.maxLength = 20;
  input.setAttribute("aria-label", "Profile name");
  var save = document.createElement("button");
  save.className = "btn small btn-primary";
  save.textContent = "Save";
  function commit() {
    if (renameProfile(p.id, input.value)) {
      renderProfileList();
      updateProfileButton();
      toast("Profile renamed");
    } else {
      toast("Pick a name first");
      input.focus();
    }
  }
  save.addEventListener("click", commit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") renderProfileList();
  });
  main.innerHTML = "";
  main.appendChild(input);
  main.appendChild(save);
  input.focus();
  input.select();
}

/* ---------- Navigation ---------- */

function showView(name) {
  /* The 18+ section is gated here, the one choke point for entering
     a view: disabled profiles go Home, and a locked profile must
     enter its PIN first. The unlock lasts only while the section
     stays open; leaving it locks it again. */
  if (name === "adult") {
    var access = adultAccess(activeProfile(), adultUnlocked);
    if (access === "disabled") { showView("home"); return; }
    if (access === "needs-pin-setup") {
      /* Enabled with no PIN: a hole from an old backup or an old
         build. Prompt to set a PIN instead of opening the section. */
      var p0 = activeProfile();
      toast("Set a PIN for this profile first, so the 18+ section stays private.");
      openPinSheet({ mode: "set", profileId: p0.id, allowCancel: true,
        onSuccess: function () { adultUnlocked = true; showView("adult"); } });
      return;
    }
    if (access === "needs-pin") {
      var p = activeProfile();
      openPinSheet({ mode: "verify", profileId: p.id, allowCancel: true,
        onSuccess: function () { adultUnlocked = true; showView("adult"); } });
      return;
    }
  }
  if (name !== "adult") adultUnlocked = false;
  document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
  document.getElementById(name + "View").classList.add("active");
  document.querySelectorAll(".navbtn").forEach(function (b) {
    b.classList.toggle("active", b.dataset.view === name);
  });
  window.scrollTo(0, 0);
  if (name === "home" && !homeLoaded) loadHome();
  if (name === "home") wireExpandableDescs(document.getElementById("hero"));
  if (name === "browse" && (document.getElementById("browseGrid").children.length === 0 ||
      browseStaleAfterSwitch)) {
    browseStaleAfterSwitch = false;
    runBrowse(true);
  }
  if (name === "mylist") renderMyList();
  if (name === "history") renderHistory();
  if (name === "adult") {
    if (!adultLoaded) loadAdult();
    else refreshAdultPersonal();
  }
  if (name === "settings") {
    renderThemePresets();
    renderProfileList();
    renderAdultSettings();
    renderProviderWarnings();
    renderBackupNote();
  }
  updateAdultNav();
}

/* ---------- Adult 18+ section ---------- */
/* Private by design. The section is hidden unless this profile
   enabled it in Settings, enabling needs an 18+ confirmation and a
   profile PIN, and opening it needs the PIN again. Adult titles
   appear only here: every other query excludes them, and the home
   shelves, My List and History filter them out. */

var ADULT_ROW_DEFS = [
  { id: "adult-all", title: "18+ Films", subtitle: "Every adults only film in the Archive's feature collection",
    q: MOVIES + " AND " + ADULT_QUERY, sort: "downloads desc", allowAdult: true },
  { id: "adult-erotica", title: "Erotica",
    q: MOVIES + " AND subject:(erotica OR erotic)", sort: "downloads desc", allowAdult: true },
  { id: "adult-sexploit", title: "Sexploitation",
    q: MOVIES + " AND subject:(sexploitation OR softcore)", sort: "downloads desc", allowAdult: true },
  { id: "adult-sexcomedy", title: "Sex Comedies",
    q: MOVIES + ' AND subject:"sex comedy"', sort: "downloads desc", allowAdult: true },
  { id: "adult-nudie", title: "Nudie Classics",
    q: MOVIES + ' AND subject:(nudie OR "adults only")', sort: "downloads desc", allowAdult: true },
  /* Adult animation gets its own row instead of sitting mixed in
     with the live action films. Small but real: 2 titles verified
     live 2026-11-15 (Aachi and Ssipak, Tarzoon). */
  { id: "adult-animation", title: "Adult Animation", subtitle: "Animated adults only titles, kept apart from the live action rows",
    q: MOVIES + " AND subject:animation AND " + ADULT_QUERY, sort: "downloads desc", allowAdult: true, type: "cartoon" }
];

var adultLoaded = false;
var adultUnlocked = false;

function adultEnabled() {
  return !!(state && state.adultEnabled);
}

function updateAdultNav() {
  var btn = document.getElementById("adultNavBtn");
  if (btn) btn.hidden = !adultEnabled();
  /* Showing or hiding the 18+ button can wrap the topbar, which
     moves the pull-to-refresh pill's anchor. */
  syncPtrTop();
}

/* Pure gate check, for the node test: can this profile open the
   section right now? Returns "ok", "needs-pin", "needs-pin-setup",
   or "disabled". The section needs a PIN whenever it is enabled:
   a profile with the section on and no PIN gets "needs-pin-setup"
   and is prompted to set one, never let straight in. */
function adultAccess(profile, unlocked) {
  if (!profile || !profile.data || !profile.data.adultEnabled) return "disabled";
  if (!isPinLocked(profile)) return "needs-pin-setup";
  if (!unlocked) return "needs-pin";
  return "ok";
}

function renderAdultPersonal(container) {
  var cw = continueWatchingItems(true);
  if (cw.length) {
    var s1 = rowEl("Continue Watching", "Pick up where you left off");
    s1.classList.add("adult-personal");
    container.appendChild(s1);
    fillRow(s1, cw, null, { adultContext: true });
  }
  var wa = watchAgainItems(true);
  if (wa.length) {
    var s2 = rowEl("Watch Again", "Finished titles, ready for another round");
    s2.classList.add("adult-personal");
    container.appendChild(s2);
    fillRow(s2, wa, null, { adultContext: true });
  }
  var ml = myListItems(true);
  if (ml.length) {
    var s3 = rowEl("My 18+ List", "Titles you saved from this section");
    s3.classList.add("adult-personal");
    container.appendChild(s3);
    fillRow(s3, ml, null, { adultContext: true });
  }
}

function loadAdult() {
  var container = document.getElementById("adultRows");
  container.innerHTML = "";
  renderAdultPersonal(container);
  ADULT_ROW_DEFS.forEach(function (def) {
    var section = rowEl(def.title, def.subtitle || "");
    container.appendChild(section);
    var scroll = section.querySelector(".row-scroll");
    scroll.innerHTML = '<div class="skeleton-row"><div class="skeleton-card"></div>' +
      '<div class="skeleton-card"></div><div class="skeleton-card"></div></div>';
    var load = function () {
      loadRow(def).then(function (result) {
        var items = result.items || result;
        items = filterVisible(items).filter(function (it) { return reactionOf(it.id) !== -1; });
        fillRow(section, items, "Nothing found here right now.", { adultContext: true });
      }).catch(function () {
        rowError(section, load);
      });
    };
    load();
  });
  adultLoaded = true;
}

/* Re-render just the 18+ personal shelves without touching the
   catalog rows. Used when the section opens and after closing the
   player, so Continue Watching shows the latest place. */
function refreshAdultPersonal() {
  var container = document.getElementById("adultRows");
  if (!container || !adultLoaded) return;
  var old = container.querySelectorAll(".adult-personal");
  Array.prototype.forEach.call(old, function (s) { s.remove(); });
  var temp = document.createElement("div");
  renderAdultPersonal(temp);
  var ref = container.firstChild;
  while (temp.firstChild) container.insertBefore(temp.firstChild, ref);
}

/* Settings block for the section. Re-rendered whenever Settings
   opens, so it always reflects the current profile. */
function renderAdultSettings() {
  var wrap = document.getElementById("adultSettings");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!adultEnabled()) {
    var p = document.createElement("p");
    p.className = "sub";
    p.textContent = "Off for this profile. Turn it on to add a private 18+ area " +
      "with adults only films from archive.org. Nothing from it ever appears " +
      "on Home, in Browse, in search, or in any other profile.";
    wrap.appendChild(p);
    var btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.id = "adultEnableBtn";
    btn.textContent = "Turn on 18+ section";
    btn.addEventListener("click", startAdultEnable);
    var row = document.createElement("div");
    row.className = "key-row";
    row.appendChild(btn);
    wrap.appendChild(row);
    var confirm = document.createElement("div");
    confirm.className = "adult-confirm";
    confirm.id = "adultConfirmRow";
    confirm.hidden = true;
    confirm.innerHTML =
      '<label class="adult-check"><input type="checkbox" id="adultAgeCheck"> ' +
      "I confirm I am 18 years or older.</label>" +
      '<button class="btn btn-primary" id="adultConfirmBtn" disabled>Enable 18+ section</button>';
    wrap.appendChild(confirm);
    var check = confirm.querySelector("#adultAgeCheck");
    var confirmBtn = confirm.querySelector("#adultConfirmBtn");
    check.addEventListener("change", function () { confirmBtn.disabled = !check.checked; });
    confirmBtn.addEventListener("click", confirmAdultEnable);
    return;
  }
  var on = document.createElement("p");
  on.className = "sub";
  on.textContent = "On for this profile. Open it from the 18+ button in the top bar. " +
    "Opening it asks for this profile's PIN.";
  wrap.appendChild(on);
  var row2 = document.createElement("div");
  row2.className = "key-row";
  var open = document.createElement("button");
  open.className = "btn btn-primary";
  open.textContent = "Open 18+ section";
  open.addEventListener("click", function () { showView("adult"); });
  var off = document.createElement("button");
  off.className = "btn btn-ghost";
  off.textContent = "Turn off 18+ section";
  off.addEventListener("click", disableAdultSection);
  row2.appendChild(open);
  row2.appendChild(off);
  wrap.appendChild(row2);
}

/* Enabling needs a PIN first: without one there is nothing keeping
   the section private. After the PIN is set, the 18+ confirmation
   appears. */
function startAdultEnable() {
  var p = activeProfile();
  if (!p) return;
  if (!isPinLocked(p)) {
    toast("Set a PIN for this profile first, so the 18+ section stays private.");
    openPinSheet({ mode: "set", profileId: p.id, allowCancel: true,
      onSuccess: function () { showAdultConfirm(); } });
    return;
  }
  showAdultConfirm();
}

function showAdultConfirm() {
  var row = document.getElementById("adultConfirmRow");
  if (!row) return;
  row.hidden = false;
  var check = document.getElementById("adultAgeCheck");
  if (check) check.focus();
}

function confirmAdultEnable() {
  var check = document.getElementById("adultAgeCheck");
  if (!check || !check.checked) return;
  /* Re-check the PIN at the moment of enabling, not just when the
     confirmation was shown: the PIN could have been removed in
     between, and enabling without one would leave the section
     open to anyone. */
  var p = activeProfile();
  if (!p || !isPinLocked(p)) {
    toast("Set a PIN for this profile first, so the 18+ section stays private.");
    if (p) {
      openPinSheet({ mode: "set", profileId: p.id, allowCancel: true,
        onSuccess: function () { showAdultConfirm(); } });
    }
    return;
  }
  state.adultEnabled = true;
  saveState();
  updateAdultNav();
  renderAdultSettings();
  toast("18+ section is on for this profile");
}

function disableAdultSection() {
  state.adultEnabled = false;
  adultUnlocked = false;
  saveState();
  updateAdultNav();
  renderAdultSettings();
  toast("18+ section is off");
}

/* ---------- Settings warnings ---------- */
/* Warnings rendered into Settings by code, since the markup cannot
   change. Provider warnings appear under the key that failed, and
   the backup note sits above the Export button. */

function renderOneProviderWarning(inputId, warnId, providerName, reason) {
  var input = document.getElementById(inputId);
  if (!input || !input.parentNode) return;
  var existing = document.getElementById(warnId);
  if (!reason) {
    if (existing) existing.remove();
    return;
  }
  var text = reason === "invalid-key"
    ? "That " + providerName + " key was rejected. Posters and ratings from " +
      providerName + " are paused until you save a working key."
    : providerName + " says the request limit was reached. Posters and " +
      "ratings from " + providerName + " are paused for this visit; saving " +
      "a key again restarts them.";
  if (existing) {
    existing.textContent = text;
    return;
  }
  var p = document.createElement("p");
  p.className = "sub";
  p.id = warnId;
  p.textContent = text;
  var row = input.parentNode;
  row.parentNode.insertBefore(p, row.nextSibling);
}

function renderProviderWarnings() {
  renderOneProviderWarning("omdbKeyInput", "omdbKeyWarning", "OMDb",
    providerDisabledReason.omdb);
  renderOneProviderWarning("tmdbKeyInput", "tmdbKeyWarning", "TMDB",
    providerDisabledReason.tmdb);
}

function renderBackupNote() {
  if (document.getElementById("backupWarningNote")) return;
  var btn = document.getElementById("exportBtn");
  if (!btn || !btn.parentNode || !btn.parentNode.parentNode) return;
  var p = document.createElement("p");
  p.className = "sub";
  p.id = "backupWarningNote";
  p.textContent = "A backup includes your saved OMDb and TMDB API keys and " +
    "your profiles' PIN hashes. Keep the file private and do not share it.";
  btn.parentNode.parentNode.insertBefore(p, btn.parentNode);
}

/* ---------- Pull to refresh (Home only) ---------- */

/* The pull-to-refresh pill sits just below the topbar. The bar's
   height varies (it wraps to two or three rows on a narrow phone),
   so measure it on load and on resize and hand the real height to
   CSS as --ptr-top, instead of a fixed guess. */
function syncPtrTop() {
  var bar = document.querySelector(".topbar");
  if (!bar) return;
  document.documentElement.style.setProperty("--ptr-top", bar.offsetHeight + "px");
}

/* Hide the topbar on scroll down, reveal it on scroll up, so the
   sticky bar stops costing vertical space while browsing rows. It
   stays visible at the very top of the page and whenever a sheet
   is open. A few pixels of slack keep small jitters from flicking
   it. Pull-to-refresh only works at scroll top, where the bar is
   always visible, so the two never fight. */
function initTopbarHide() {
  var bar = document.querySelector(".topbar");
  if (!bar) return;
  var lastY = window.scrollY || 0;
  window.addEventListener("scroll", function () {
    var y = window.scrollY || 0;
    var sheetOpen = !document.getElementById("detailsSheet").hidden ||
      !document.getElementById("playerSheet").hidden ||
      !document.getElementById("profilePicker").hidden ||
      !document.getElementById("pinSheet").hidden;
    if (sheetOpen || y <= 0) {
      bar.classList.remove("topbar-hidden");
    } else if (y > lastY + 4) {
      bar.classList.add("topbar-hidden");
    } else if (y < lastY - 4) {
      bar.classList.remove("topbar-hidden");
    }
    lastY = y;
  }, { passive: true });
}

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
    /* updateViaCache none: the update check always revalidates
       sw.js instead of trusting the host's HTTP cache, so a new
       release is noticed on the next visit, not minutes later. */
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(function () {
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
  /* The 18+ rows filter on hide-watched too: reload them when the
     section is showing, or mark them stale so they reload on next
     entry. */
  if (adultLoaded) {
    if (document.getElementById("adultView").classList.contains("active")) loadAdult();
    else adultLoaded = false;
  }
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

/* Download the current backup file. Shared by the Settings
   Export button, the import confirmation's export-first step,
   and the storage warning banner. */
function exportBackup() {
  var blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "archiveflix-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Backup downloaded");
}

/* Apply an already confirmed backup file and refresh the UI for
   the imported profiles and keys. */
function applyImportedBackup(data) {
  var kind = parseBackup(data);
  if (!kind) {
    toast("That file is not an ARCHIVEFLIX backup");
    return;
  }
  /* Imported keys are new keys: a provider disabled under the old
     key gets a fresh chance. */
  resetProvider("omdb");
  resetProvider("tmdb");
  applyTheme();
  renderThemePresets();
  renderProfileList();
  syncHideWatchedBoxes();
  updateAdultNav();
  renderAdultSettings();
  var keyInput = document.getElementById("omdbKeyInput");
  if (keyInput) {
    keyInput.value = "";
    keyInput.placeholder = state.omdbKey ? "Key saved" : "Free OMDb API key";
  }
  var tmdbInput = document.getElementById("tmdbKeyInput");
  if (tmdbInput) {
    tmdbInput.value = "";
    tmdbInput.placeholder = state.tmdbKey ? "Key saved" : "Free TMDB API key";
  }
  if (kind === "v2") {
    var imported = profilesStore.profiles;
    var only = imported.length === 1 ? imported[0] : null;
    if (only && !isPinLocked(only)) {
      enterProfile(only.id);
      toast("Backup imported");
    } else {
      /* More than one profile, or a locked one: pick a profile
         before anything shows, so a locked profile's data is
         never on screen without its PIN. */
      profileEntered = false;
      updateProfileButton();
      openPicker(false);
      toast("Backup imported, choose a profile");
    }
  } else {
    updateProfileButton();
    if (homeLoaded) loadHome();
    refreshPersonalViews();
    toast("Backup imported into this profile");
  }
}

/* Import confirmation: importing replaces all profiles, so the
   user sees what will be replaced and gets an export-first step
   before anything is overwritten. Built in code because the
   markup cannot change. */
function showImportConfirm(info, data) {
  var overlay = document.createElement("div");
  overlay.id = "importConfirmOverlay";
  overlay.className = "sheet-backdrop";
  var currentNames = profilesStore.profiles.map(function (p) { return p.name; });
  var body;
  if (info.kind === "v2") {
    body = "This backup holds " + info.names.length + " profile" +
      (info.names.length === 1 ? "" : "s") + " (" + info.names.join(", ") +
      "). Importing replaces all " + currentNames.length +
      " of your current profiles (" + currentNames.join(", ") +
      ") and your saved API keys. Export your current data first if you want to keep it.";
  } else {
    body = "This is an old single-profile backup. Importing replaces this " +
      "profile's history, My List and likes. Export your current data " +
      "first if you want to keep it.";
  }
  overlay.innerHTML =
    '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="importConfirmTitle">' +
    '<h2 id="importConfirmTitle">Import this backup?</h2>' +
    '<p class="sub">' + esc(body) + "</p>" +
    '<div class="key-row">' +
    '<button class="btn" id="importExportFirst">Export my current data first</button>' +
    "</div>" +
    '<div class="key-row">' +
    '<button class="btn btn-primary" id="importProceed">Replace everything and import</button>' +
    '<button class="btn btn-ghost" id="importCancel">Cancel</button>' +
    "</div></div>";
  document.body.appendChild(overlay);
  overlay.querySelector("#importExportFirst").addEventListener("click", function () {
    exportBackup();
    var b = overlay.querySelector("#importExportFirst");
    b.disabled = true;
    b.textContent = "Current data exported";
  });
  overlay.querySelector("#importProceed").addEventListener("click", function () {
    overlay.remove();
    applyImportedBackup(data);
  });
  overlay.querySelector("#importCancel").addEventListener("click", function () {
    overlay.remove();
  });
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.remove();
  });
}

/* Who is watching? More than one profile gets the picker. One
   profile opens straight in, with a PIN prompt when it is locked.
   Also the resume point after the damaged-data state. */
function bootProfiles() {
  updateProfileButton();
  updateAdultNav();
  if (profilesStore.profiles.length > 1) {
    openPicker(false);
  } else {
    var only = profilesStore.profiles[0];
    if (isPinLocked(only)) {
      openPinSheet({ mode: "unlock", profileId: only.id, allowCancel: false });
    } else {
      enterProfile(only.id);
    }
  }
}

function init() {
  applyTheme();
  renderThemePresets();
  populateYearSelects();
  syncHideWatchedBoxes();
  /* The hero skeleton goes in on page load, before the catalog
     has had a chance to resolve, so the top of the page is never
     a blank slab. */
  renderHeroSkeleton();
  syncPtrTop();
  initTopbarHide();
  initPullToRefresh();
  registerServiceWorker();
  initInstallPrompt();
  /* Tab stays inside an open dialog; the trap is one listener for
     all four dialogs. */
  document.addEventListener("keydown", onDialogKeydown);
  /* The release version, from the one constant, in Settings About. */
  var aboutVersion = document.getElementById("aboutVersion");
  if (aboutVersion) aboutVersion.textContent = "ARCHIVEFLIX v" + APP_VERSION;
  /* Start the 18+ identity pool loading now, so it is usually
     ready before the first catalog search needs it. */
  fetchAdultPool();
  /* A storage failure during load shows its warning once the page
     exists to hold it. */
  if (storageFailed) showStorageWarning();

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
    resizeTimer = setTimeout(function () {
      wireExpandableDescs(document);
      /* The topbar can wrap or unwrap on resize, which moves the
         pull-to-refresh pill's anchor. */
      syncPtrTop();
    }, 200);
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
      /* A single year clears the decade, so the two can never
         silently contradict each other. */
      browseState.decade = "";
      document.getElementById("filterDecade").value = "";
    }
    runBrowse(true);
  });
  document.getElementById("filterYearFrom").addEventListener("change", function (e) {
    browseState.yearFrom = e.target.value;
    browseState.year = "";
    document.getElementById("filterYear").value = "";
    if (browseState.yearFrom) {
      browseState.decade = "";
      document.getElementById("filterDecade").value = "";
    }
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
    if (browseState.yearTo) {
      browseState.decade = "";
      document.getElementById("filterDecade").value = "";
    }
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
  /* More filters: Decade, Year, the From/To range and Minimum
     rating hide behind one toggle, so Browse shows Search, Type,
     Genre and Sort by default. */
  document.getElementById("more-filters-toggle").addEventListener("click", function () {
    var open = this.getAttribute("aria-expanded") === "true";
    this.setAttribute("aria-expanded", open ? "false" : "true");
    document.getElementById("more-filters").classList.toggle("open", !open);
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
    /* Keep the cleared entries until the toast expires, so Undo
       can put them back. The merge keeps anything watched in the
       meantime, which always wins on a key clash. */
    var cleared = state.history;
    state.history = {};
    saveState();
    renderHistory();
    if (homeLoaded) loadHome();
    toast("History cleared", { action: { label: "Undo", onClick: function () {
      Object.keys(cleared).forEach(function (k) {
        if (!state.history[k]) state.history[k] = cleared[k];
      });
      saveState();
      renderHistory();
      if (homeLoaded) loadHome();
    } } });
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
    /* The PIN pad takes digits and Backspace while it is open, so a
       keyboard works as well as the on screen pad. */
    if (!document.getElementById("pinSheet").hidden) {
      if (/^[0-9]$/.test(e.key)) { pinKey(e.key); return; }
      if (e.key === "Backspace") { pinBackspace(); return; }
      if (e.key === "Escape") { closePinSheet(); return; }
      return;
    }
    if (e.key !== "Escape") return;
    if (!document.getElementById("profilePicker").hidden) { closePicker(); return; }
    if (!document.getElementById("playerSheet").hidden) closePlayer();
    else if (!document.getElementById("detailsSheet").hidden) closeDetails();
  });
  /* Manual place buttons. They only show in embed fallback mode, where
     the Archive player cannot report your place. Native playback
     saves your place on its own. Embed mode has no restart button
     in the markup (the video-mode "Start from the beginning"
     button is hidden there), so a 0% button is added here first,
     wired like the other manual percent buttons. */
  var manualBtns = document.getElementById("playerManualBtns");
  if (manualBtns && !manualBtns.querySelector('[data-progress="0"]')) {
    var zeroBtn = document.createElement("button");
    zeroBtn.className = "btn btn-ghost";
    zeroBtn.setAttribute("data-progress", "0");
    zeroBtn.textContent = "Start from the beginning";
    manualBtns.insertBefore(zeroBtn, manualBtns.firstChild);
  }
  document.querySelectorAll(".progress-btns .btn").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!currentPlayer) return;
      var p = Number(b.dataset.progress);
      /* Finished in embed mode goes through the same finish flow
         as a film ending natively: mark finished, re-scan, Home. */
      if (p >= 1) { finishTitle(currentPlayer); return; }
      /* A manual percent sets the position to the fraction of the
         duration when the duration is known, else it clears the
         position so the fraction is authoritative and no stale
         "Resume from 3:12" survives from an earlier place. */
      var h = state.history[historyKey(currentPlayer)];
      var dur = h && h.duration ? h.duration : 0;
      if (dur > 0) recordProgress(currentPlayer, p, Math.round(p * dur), dur);
      else recordProgress(currentPlayer, p, 0);
      updatePlayerPlace();
      toast(p === 0 ? "Started from the beginning" : "Place saved at " + Math.round(p * 100) + "%");
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

  document.getElementById("densityComfortable").addEventListener("click", function () {
    setDensity("comfortable");
  });
  document.getElementById("densityCompact").addEventListener("click", function () {
    setDensity("compact");
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
    resetProvider("omdb");
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
    resetProvider("tmdb");
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

  document.getElementById("exportBtn").addEventListener("click", exportBackup);
  document.getElementById("importFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var info = describeBackup(data);
        if (!info) throw new Error("bad file");
        /* Nothing is replaced until the user confirms, with an
           export-first step on offer. */
        showImportConfirm(info, data);
      } catch (err) {
        toast("That file is not an ARCHIVEFLIX backup");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });
  document.getElementById("wipeBtn").addEventListener("click", function () {
    wipeAllData();
    applyTheme();
    renderThemePresets();
    renderProfileList();
    syncHideWatchedBoxes();
    updateProfileButton();
    updateAdultNav();
    renderAdultSettings();
    keyInput.value = "";
    keyInput.placeholder = "Free OMDb API key";
    tmdbInput.value = "";
    tmdbInput.placeholder = "Free TMDB API key";
    clearPosterCache();
    if (homeLoaded) loadHome();
    refreshPersonalViews();
    toast("Everything erased from this browser");
  });

  /* Profile buttons, picker and PIN pad. */
  document.getElementById("profileBtn").addEventListener("click", function () { openPicker(true); });
  document.getElementById("pickerClose").addEventListener("click", closePicker);
  document.getElementById("profileManageBtn").addEventListener("click", function () {
    closePicker();
    showView("settings");
    var sec = document.getElementById("profilesSection");
    if (sec) sec.scrollIntoView();
  });
  document.getElementById("profileCreateBtn").addEventListener("click", function () {
    var input = document.getElementById("profileNameInput");
    var p = createProfile(input.value);
    if (!p) {
      toast(profilesStore.profiles.length >= MAX_PROFILES ? "5 profiles is the most" : "Pick a name first");
      return;
    }
    input.value = "";
    document.getElementById("profileAddRow").hidden = true;
    renderProfileTiles();
    toast("Profile created");
  });
  document.getElementById("addProfileBtn").addEventListener("click", function () {
    if (profilesStore.profiles.length >= MAX_PROFILES) { toast("5 profiles is the most"); return; }
    document.getElementById("settingsAddRow").hidden = false;
    document.getElementById("settingsProfileName").focus();
  });
  document.getElementById("settingsProfileCreate").addEventListener("click", function () {
    var input = document.getElementById("settingsProfileName");
    var p = createProfile(input.value);
    if (!p) { toast("Pick a name first"); return; }
    input.value = "";
    document.getElementById("settingsAddRow").hidden = true;
    renderProfileList();
    toast("Profile created");
  });
  document.querySelectorAll(".pin-key[data-digit]").forEach(function (b) {
    b.addEventListener("click", function () { pinKey(b.dataset.digit); });
  });
  document.getElementById("pinBackBtn").addEventListener("click", pinBackspace);
  document.getElementById("pinClose").addEventListener("click", closePinSheet);
  document.getElementById("pinForgotBtn").addEventListener("click", pinForgot);
  document.getElementById("pinSheet").addEventListener("click", function (e) {
    if (e.target === e.currentTarget) closePinSheet();
  });

  /* A damaged profiles store shows its own state instead of the
     profile picker; the picker resumes from there once the user
     chooses recovery, a fresh start, or carrying on. */
  if (storeDamaged) {
    showDamagedState();
  } else {
    bootProfiles();
  }
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
    deriveYear: deriveYear,
    yearFromText: yearFromText,
    yearFromField: yearFromField,
    storedYear: storedYear,
    yearClauseSingle: yearClauseSingle,
    yearClauseRange: yearClauseRange,
    matchesYearFilter: matchesYearFilter,
    yearFilterActive: yearFilterActive,
    parseEpisodeRef: parseEpisodeRef,
    episodeTitleFrom: episodeTitleFrom,
    deriveShowName: deriveShowName,
    episodeLabel: episodeLabel,
    groupEpisodes: groupEpisodes,
    episodeHistoryId: episodeHistoryId,
    episodeKeySlug: episodeKeySlug,
    episodeHistoryEntry: episodeHistoryEntry,
    episodeDedupeKey: episodeDedupeKey,
    historyKey: historyKey,
    isPlayableFile: isPlayableFile,
    rankedPlayableFiles: rankedPlayableFiles,
    isGenuinelyFinished: isGenuinelyFinished,
    makeRetryBudget: makeRetryBudget,
    fetchWithTimeout: fetchWithTimeout,
    FETCH_TIMEOUT_SEARCH_MS: FETCH_TIMEOUT_SEARCH_MS,
    FETCH_TIMEOUT_POSTER_MS: FETCH_TIMEOUT_POSTER_MS,
    episodesFromFiles: episodesFromFiles,
    episodesFromItems: episodesFromItems,
    rowArrowState: rowArrowState,
    rowScrollStep: rowScrollStep,
    GENRES: GENRES,
    THEMES: THEMES,
    accentTextFor: accentTextFor,
    cleanSearchTitle: cleanSearchTitle,
    pickArchivePosterFile: pickArchivePosterFile,
    pickCommonsPoster: pickCommonsPoster,
    tmdbPosterUrl: tmdbPosterUrl,
    omdbRating: omdbRating,
    omdbPoster: omdbPoster,
    tmdbPoster: tmdbPoster,
    archivePoster: archivePoster,
    commonsPoster: commonsPoster,
    resolvePoster: resolvePoster,
    analyzeFrame: analyzeFrame,
    isBadThumbnail: isBadThumbnail,
    isArchiveThumbnailUrl: isArchiveThumbnailUrl,
    titleCardHtml: titleCardHtml,
    rejectThumbnail: rejectThumbnail,
    applyRealPoster: applyRealPoster,
    posterErrorGuard: posterErrorGuard,
    probeThumbnail: probeThumbnail,
    guardThumbnail: guardThumbnail,
    ROW_DEFS: ROW_DEFS,
    loadRow: loadRow,
    loadDirectors: loadDirectors,
    loadCartoons: loadCartoons,
    loadTopImdb: loadTopImdb,
    searchUrl: searchUrl,
    searchArchive: searchArchive,
    getMetadata: getMetadata,
    buildBrowseQuery: buildBrowseQuery,
    escapeSearchTerm: escapeSearchTerm,
    sortParamFor: sortParamFor,
    isYoutubeRipFiltered: isYoutubeRipFiltered,
    makeSequencer: makeSequencer,
    makeHeroPicker: makeHeroPicker,
    rowLoadsImmediately: rowLoadsImmediately,
    HOME_IMMEDIATE_ROWS: HOME_IMMEDIATE_ROWS,
    firstSignalSubject: firstSignalSubject,
    typeQueryFor: typeQueryFor,
    typeQueryForTypes: typeQueryForTypes,
    GENERIC_SUBJECT_STOPLIST: GENERIC_SUBJECT_STOPLIST,
    applyAdultExclusion: applyAdultExclusion,
    isAdultItem: isAdultItem,
    isAdultEntry: isAdultEntry,
    adultAccess: adultAccess,
    ADULT_SUBJECTS: ADULT_SUBJECTS,
    ADULT_QUERY: ADULT_QUERY,
    ADULT_ROW_DEFS: ADULT_ROW_DEFS,
    continueWatchingItems: continueWatchingItems,
    watchAgainItems: watchAgainItems,
    topSignalSubjects: topSignalSubjects,
    myListItems: myListItems,
    historyEntries: historyEntries,
    defaultState: defaultState,
    defaultProfileData: defaultProfileData,
    defaultDeviceState: defaultDeviceState,
    hashPin: hashPin,
    checkProfilePin: checkProfilePin,
    isPinLocked: isPinLocked,
    createProfile: createProfile,
    renameProfile: renameProfile,
    deleteProfile: deleteProfile,
    setProfilePin: setProfilePin,
    removeProfilePin: removeProfilePin,
    resetProfileData: resetProfileData,
    switchProfile: switchProfile,
    activeProfile: activeProfile,
    findProfile: findProfile,
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    wipeAllData: wipeAllData,
    recordProgress: recordProgress,
    toggleMyList: toggleMyList,
    MAX_PROFILES: MAX_PROFILES,
    PROFILE_COLORS: PROFILE_COLORS,
    /* Test hooks: seed the in-memory store and reload through the
       real load path, so tests can drive migration and switching. */
    testSeedStores: function (deviceJson, profilesJson) {
      nodeStore = {};
      if (deviceJson != null) nodeStore[STORE_KEY] = deviceJson;
      if (profilesJson != null) nodeStore[PROFILES_KEY] = profilesJson;
      loadStores();
    },
    testRawStore: function (key) { return storeGet(key); },
    /* Cache test hooks. */
    testCacheSizes: function () {
      return { search: Object.keys(searchCache).length, meta: Object.keys(metaCache).length,
        inFlight: Object.keys(searchInFlight).length };
    },
    testClearCaches: function () {
      searchCache = {};
      metaCache = {};
      searchInFlight = {};
    },
    testYearMax: function () { return YEAR_MAX; },
    testDerivedYearMax: function () { return DERIVED_YEAR_MAX; },
    /* Thumbnail validation test hooks. */
    testThumbVerdict: function (id) { return thumbVerdict[id]; },
    testThumbValidationAvailable: function () { return thumbValidationAvailable; },
    testResetThumbValidation: function () {
      thumbVerdict = {};
      thumbValidationAvailable = true;
      thumbProbeErrors = 0;
    },
    testGetState: function () { return state; },
    testGetProfiles: function () { return profilesStore; },
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
    setPlayerForTest: function (p) { currentPlayer = p; },
    /* v1.6.0: adult detection, overrides and the identity gate. */
    isAdultOverridden: isAdultOverridden,
    ADULT_OVERRIDE_IDS: ADULT_OVERRIDE_IDS,
    adultSubjectMatches: adultSubjectMatches,
    normalizeTitleForMatch: normalizeTitleForMatch,
    adultPoolKey: adultPoolKey,
    isInAdultPool: isInAdultPool,
    fetchAdultPool: fetchAdultPool,
    applyIdentityGate: applyIdentityGate,
    /* v1.6.0: years. */
    deriveYearWithSource: deriveYearWithSource,
    isSuspiciousYear: isSuspiciousYear,
    lookupReleaseYear: lookupReleaseYear,
    tmdbResultYear: tmdbResultYear,
    /* v1.6.0: caps and persistence. */
    pruneHistory: pruneHistory,
    HISTORY_MAX_ENTRIES: HISTORY_MAX_ENTRIES,
    pruneOmdbCache: pruneOmdbCache,
    OMDB_CACHE_MAX: OMDB_CACHE_MAX,
    flushSaveState: flushSaveState,
    saveStateSoon: saveStateSoon,
    /* v1.6.0: PIN hashing and lockout. */
    legacyHashPin: legacyHashPin,
    PIN_FALLBACK_ROUNDS: PIN_FALLBACK_ROUNDS,
    PIN_MAX_ATTEMPTS: PIN_MAX_ATTEMPTS,
    PIN_LOCKOUT_MS: PIN_LOCKOUT_MS,
    pinLockoutRemainingMs: pinLockoutRemainingMs,
    pinIsBlocked: pinIsBlocked,
    pinAttemptFailed: pinAttemptFailed,
    pinAttemptSucceeded: pinAttemptSucceeded,
    /* v1.6.0: backfill, damaged store, backup. */
    backfillAdultFlags: backfillAdultFlags,
    BACKFILL_BATCH_MAX: BACKFILL_BATCH_MAX,
    salvageProfiles: salvageProfiles,
    tryRecoverDamaged: tryRecoverDamaged,
    resolveDamagedFresh: resolveDamagedFresh,
    PROFILES_BACKUP_KEY: PROFILES_BACKUP_KEY,
    describeBackup: describeBackup,
    closeAdultWithoutPin: closeAdultWithoutPin,
    markProfileChanged: markProfileChanged,
    /* v1.6.0: provider health and posters. */
    providerDisabled: providerDisabled,
    disableProvider: disableProvider,
    resetProvider: resetProvider,
    omdbErrorKind: omdbErrorKind,
    negativeCached: negativeCached,
    negativeCachePut: negativeCachePut,
    pickTmdbPoster: pickTmdbPoster,
    tmdbSearchRaw: tmdbSearchRaw,
    posterCacheValid: posterCacheValid,
    POSTER_NULL_CACHE_MS: POSTER_NULL_CACHE_MS,
    posterQueueRun: posterQueueRun,
    /* v1.6.0: UI builder A3: toasts, focus, contrast, density,
       hash routing, entrance. */
    APP_VERSION: APP_VERSION,
    toastDurationFor: toastDurationFor,
    makeToastQueue: makeToastQueue,
    TOAST_SHORT_MS: TOAST_SHORT_MS,
    TOAST_LONG_MS: TOAST_LONG_MS,
    TOAST_LONG_MIN_LENGTH: TOAST_LONG_MIN_LENGTH,
    nextTabTarget: nextTabTarget,
    contrastBetween: contrastBetween,
    relativeLuminance: relativeLuminance,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    mixHex: mixHex,
    accentPairFor: accentPairFor,
    accentTextSafeFor: accentTextSafeFor,
    CONTRAST_MIN: CONTRAST_MIN,
    densityAttrFor: densityAttrFor,
    viewForHash: viewForHash,
    enterDelayFor: enterDelayFor,
    testSetDensity: function (d) { state.density = d; },
    testGetDensity: function () { return state.density; },
    /* v1.6.0 test hooks. */
    testStoreDamaged: function () { return storeDamaged; },
    testStorageFailed: function () { return storageFailed; },
    testSetStorageFailureMode: function (on) {
      storageSimulateFailure = !!on;
      if (!on) { storageFailed = false; storageFailureReason = ""; }
    },
    testSetAdultPool: function (entries) {
      adultPoolSet = {};
      (entries || []).forEach(function (e) {
        var k = adultPoolKey(e.title, e.year);
        if (k) adultPoolSet[k] = true;
      });
      adultPoolPromise = Promise.resolve(adultPoolSet);
    },
    testResetAdultPool: function () {
      adultPoolSet = null;
      adultPoolPromise = null;
    },
    testAdultPoolLoaded: function () { return !!adultPoolSet; },
    testResetBackfill: function () { backfillCheckedIds = {}; },
    testResetPinLockout: function () {
      pinLockState = {};
      storeRemove(PIN_LOCK_KEY);
    },
    testSetPinLockout: function (id, fails, blockedUntil) {
      pinLockState[id] = { fails: fails, blockedUntil: blockedUntil };
      savePinLockState();
    },
    testResetProviders: function () {
      providerDisabledReason = { omdb: null, tmdb: null };
      providerNegativeCache = {};
    },
    testProviderState: function () {
      return { omdb: providerDisabledReason.omdb, tmdb: providerDisabledReason.tmdb };
    },
    testPendingPersist: function () { return persistDirty; },
    testPosterAttempted: function (id) { return !!posterAttempted[id]; },
    testSetPosterAttempted: function (id) { posterAttempted[id] = true; },
    testGetPosterCacheEntry: function (id) { return posterCache[id]; },
    testSetPosterCacheEntry: function (id, entry) { posterCache[id] = entry; },
    testClearPosterCache: function () { clearPosterCache(); },
    testClearYearLookupCache: function () { yearLookupCache = {}; },
    testSaveState: function () { saveState(); }
  };
}

})();
