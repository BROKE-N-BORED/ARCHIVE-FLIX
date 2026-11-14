# CHANGELOG

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
