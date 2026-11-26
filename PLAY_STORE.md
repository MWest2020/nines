# Google Play

A stub, filled in during the Android phase. App id: `work.westerweel.nines` (configurable
with `NINES_APP_ID`).

## Listing (draft)

**EN, short description (max 80 characters):** Grow from Junior to Senior engineer in a retro
pixel RPG.

**NL, korte beschrijving (max 80 tekens):** Groei van Junior naar Senior engineer in een retro
pixel-RPG.

**EN, full description:** to write. Points: real-ish engineering puzzles in a simulated
terminal (full disks, broken pipelines, services that will not start), a career trail from
Junior Village to Senior Summit, homelab gear, Dutch and English, no ads, no tracking, works
offline.

**NL, volledige beschrijving:** to write, the same points.

## Data safety (draft answers)

- Does the app collect or share any of the required user data types? **No.**
- Data is stored only on the device (`localStorage` in the app's WebView) and never leaves it.
- No account, no login, no analytics, no advertising ID, no crash reporting SDK.
- The release build has no `INTERNET` permission (to verify in the Android phase).
- Open question: Android Auto Backup of the WebView storage (see the phase-3 notes).

## Content rating notes (IARC questionnaire)

- No violence, no sexual content, no gambling, no drugs.
- Mild humour about workplace mishaps ("you deleted the database").
- No user-to-user interaction, no user-generated content shared in the app, no location.
- No purchases in the MVP.

## Screenshot checklist

- [ ] Phone portrait: the village with the dialogue box (NL and EN)
- [ ] Phone portrait: the terminal with the soft keyboard and quick commands
- [ ] Phone landscape: the village with the controls on both sides
- [ ] The Career Trail with lit nodes
- [ ] The Homelab Store
- [ ] 7" and 10" tablet sizes, if Play asks for them
- [ ] Feature graphic 1024 x 500, own art only
- [ ] Every screenshot made from a release build, no debug overlays

## Target API level

To record in the Android phase: the level Google Play requires for new apps at that moment,
with the link to Google's page that says so.
