# CHANGELOG

## v1.5.0 - 2026-11-14

- Shows now list their seasons and episodes in the details sheet. Two
  real sources, both from the Archive: episodes inside a multi-file
  series upload (Bonanza public domain episodes holds 30, Green Acres
  Complete Series holds 169 across six seasons, Space 1999 Series 1
  holds 24), and sibling episode uploads of the same show, found by
  the show name in the title. Episodes group by season where the data
  carries a season, and the rest show as a plain episode list. Tapping
  an episode plays it, and each episode keeps its own saved place, so
  resuming one episode never drops you into another.
- The Archive has no series, season or episode metadata fields: numbers
  live only in titles, identifiers and file names, as S01E02, S01 E02,
  "Season 7, Episode 23", "Ep 2x08", "Episode # 18", "#9", or Ep01 in
  the identifier. The app parses those and never invents a number that
  is not in the data. Most per-episode uploads carry no number at all,
  so most shows list episodes without season groups, and a show with
  no episode data anywhere gets no episode list instead of a fake one.
  Duplicate uploads of the same episode collapse to one row.
- The layout has more breathing room everywhere: bigger cards, wider
  gaps between cards and rows, more padding in the views, the hero and
  the details sheet, and a larger details poster. Same Netflix look,
  same Cinema Gold default, just less squished.
- Rows have Netflix style carousel arrows: translucent chevrons at the
  left and right edges that appear on hover on a computer and briefly
  whenever a row is scrolled or touched on a phone. Tapping one scrolls
  the row by a page of cards. An arrow hides when its end of the row is
  reached, and both hide when a row fits without scrolling. Swiping
  still works alongside. The More Like This row in details has them too.
- The service worker cache is bumped to v8 so installed copies pick
  up the new shell.

## v1.4.1 - 2026-11-14

- Years are the film's real release year now, never the Archive
  upload year. The Archive's own year and date fields cannot be
  trusted: uploaders often put the upload date in both (verified
  live: The Two Headed Spy (1958) carried year 2024; The Fat Man
  (1951), Our Town (1955) and The Yellow Canary (1943) all carried
  year 2024). The year shown now comes from the title first, then
  the identifier, then the year field, then the date field, and the
  upload dates are never used as the film year. A parenthesised
  year in the title wins over a bare one, so "2001: A Space Odyssey
  (1968)" shows 1968. Cards, rows, details, the hero, history and
  My List all show the corrected year, including entries saved
  before this fix.
- The year filter, the From/To range and the decade filter all
  filter on the corrected release year. The query also matches the
  year in the title, which recovers films whose indexed year is an
  upload year (a 1958 search finds 223 titles instead of 170), and
  results are then filtered client-side by the derived year, so
  filtering by 2024 no longer returns a 1958 film. The Golden Age
  and Silent Era rows use the same corrected matching.
- The service worker cache is bumped to v7 so installed copies pick
  up the new shell.

## v1.4.0 - 2026-11-14

- A private 18+ section, hidden by default. Nothing about it shows
  anywhere, no nav entry and no rows, until the profile owner turns
  it on in Settings. Turning it on needs an "I am 18 years or older"
  confirmation and a profile PIN; opening the section asks for the
  PIN again, and leaving the section locks it again. The section is
  per profile, so other profiles see no trace of it.
- The 18+ catalog is the Archive's own adult tagged films: 107
  titles in the feature collection (subjects adult, erotica,
  erotic, sexploitation, softcore, nudie, "adults only" and "sex
  comedy"), in five rows (18+ Films, Erotica, Sexploitation, Sex
  Comedies, Nudie Classics), with the same details and playback as
  the rest of the app. Adult viewing stays inside the section, with
  its own Continue Watching, Watch Again and My List.
- No leaks: every normal catalog query excludes adult titles at the
  query level, results are filtered again on the way in, and adult
  titles never appear in the home rows, Browse, search, the hero,
  recommendations, My List or History outside the section. Inclusion
  and exclusion share one definition, so a title can never be in
  the section and still show in normal search. Verified live
  against the Archive, both ways: every one of the 107 titles
  returns from the section query and returns zero under the normal
  exclusion. The audit also caught an untagged second upload of
  Madame and Her Niece (1969), which carried only Sex Comedy tags;
  "sex comedy" is in the adult set because of it.
