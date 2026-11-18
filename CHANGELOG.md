# CHANGELOG

## v1.6.2 - 2026-11-17

Fix-everything build from the 2026-11-17 live QA round 2 (desktop plus
phone), which re-verified the round-1 fixes and found what still failed
plus new issues. This release also includes everything from v1.6.1,
which never got a Release of its own. 385 node checks pass across the
v1.6.2 suites, plus 14 shell tests (128 checks) for the updater and 46
live archive.org checks.

Finished state and Watch Again (Desktop 4, Phone R2-7): fixed the root
cause of the contradictory Finished state: a position save (pause,
close, playback tick) used to overwrite a finished entry with the stale
mid-film playhead, so a finished title slid back into Continue Watching
with a resume position, History showed "Resume from" instead of
Finished, and the Watch Again row stayed empty. Position saves now
never un-finish a title: one finished during the current open keeps its
finished state, one opened finished only counts as in progress again
once a few real seconds have played, and a save at 0 seconds never
wipes a saved place. An explicit restart or manual percent re-opens
position saving. The Watch Again row on Home now appears as soon as
anything is finished (it already existed in code but could never fill
while finished entries kept reverting); finished titles leave Continue
Watching. Details status is consistent with the player and History: a
finished title says just "Finished.", a show says "N episodes finished."
when some episodes are finished and none is in progress, and a show
reads Finished (with a Watch Again button) only when every episode in
its own upload is finished. Finishing one episode marks only that
episode. The Finished button now ships as a ghost button like the
25/50/75% buttons and only turns gold once the title is actually
finished.

Next episode (Desktop 20): new per-profile "Play the next episode
automatically" setting in Settings, under Playback. Default is ON, the
Netflix-like choice; profiles saved before the setting existed migrate
to on. The end-of-episode offer respects the setting: with auto-advance
off there is no countdown and nothing starts without a tap (the offer
still shows Play now and Cancel, and says auto-advance is off). New
Next episode button in the player (shows only for an episode that has a
next one in the same upload; it saves the current episode's place
first) and in show details (plays the episode after the one last
watched; hidden when nothing was watched or on the last episode).

Player (Phone R2-2, R2-8): the Back/Retry button in the player error
state now renders in an actions row below the video frame instead of
inside the fixed 16:9 frame, where overflow clipping cut it to its top
half. Episode 0 now displays as "Pilot" everywhere (episode rows,
player title, next-episode offer), never "S1 E0", and no episode number
is invented for it. The player title keeps the show name verbatim:
"The Twilight Zone Pilot: Original Pilot" instead of "Twilight Zone
S1 E0: Original Pilot".

Two-tap confirms (Desktop 12): the profile-delete confirm and the
Forgot-PIN confirm no longer expire on a timer at all: the armed state
stays until the second tap, until another profile's delete is armed,
until Escape disarms it, or (for Forgot PIN) until the PIN sheet
closes. This replaces the 10-second window (DELETE_ARM_MS is gone).

Dedupe (Desktop 15): same normalized title AND years within 7 years
collapse to one entry, anchored on the best upload (most downloads,
then best rating); years far apart stay separate, so remakes survive.
An upload with no year at all joins the title's main entry. The window
is 7 because uploaders mislabel years by that much: Horror Express
uploads carry 1972, 1973 and 1976; one Nosferatu upload carries 1929
for the 1922 film. The tightest same-title remake gap in the catalog
era is 9 years (The Front Page 1931 vs 1940; The Maltese Falcon 1931
vs 1941), so 7 keeps every remake apart, and anchor clustering (not
chaining) means a run of mislabeled years can never bridge two remakes.
Live result: Horror Express 11 uploads in feature_films collapse to
one card; Night of the Living Dead 15 uploads to one; House on Haunted
Hill 11 uploads to one. Browse cross-page dedupe uses the same rule.
Episodes: the upload's own files and the sibling uploads are now
merged into one deduped, ordered list instead of two blocks, so an
episode shows once and S1E1 sorts before S1E2 whichever source each
came from. Episode twins match by title plus compatible numbers, the
kept copy inherits numbers the twin carries, and doubled letters
collapse in the title key so a misspelled file name matches its
sibling upload. Language and version markers are tags too: "Detour
Vostfr" is the same film as "Detour", so vostfr, vost, vf, vo, subbed,
dubbed and subtitles are stripped from the match key the same way. A
translated title ("Detour - El desvio") is not a tag and still does
not match; that needs a different mechanism, if it is wanted at all.

