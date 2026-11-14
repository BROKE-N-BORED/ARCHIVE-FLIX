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
  rating, subject tags, More Like This, a Download button and a progress
  slider for your place in the film.
- Player sheet using the Archive's own embed. Progress is marked by you
  (25, 50, 75 percent or Finished), because the Archive player cannot
  report where you are.
- Download button: resolves a video file from the Archive's own files and
  links it. If no file resolves, it opens the title's Archive page instead.
- Watch history with dates and play counts, Continue Watching with progress
  bars, a Watch Again shelf, My List, Like and Not for me, and Because You
  Watched rows built from what you finished and liked.
- Hide watched toggle: finished titles drop out of every browse row and
  search result. Your own shelves (Continue Watching, Watch Again, My List,
  History) still show them, since that is what they are for.
- Six themes (Archive Red, Midnight, Forest, Sunset, Light, High Contrast)
  plus a custom accent color picker. Respects reduced motion settings.
- Export and import your data as a JSON backup from Settings.

## Run it

Option 1: open `index.html` straight in a browser.

Option 2: serve the folder, for example `python3 -m http.server`, then open
http://localhost:8000

Option 3: turn on GitHub Pages for this repo (Settings, Pages, deploy from
the main branch) and open the Pages link.

It needs internet access to reach archive.org. It is plain HTML, CSS and
JavaScript with no build step and no libraries.

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

## Privacy

History, My List, likes, theme and the optional OMDb key live in your
browser's local storage. Nothing is sent to any server except archive.org
(for the catalog, playback and downloads) and omdbapi.com (only when you
saved a key, only for IMDb ratings).

## Honest limits

- Playback position cannot be read from the Archive embed, so progress is
  user marked. That is stated in the player and on the details slider.
- Archive metadata is uploader supplied. Some titles, years and synopses
  are messy or missing, and a few uploads are mislabeled. The app shows
  what the Archive returns.
- Ratings shown as Archive ratings are Archive star ratings, not IMDb
  ratings. IMDb ratings appear only with an OMDb key, labeled as IMDb.
