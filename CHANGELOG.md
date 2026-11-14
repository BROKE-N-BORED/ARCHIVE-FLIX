# CHANGELOG

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