- The service worker cache is bumped to v6 so installed copies pick
  up the new shell.

## v1.3.1 - 2026-11-14

- No more blank thumbnails. Every place a thumbnail appears (poster
  cards, the details poster, the hero backdrop, history) now has a
  designed title card behind it: the film's title and year on a
  theme-aware card, and a gradient backdrop with the title treatment
  for the hero. A thumbnail that fails to load shows the title card
  instead of an empty space.
- Thumbnail validation is in place: a thumbnail's pixels are sampled
  on a canvas, and a blank or nearly all black frame (including an
  end credits screen, which is black with a little white text) is
  rejected in favour of the title card. Real posters are trusted and
  never validated. Honest limit, found while building this: the check
  needs the image served with CORS headers, and archive.org serves
  its images without them, so in practice the check cannot run
  against Archive thumbnails yet and a blank or credits frame can
  still show. The check runs in full the day Archive images carry
  CORS headers; until then the title card covers every failed load.
- The service worker cache is bumped to v5 so installed copies pick
  up the new shell.

## v1.3.0 - 2026-11-14

- Profiles, Netflix style. Up to 5 profiles, each with its own watch
  history, Continue Watching, My List, likes and not-for-me, and
  theme. A "Who is watching?" picker opens when there is more than
  one profile; a single profile opens straight in. Switch from the
  profile button in the top bar or from Settings. API keys stay
  device level and are shared across profiles.
- Optional 4 digit PIN lock per profile. A locked profile asks for
  its PIN before it opens or can be switched into, so nobody else on
  the device can view that profile. The PIN is stored as a salted
  hash, never plaintext, and changing or removing it needs the
  current PIN. A forgotten PIN can be reset from the PIN pad, which
  erases that profile's history, My List and likes and removes the
  lock, so a forgotten PIN never exposes the profile and never locks
  the app. A PIN is a casual lock screen for the device, not
  encryption, and Settings says so.
- Existing data is moved into the first profile automatically on the
  first load after the update, so nothing is lost. The migration
  runs once and is safe if it runs again.
- Export now covers all profiles, and import takes the new backup
  format as well as old single profile backups (those land in the
  currently open profile).
- Clean release audit: the repo holds no user data of any kind.
  History, My List, likes and keys live only in the browser's local
  storage and are never written into any repo file, and export is
  user initiated only. README says so.
- The service worker cache is bumped to v4 so installed copies pick
  up the new shell.

## v1.2.1 - 2026-11-14

- Updates now show up on their own. The app watches for a new
  service worker taking control and reloads once to show the new
  version, instead of sitting on the old shell until the next manual
  reload. It never reloads while a film is playing: if an update
  arrives mid-watch, the reload waits until the player closes or the
  film ends. The service worker cache is bumped to v3 so the new
  app code is picked up, and the old v2 cache is cleaned up on
  activation.

## v1.2.0 - 2026-11-14

- Netflix grade retouch and redesign, look only, no behavior changed.
  The hero is now full bleed with the title's backdrop art, a gradient
  scrim, a big display title, and Play and More Info buttons with real
  presence. The top bar is a frosted glass strip with a stronger
  wordmark and a gold underline on the active page. Poster rows have
  deeper cards with hover lift, rounder corners, and TV Show and
  Cartoon badges. Browse, details, player, My List, History, and
  Settings all get the same polish: bigger bolder type, pill badges
  and chips, focus rings, and a pulsing skeleton while rows load.
- The default theme is now Cinema Gold, a Netflix dark look with a
  gold accent like the ARCHIVEFLIX app, and the Archive Red name is
  retired. All six themes plus the custom accent still work, and a
  custom light accent now gets dark button text so it stays readable.
- Real movie posters. Cards show the Archive thumbnail right away,
  then upgrade to a real poster when one resolves, lazily, so the
  rows never wait. The layers, best first: the OMDb poster (with a
  saved OMDb key), the TMDB poster (with a saved TMDB key, a new
  optional key field in Settings next to OMDb), the Archive item's
  own poster or cover files, and a Wikimedia Commons public domain
  poster search. Any layer that fails falls back silently to the
  next, and the Archive thumbnail is always the fallback, so a
  missing poster never breaks a card. Resolved posters are cached
  in the browser for 30 days.