"Not for me" (Desktop 5) and Hidden titles: "Not for me" now hides by
normalized title-plus-year identity (the same-film rule), not by item
id, so every duplicate upload of a hidden film stays hidden in Browse
search, rows and recommendations. A remake of a hidden title still
shows. Settings gains a Hidden titles list showing what this profile
marked "Not for me", sorted by title, with a Show again button per
title that clears the mark and refreshes the rows. How to Use points
at it.

More Like This (Desktop 11, Phone R2-6): root cause fixed: the success
handler appended cards WITHOUT clearing the skeleton markup, so the
first three slots stayed blank grey skeletons forever with the real
cards only from the fourth slot on. The row is now cleared before the
cards go in. (The fetch itself cannot hang: fetchWithTimeout rejects
at 15s and the error path replaces the skeletons.) MLT now shows a
"Finding similar titles..." loading line while the search runs, and
the row is deduped by the same-film rule (Horror Express no longer
appears twice).

Adult leaks (Desktop 14): general rule, each candidate checked live
against the full population it would move. ADDED to the adult
subjects: "stripper", "strippers", "stag" (Teaserama and two more
striptease shorts, nothing else), "mondo" (three exploitation
documentaries), "child molester", "child molestation" (child-safety
signals). ADDED title phrases that are adult or child-safety signals
wherever they appear: "child molester", "child molestation", "jail
bait", "jailbait" (every "jail bait" title in the catalog collections
is the 1954 Ed Wood film). ADDED the untagged exploitation titles with
no general signal to the query and the blocklist: "naked witch",
"naked massacre", "invasion of the bee girls", "teaserama".
DELIBERATELY NOT ADDED, with live evidence: "burlesque" (would move
Chaplin's A Burlesque on Carmen and Lady of Burlesque),
"exploitation" and "grindhouse" (would move Mad Max, Frogs, Alligator,
Reefer Madness, Santa Claus Conquers the Martians, Manos), "nudity"
(would move Lone Wolf and Cub and One Summer of Happiness), "nude"
(would move a BBC Duchamp interview), "naked" (would move The Naked
City, The Naked Street, The Naked Kiss, The Naked Island), "sexy"
(uploaders tag even a 1951 family drama with it). ADULT_QUERY is now
built from the subject and title lists, so the query and the
client-side checks cannot drift apart; ADULT_EXCLUDE negates both
clauses. The 18+ catalog grows from 107 to 173 titles across the
three collections. Live verification, both ways, with the app's own
query strings: each of the six titles returns from the 18+ section
query and 0 from the normal exclusion; 12 mainstream titles return 0
from the 18+ query. The four v1.6.1 blocklist titles (In the Realm of
the Senses, Diary of a Nudist, Real Sex, Child Bride) were client-side
only, which left them invisible everywhere including the 18+ section;
they are now named in the query titles too, so the section returns
them (each phrase checked live: every match is the adult film
itself). Browse count leak fixed: searchArchive now reports how many
items the adult filter removed and the Browse count subtracts them,
so a search that only matches blocked titles reads "0 titles match",
never "2 titles match... Showing 0". Known limitation: the
subtraction covers the pages fetched so far; a blocked title sitting
on a later, unfetched page can still inflate the total, but the count
then reads as an ordinary match count and cannot reveal that a
specific blocked title exists. Sex Madness STAYS in the 18+ section
per Joshua's decision 2026-11-17, reversing the v1.4.0 decision that
kept it in normal browsing; bare "sex" was NOT removed from
ADULT_QUERY.

Shelves show real ratings (Phone R2-1 / P8): continueWatchingItems,
watchAgainItems and myListItems no longer hardcode rating null and
downloads 0; they carry the rating and downloads the history entry or
My List snapshot stored, so cards show "Archive 4.0" instead of "No
rating", and details opened from them does too. Unrated titles still
honestly show "No rating".

Download (Desktop 8): the details button now reads "Open in new tab
(303 MB)" on every title from the first render, never "Download" for
something that opens a tab. The tap still attempts a real blob
download first (fetch, then save through an object URL); only a
download that actually succeeds re-labels the button "Download", and
a blocked fetch keeps the honest new-tab label and remembers the
fallback for the session. In practice the Archive's file servers send
no CORS headers, so the new tab remains the path users will see.

Details poster, rows, cards, text: the details poster changed from
object-fit contain to cover, so a landscape Archive frame no longer
renders as a thin horizontal strip in the middle of a tall grey box.
(A natural-dimensions approach that letterboxes landscape images with
contain was suggested after this fix was built; the built fix was left
as-is per instruction. Note that landscape plus contain in the
portrait frame is the thin-strip look QA flagged, so any future
revisit should change the frame shape too, not just the fit.) The
first card in 18+ rows is no longer clipped at the left edge: fillRow
resets the row's scroll offset on every fresh fill, and row side
padding went from 4px to 8px so the end cards clear the scrollport
edge. "Load more" hides while "Searching archive.org..." is showing,
stays hidden when a Browse search returns 0 results, and only returns
when results arrive with more pages behind them; a failed Load more
puts the button back so the user can retry. Card metadata is no longer
duplicated in text: the title-card fallback no longer prints the
"1968 · Movie" line the card body already shows, and badges no longer
run together ("1959 · Show TV Show No rating Watched").
Descriptions no longer open with raw boilerplate: cleanText strips a
leading "Title: ... Summary:" prefix and a lone leading "Summary:".
The year is no longer appended when it already appears anywhere in
the title ("The Twilight Zone 1959 S01" stays as-is). "Because you
watched" rows capitalise the subject ("Because you watched Horror").

Posters: a resolved poster from a CORS-serving host (TMDB, OMDb,
Wikimedia Commons) is now probed through a canvas; a blank one falls
back to the title card and is dropped from the poster cache (replaced
by a null, so it re-resolves tomorrow instead of being served as a
good result for 30 days). A probe that cannot read its pixels fails
open, and Archive poster files (no CORS headers) are never probed and
stay trusted. Honest limits: the Beverly Hillbillies blank
dark-green/black image is an Archive thumbnail (services/img), which
archive.org serves without CORS headers, so no canvas probe can read
its pixels and the blank frame cannot be detected without an OMDb/TMDB
key or CORS headers from archive.org. Placeholder walls persist for
the same reason: without keys, only the Archive's own poster files
and Commons supply real posters.

Linux desktop update check (standing order 2026-11-17): the Linux
desktop install now checks for updates on launch. The check is
silent: up to date, offline, or check failed means nothing happens
and the app just opens. When a newer release exists, the launcher
asks first (zenity, kdialog, or nothing when no dialog tool is
present, in which case it launches normally). Only on a yes does it
download the release. Downloads are installed only after their
SHA-256 matches the checksum published with the release: a SHA256SUMS
sidecar asset when the release carries one, otherwise the SHA-256 in
the release notes. With no checksum anywhere, or a checksum that does
not match, the update is refused and the user is told why. After an
install the launcher asks before restarting. Yes restarts the program
on the new version; no leaves the new files in place and the update
takes full effect on the next launch. New file archiveflix-update.sh
holds the check, download, verify, and install logic; archiveflix.sh
runs it before opening the app; install.sh copies it into the install
and writes a VERSION file with the installed version. Fixed the
launcher and README claim that the installed copy "picks up updates
the same way the web app does": the loopback server only serves the
installed files, so the service worker can only cache the installed
snapshot; it never pulled new releases. The launch-time check is now
the update path. Release requirement: every release must publish the
tarball SHA-256, as a SHA256SUMS sidecar asset (preferred) or in the
release notes, or the updater will refuse to install it. The release
tarball must also include archiveflix-update.sh.

## v1.6.1 - 2026-11-16

Fix-everything build from the 2026-11-16 live QA pass (20 errors, UI
problems, gaps) plus a phone-width pass at 390px that the QA round could
not do. 431 node checks pass across the v1.6.1 suites.

My List and profiles (errors 1-2, 12): My List renders again. The view
lookup built the wrong section id ("mylistView" instead of "myListView"),
so the page went blank and the nav never switched; the lookup now uses
an explicit map with a null guard. The PIN dialog opens above the
profile picker instead of behind it. The two-tap delete confirm window
is 10 seconds instead of 5, with an outline and aria-pressed while
armed; the Forgot-PIN confirm gets the same window. The active profile
is remembered across reloads (a locked profile still asks for its PIN
first). How to Use now says "Tap your avatar in the top bar to switch
profiles", and the picker's Back button sits under the heading.

Playback and resume (errors 3-4, 6-7, 9, 19): show-level Play resumes
the in-progress episode instead of restarting the season file. The
Finished chip only highlights gold when the title is actually finished,
and tapping it marks the title finished without closing the player
(Watch Again picks it up). The duplicate "Start from the beginning"
button is gone; the one restart button works in both modes. The
"Watched N times" counter counts a play when playback actually starts,
once per viewing, and sums across a show's episodes. Closing the player
refreshes the open details sheet, so it shows the new resume position
instead of "Not started yet". History collapses a show's season-level
and episode plays into one row, resuming the in-progress episode.
Next-episode autoplay: when an episode in a multi-file upload ends, an
overlay offers the next episode with an 8-second countdown (Play now /
Cancel). There is no "Skip intro": the Archive carries no intro
timestamps, so nothing is faked.

Downloads (error 8): the Download button attempts a real file download
(fetch to a blob, then a download link) and falls back to opening the
file in a new tab, relabeled "Open in new tab", when the browser blocks
the cross-origin fetch. In practice the Archive's file servers do not
send the CORS headers a browser fetch needs, so the new-tab fallback is
the path users will see; the button says so honestly instead of
promising a download it cannot do.

Catalog, adult isolation, dedupe (errors 14-16): four adult titles that
leaked into normal browsing ("In The Realm Of The Senses", "Real Sex",
"Diary of a Nudist", "Child Bride") were untagged, so no subject filter
could catch them; they are now blocked by identifier and by title
(catching future re-uploads), the adult pool covers all three catalog
collections, and ungated results are never cached. Duplicate catalog
entries collapse by normalized title + year, keeping the most
downloaded upload. Top Rated / Top IMDb / "rated" sorts now rank by a
review-weighted score instead of the raw average, so a 5.0 from one
review no longer outranks a 4.6 from fifty; unrated items show "No
rating" instead of 0.0. Saved snapshots now carry the rating and
downloads, so My List, Continue Watching, Watch Again, and History
cards show the real badge instead of "No rating" for every saved or
watched title (titles saved before this fix show "No rating" until
re-saved or re-watched).

Search, sort, recommendations (errors 5, 10-11, 17): "Not for me" now
hides the title from home rows, adult rows, Browse, Because rows, More
Like This, and Continue Watching / Watch Again immediately (My List is
untouched: it holds the user's explicit saves). "Year, newest first"
now sorts by the derived release year client-side on every page,
unknowns last. More Like This shows skeleton cards while it loads. Home
eagerly loads six rows instead of three and prefetches further ahead,
so rows stop painting empty. Recommendations rank by shared subjects,
type, and era, never return the seed title itself, and Because rows
keep the seed's real casing.

Titles, posters, labels: titles are cleaned of junk parentheticals and
tails, duplicate years collapse to one, and decorative Unicode
(fraktur, skulls) is normalized away; Archive collections no longer
appear as titles in Browse. Hero descriptions no longer start with a
pasted URL. Poster matching now requires every significant title word
(or the full phrase) in the Commons filename, and TMDB no longer takes
a zero-score first result, so the wrong posters the QA pass found (a
COVID poster for The General, Goliath-and-the-Dragon for David and
Goliath) no longer resolve; the poster cache version bumped so cached
wrong posters re-resolve. Type labels fixed: season/episode titles and
TV subjects now read Show, and cartoon subjects lose to episode and
drive-in markers. Episode titles lose the show name and year in front
("The Twilight Zone 1959 The Chaser" is now "The Chaser"); show names
are found even when the title carries a leading "The" the subject
lacks. The player title and card labels no longer repeat the year
("(1915) (1915)").

Details: cast/crew and maturity ratings appear when an OMDb or TMDB key
is saved (Director/Actors/Rated from OMDb, credits + US certification
from TMDB), cached like posters; without a key the section stays
hidden. Star ratings (1-5) sit beside Like / Not for me, per profile,
tap-again clears. Subtitles and audio pickers appear in the player only
when the file actually exposes tracks; most Archive files expose none,
so the selectors usually stay hidden, as intended.

Layout and chrome: row arrows sit in the gutters instead of floating
over edge cards, and the native scrollbar track under each row is
hidden. Rating pills sit on their own line with a gap, consistently
placed, and cards with no year or rating show no empty meta. Toasts
dock above the footer, replace instead of stacking, and last 5s (7s for
actions). The hero scrim is deeper so titles stay readable over bright
frames, and dialog posters use contain so faces and poster text are not
cropped. The custom accent picker is now 8 preset swatches plus a hex
field (the native color popover is gone); every preset passes 4.5:1 for
button text. The duplicate Hide-watched checkbox in Browse is gone; the
top-bar one remains. History progress bars are thicker with a visible
minimum fill. The footer attribution and Browse caption wrap instead of
clipping mid-word. The Install help text follows the Install button
(manual Android/iPhone steps always visible).

Phone width (390px pass): the Hide-watched label stays visible in the
top bar (room from a smaller wordmark, tighter gaps, and a gear-icon
Settings button); the profile button is a full 44px; star buttons are
44px wide; the row Retry button centers instead of stretching to card
height; the fallback hero shrinks to its content instead of holding a
tall empty slab; History rows wrap so the buttons drop below the text
instead of squeezing the meta into a one-word-per-line column. Accent swatches stay 36px: shrinking them to fit one
row would make the targets smaller to fix a cosmetic wrap. No
horizontal overflow on any audited screen.

Not fixed / honest limits: error 20 (a stream dropping once and
recovering) is evidence the recovery path works, not a defect.
Cast/crew and maturity ratings could not be verified against the live
OMDb/TMDB APIs (no keys provided); the data path is tested with
stubbed responses. "Skip intro" is not feasible (no intro timestamps
in Archive data). The item's-own-files poster layer cannot be
title-guarded, so a wrong poster shipped inside an upload itself cannot
be caught by matching. Video-frame thumbnails (the real blank/credits
fix, decision D1) still need Joshua's call.

## v1.6.0 - 2026-11-15

Full review build: 91 of the 95 tasks from the 2026-11-15 review task list
are in this release (tasks 7 and 78 are artifact-only and stay with the
Muse app; task 61, the bottom tab bar, and decisions D1-D4 still need
Joshua's call; task 95, StartupWMClass, is blocked on a live desktop
check). Tasks 82 and 93 are partial, see the installer notes below.
466 node tests pass across the three v1.6.0 suites.

Playback and resume (tasks 1-6, 8): a stream dying mid-film no longer
marks the title finished. The player only finishes when the playhead is
genuinely within a few seconds of the end; a false end reloads the same
file, seeks back to the saved place, and resumes in place, with retries
before falling back to the embed player. Video errors retry the same
file once, then try the next playable candidate, and only then fall back
to embed with a toast explaining why. Position is saved before switching
to embed, and a failed metadata fetch shows an error state with Retry
instead of a blank frame. Manual percent buttons now set position from
the fraction and duration, so resume stops showing a stale position.
Stale episode responses are guarded by a per-open token, and a missing
episode file shows "This episode file is no longer available" instead of
silently playing the wrong video. Embed mode gains a 0% button, and
marking Finished in embed mode runs the same rescan-and-return-Home flow.

Catalog, search, filters, recommendations (tasks 9-19): searches and
filter changes made while a fetch is in flight are no longer dropped;
stale responses are discarded and a queued re-run follows. A-Z and year
sorts now page through the server (titleSorter and year sorts verified
live) with Load More and no 100 cap. The minimum rating filter adds a
server-side avg_rating clause. Identical simultaneous queries fetch
once. More Like This skips generic subjects and matches the item's type
and collection. The year max derives from the current year (including
the "2000s and later" decade, now open-ended), and picking a year clears
the decade. The search cache returns copies, so enrichment no longer
leaks across rows. The title count is worded honestly and Load More
auto-advances through empty pages. Title search escapes special
characters and ANDs its terms. The YouTube-rip filter applies whenever
cartoon results are included. Because You Watched rows cover shows and
cartoons too, and in-progress titles seed them with a small weight.

History, My List, profiles, data (tasks 20-31): old history and My List
entries get their adult flags backfilled from metadata subjects
(batched, at most once per entry per session), history entries are
re-flagged when a title is opened, and adult reactions no longer seed
normal recommendation rows. A corrupt profiles store is preserved under
a backup key and the app shows a "your saved data looks damaged" state
with recovery, download, fresh-start, and carry-on options instead of
silently wiping everything. When storage is full or unavailable, a
persistent warning offers export, clearing posters, or erase. The PIN
pad has a growing delay and a 60 second lockout after 5 failed attempts.
PINs now hash with SHA-256 via the browser crypto API and a per-profile
salt; old hashes keep verifying and migrate on the next successful
unlock, so nobody is locked out. Importing a backup asks for
confirmation naming what will be replaced, with an export-first step.
Profile switches and hide-watched toggles refresh the 18+ rows and the
Browse grid. History is capped at the newest 1000 entries and the OMDb
cache at 200. Playback persistence is debounced (at most every 20
seconds, plus on pause, hide, and close) instead of re-saving all
profiles every 5 seconds. Hide-watched uses episode history keys.
Delete-profile and wipe refresh the 18+ nav state. Settings notes that
backups contain API keys and PIN hashes.

18+ section (tasks 32-37): removing a profile PIN auto-disables the
section, and entry requires a PIN whenever the section is enabled,
closing the imported-backup hole and the confirm-then-remove race. The
artifact app's identity gate is ported: normal results whose normalized
title plus year matches a title in the 18+ pool are dropped (one
session-cached pool query), catching untagged duplicates. Adult
detection matches whole words and phrases, so "adult education" and
"adultery" no longer false-positive while "German Sex Comedy" still
matches. More Like This takes an explicit adult-context flag instead of
reading a DOM class. A manual override list covers the known mistags
(You're Never Too Young, Goliathon / Mighty Peking Man) and is easy to
extend. Adult animation gets its own row in the section.

Posters, thumbnails, years (tasks 38-42): bad OMDb/TMDB keys are
detected once (401, 429, and OMDb's own error messages), the provider is
disabled for the session, and Settings shows a warning; failures are
negative-cached briefly and no longer double-call per card. Failed
poster lookups cache as "no poster" for one day instead of 30, and nulls
do not count toward the 400-entry cap. TMDB prefers results whose title
and year match. A thrown poster lookup is retried instead of being stuck
as attempted. When the derived year is suspicious (equal to the upload
year) and a key is saved, the year is cross-checked against OMDb or TMDB
by title; without a key the residual stands and stays documented.

Episodes (tasks 43-47): resolution strings like 1280x720 no longer parse
as season and episode numbers. A show with no episode data explains
itself instead of showing nothing. The sibling search cap is 200 with
deduplication across both episode blocks. Episode resume keys use
season, episode, and title (legacy file-based keys migrate lazily on
read). Cartoon series get episode sections too.

Layout, UI, accessibility (tasks 48-60, 62-74): the Midnight theme now
passes contrast both ways (white on #1d4ed8 is 6.70:1; accent-as-text
uses #60a5fa at 6.14:1 or better on every surface). Dialogs move focus
in on open, trap Tab, and restore focus on close. Focused carousel
arrows are visible. Toasts last 4 seconds (7 for long messages), queue
instead of replacing, and "History cleared" has Undo. Skeleton cards
match real card geometry. The hero shows a skeleton while loading. The
pull-to-refresh pill positions itself from the measured topbar height,
and the topbar Hide watched label hides on phone. Phone arrows are 36px
and show for 1.2 seconds. Touch targets are 44px (40px for small
buttons). Empty states and the Browse error offer actions. The "Not for
me" button shows its state. Custom accents get a real WCAG contrast
guard plus a text-safe variant. A skip link leads the page. Browse shows
four filters by default with the rest behind More filters. The sheet
Close button stays visible (sticky). Settings shows the app version
(v1.6.0) and a How to Use section. A Density setting (Comfortable /
Compact) is available per profile. Forced-colors mode gets visible
borders. Hero text has shadows on kicker, meta, and description.
Headings keep clearance at 200% text. Active chips show a check. Posters
fade in over 150ms. Cards enter with a capped stagger. The topbar hides
on scroll down and returns on scroll up. Profile inputs get the 3px
focus ring.

Performance and error handling (tasks 75-77, 79-81): every network call
has a timeout (15s search/metadata, 10s posters) through one shared
helper, with Retry states. Below-the-fold Home rows load on scroll into
view instead of all 21+ searches firing at once. Directors and Cartoons
failures reach the Retry state, and Load More failures toast. The search
and metadata caches are LRU-capped at 100 entries each. Re-scan clears
the metadata cache too. The hero falls back to the first non-empty row
when Trending filters to empty.

PWA, offline, installer, desktop (tasks 82-94, 95 blocked): PNG icons
(180, 192, 512) are generated from the SVGs and ship in the release
tarball; the web install still uses SVG because the GitHub push path
carries text only, so the PNGs cannot be pushed to the repo yet. The
Linux launcher now serves the installed app over a loopback server
(http://127.0.0.1:18471), which enables the service worker and the update
flow on desktop; it reuses a running server for our files, refuses to
run when another service owns the port, and falls back to file:// when
python3 is missing. The README points Linux users at the Release .tar.gz
instead of the Code Download ZIP (the tarball preserves the runnable
bit; the snapshot push cannot carry file modes). install.sh pre-checks
icon-192, uses xdg-user-dir for the desktop folder, escapes $HOME in sed
and uses literal grep for verification. The launcher shows a message via
zenity, kdialog, or notify-send when no browser exists. A new
uninstall.sh removes the app, both desktop entries, and stops the
loopback server. The manifest gains categories and Browse/My List
shortcuts (the app now deep-links from #browse and #mylist); manifest
screenshots are blocked on the same binary-push limitation as the PNG
icons. The installer entry checks each candidate folder for install.sh
before running. Service worker install tolerates individual file
failures, the poster cache covers TMDB, OMDb, and Wikimedia hosts, and
registration uses updateViaCache none so update checks always
revalidate. The shell cache is v9. Task 95 (StartupWMClass) is not
shipped: no confident value could be established from documentation, and
it needs a live desktop check.

Not in this release: task 61 (bottom tab bar) and decisions D1 (video
frame thumbnails), D2 (year filter alignment), D3 (kids profile), D4
(Top IMDb alignment) all need Joshua's call. Tasks 7 and 78 belong to the
Muse app copy. Task 95 needs a live desktop check. The V1-V10 phone and
PC verifications still need his devices.

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
