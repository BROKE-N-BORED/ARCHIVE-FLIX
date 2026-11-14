# ARCHIVEFLIX

A free streaming style home screen for movies, shows and cartoons from
archive.org. Open it in a browser, browse rows of titles, play them through
the Archive's own player, and keep your own watch history, My List and
recommendations. No account, no cost, no tracking. Everything personal is
saved only in your browser.

## What it does

- Home screen with a featured pick plus rows: Trending Now, Top Rated,
  Horror, Comedy, Sci-Fi, Thriller, Plot Twist, Film Noir, Westerns, Shows,
  Cartoons, Animation, Newly Added, Golden Age 1930s, Silent Era,
  Directors Picks and Top IMDb.
- Browse with search, type filter (movie, show, cartoon), genre and
  sub-genre chips, decade, year (single year or From/To range), minimum
  rating and six sort orders.
- Details for every title: synopsis, director, year, runtime, Archive star
  rating, subject tags, More Like This, a Download button, and your saved
  place in the film.
- Player plays the Archive's own video file right in the app and saves
  your place automatically as you watch, so you pick up exactly where
  you left off. When a film ends it is marked finished for you and you
  go back to a freshly scanned Home. A few titles have no file this
  browser can play directly; those play through the Archive's own
  player instead, with a simple manual place marker.
- Download button: resolves a video file from the Archive's own files and
  links it. If no file resolves, it opens the title's Archive page instead.
- Watch history with dates and play counts, Continue Watching with progress
  bars, a Watch Again shelf, My List, Like and Not for me, and Because You
  Watched rows built from what you finished and liked.
- The catalog loads once when the app opens and never reloads on its own.
  It re-scans only when you pull down to refresh on Home, refresh the
  page, restart the app, or finish a title and go back to Home.
- Hide watched toggle: finished titles drop out of every browse row and
  search result. Your own shelves (Continue Watching, Watch Again, My List,
  History) still show them, since that is what they are for.
- Six themes (Cinema Gold, Midnight, Forest, Sunset, Light, High Contrast)
  plus a custom accent color picker. Respects reduced motion settings.
- Profiles: up to 5, each with its own history, My List, likes and
  theme, with an optional 4 digit PIN lock per profile. A PIN is a
  casual lock screen for the device, not encryption. API keys are
  shared across profiles on the device.
- Export and import your data as a JSON backup from Settings. A backup
  includes all profiles.

## Run it

Option 1: open `index.html` straight in a browser.

Option 2: serve the folder, for example `python3 -m http.server`, then open
http://localhost:8000

Option 3: turn on GitHub Pages for this repo (Settings, Pages, deploy from
the main branch) and open the Pages link.

It needs internet access to reach archive.org. It is plain HTML, CSS and
JavaScript with no build step and no libraries.

## Install it on your phone

No app store and no terminal needed.

1. Open the app link (the GitHub Pages link) on your phone.
2. On Android, in Chrome: tap the three dot menu, then Add to Home screen.
   On iPhone, in Safari: tap Share, then Add to Home Screen. Some browsers
   also show an Install button in Settings.
3. Tap the ARCHIVEFLIX icon on your home screen. It opens full screen
   like a real app, with your history saved on the phone.

## Install it on a Linux desktop

1. Download this repo (Code, Download ZIP, then open the zip) or clone it.
2. Double-click "Install ARCHIVEFLIX". If double-clicking opens a text
   editor instead, right-click the file, open Properties, Permissions,
   check "Allow this file to run as a program", then double-click it
   again. Or open a terminal in the folder and run `bash install.sh`.
3. Click the ARCHIVEFLIX icon on your desktop (or in the app menu). It
   opens in its own window, no terminal involved. If double-clicking the
   desktop icon does nothing, right-click it and choose Allow Launching.

The installer puts the app in `~/.local/share/archiveflix`, the icon in
the app menu and on the desktop, and checks the icon file is really
there before it says it worked.

## Where the catalog comes from

Everything comes from archive.org through its public search and metadata
APIs, no key needed. Movies come from the Feature Films collection, shows
from Classic TV, cartoons from Classic Cartoons plus a broader cartoon
subject search (video site rips are filtered out). Titles, years and
descriptions are the Archive's own uploader supplied metadata, shown as-is.

## Top IMDb row and the OMDb key (optional)

There is no free IMDb data feed without a key, so the Top IMDb row works two
ways. With no key, it ranks by Archive star ratings and the row says so.
If you add a free OMDb key in Settings, the row fetches real IMDb ratings
for its top titles and sorts by them. The key is stored only in your
browser's local storage, never in this repo, and is sent only to
omdbapi.com. Get a free key at omdbapi.com/apikey.aspx.

## Real movie posters

Cards show the Archive thumbnail right away, then upgrade to a real
movie poster when one resolves. The layers, best first: the OMDb poster
(when you saved an OMDb key), the TMDB poster (when you saved a TMDB
key), the Archive item's own poster or cover files, and a Wikimedia
Commons public domain poster search. Any layer that fails falls back
silently to the next, and the Archive thumbnail is always the fallback,
so a missing poster never breaks a card. Resolved posters are cached in
your browser for 30 days. Behind every thumbnail sits a designed title
card with the film's title and year, so a thumbnail that fails to load
shows the title card instead of an empty space. Thumbnails are also
checked for blank or nearly all black frames (including end credits
screens) and replaced by the title card when the check can run; the
check needs the image served with CORS headers, which archive.org does
not send for its images yet, so a blank or credits frame can still show
until that changes.

To use TMDB posters, add a free TMDB API key in Settings. The key is
stored only in your browser's local storage, never in this repo, and is
sent only to api.themoviedb.org. Get a free key at
themoviedb.org/settings/api. Poster art from TMDB is TMDB's data,
shown with thanks.

## Privacy

History, My List, likes, theme and the optional OMDb and TMDB keys live
in your browser's local storage, kept per profile. Nothing is sent to
any server except archive.org (for the catalog, playback and
downloads), omdbapi.com (only when you saved a key, only for IMDb
ratings and posters), api.themoviedb.org (only when you saved a key,
only for posters) and commons.wikimedia.org (only for public domain
poster search). The service worker keeps a copy of
the app itself and a capped set of posters on your device so the app
opens offline; it never stores your history or your key.

Releases ship clean: no user data of any kind is in this repo. Nothing
you watch, save or like is ever written into a release. It all stays in
your browser, and the only way it leaves the browser is if you export a
backup yourself from Settings. A PIN lock is a casual lock screen for
the device, not encryption: it keeps other people on the device from
opening the profile, it does not hide the data from anyone who can read
the browser's storage.

## Honest limits

- A few titles have no file a browser can play directly, so they play
  through the Archive embed, which cannot report your place. Those few
  keep a simple manual place marker in the player.
- Archive metadata is uploader supplied. Some titles, years and synopses
  are messy or missing, and a few uploads are mislabeled. The app shows
  what the Archive returns.
- Ratings shown as Archive ratings are Archive star ratings, not IMDb
  ratings. IMDb ratings appear only with an OMDb key, labeled as IMDb.