- The service worker cache is bumped to v2, so installed copies pick
  up the new look instead of serving the old shell.

## v1.1.0 - 2026-11-14

- No more reloads on their own. The catalog loads once when the app
  opens and re-scans only when you pull down to refresh on Home,
  refresh the page, restart the app, or finish a title and go back to
  Home. Nothing reloads on a timer, and nothing interrupts watching,
  searching or browsing.
- Real Netflix style resume. The player now plays the Archive's own
  MP4 file in a native video element and saves your place
  automatically as you watch, so reopening a title picks up exactly
  where you left off. Reaching the end marks it finished, stops
  playback, re-scans the catalog and takes you back to Home. The
  manual 25, 50, 75 and Finished buttons are gone, except for the
  few titles with no playable file, which still play through the
  Archive embed with a simple manual place marker. The details
  sheet shows your saved place instead of a slider.
- Installable web app. Add manifest.json, a service worker (caches
  the app shell, runtime caches posters with a cap, friendly offline
  behavior) and SVG icons, so the app installs from a plain link:
  open it on your phone, Add to Home Screen, tap the icon. No build
  step, no terminal, no dependencies.
- Linux desktop installer. Double-click "Install ARCHIVEFLIX" (or
  run `bash install.sh`) to install the app to
  ~/.local/share/archiveflix with a desktop icon and app menu entry.
  The launcher opens the app in the browser in app mode when a
  Chromium browser is available, plain window otherwise, with no
  terminal window. The installer verifies the icon file exists
  before reporting success.

## v1.0.2 - 2026-11-14

- Browse gains a year filter next to the decade filter: pick a single
  year (1890 to 2026), or a From and To year range. Picking a year clears
  the range, and picking a range clears the single year, so the two never
  fight. Year combines with every other filter, and a year and decade
  that do not overlap simply shows the empty state. Clear filters resets
  the year controls too.

## v1.0.1 - 2026-11-14

- Descriptions no longer cut off with no way to read the rest. The hero
  synopsis and the details sheet synopsis now show a Read more toggle
  when the text is longer than the space, expanding in place to the full
  Archive description, with Read less to collapse again. Short
  descriptions show in full with no toggle. Descriptions are no longer
  cut short when loaded, so the expanded text is the complete synopsis.

## v1.0 - 2026-11-14

First release. Standalone ARCHIVEFLIX web app, plain HTML, CSS and
JavaScript, no build step and no libraries.

- Home screen with featured hero plus rows: Trending Now, Top Rated,
  Horror, Comedy, Sci-Fi, Thriller, Plot Twist, Film Noir, Westerns,
  Shows, Cartoons, Animation, Newly Added, Golden Age 1930s, Silent Era,
  Directors Picks (Hitchcock, Chaplin, Keaton, Welles) and Top IMDb.
- Browse: title search, type filter, genre and sub-genre chips, decade,
  minimum rating, six sort orders, Load more paging.
- Sub-genres per genre, all verified live against archive.org before
  shipping: Horror (Zombie, Gothic, Vampire, Monster, Slasher), Comedy
  (Slapstick, Satire), Sci-Fi (Space, Alien, Robot), Thriller and Film
  Noir (Crime, Mystery, Detective), Mystery (Detective, Crime), Western
  (Spaghetti), Drama (Crime).
- Details sheet: synopsis, director, year, runtime, Archive rating,
  subject tags, More Like This, Download button, progress slider.
- Player sheet with the Archive embed and user marked progress
  (25, 50, 75 percent or Finished).
- Download button resolving a video file from the Archive's own files,
  falling back to the title's Archive page.
- Personal layer in local storage: watch history, Continue Watching,
  Watch Again, My List, Like and Not for me, Because You Watched rows,
  Hide watched toggle.
- Top IMDb honesty: real IMDb ratings only with a user supplied free OMDb
  key; without a key the row uses Archive ratings and says so.
- Themes: six presets plus a custom accent color picker. Reduced motion
  respected.
- Export and import of personal data as JSON, and erase everything, in
  Settings.
