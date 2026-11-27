# Google Play

App id (package name): `work.westerweel.nines` (Mark, 26 Nov 2026; `NINES_APP_ID` overrides it
for a test build). Mark creates the app in Play Console and decides every upload: nothing goes to
Google Play without his explicit OK.

## Target API level

**API 36 (Android 16).** Google's page says: "Starting August 31 2026: New apps and app updates
must target Android 16 (API level 36) or higher to be submitted to Google Play"
(https://developer.android.com/google/play/requirements/target-sdk, read 27 Nov 2026).
`android/variables.gradle` sets `compileSdkVersion` and `targetSdkVersion` to 36 (Capacitor 8.6.0's
template, the same as Bazibo); `minSdkVersion` is 24 (Android 7.0). CI fails when the built APK's
target is not 36.

## Listing

Category: Game, Role Playing (or Educational, Mark's choice). Contact email and website: Mark's.
Lengths below are counted in characters, the way Play counts them.

### English (en-US)

**Title** (23 of 30): Nines: Junior to Senior

**Short description** (79 of 80): A retro pixel RPG: fix broken servers in a terminal and grow to Senior engineer

**Full description:**

```text
Start as a Junior engineer in a small pixel-art town and work your way up to Senior.

Nines is a retro top-down RPG about the real work of keeping systems running. Talk to your colleagues, walk into the server room and sit down at a terminal. The machines are simulated, the problems are real-ish:

• A disk that is full, and something that keeps filling it
• A CI pipeline that broke for a reason nobody wrote down
• A service that will not start after last night's change
• And of course: it's always DNS

You type real commands (ls, df, du, grep, systemctl, journalctl, git and friends) into an in-game terminal with a built-in editor. Get it wrong and the game tells you what happened, sometimes painfully: yes, you can delete the database. Hints help when you are stuck.

Between incidents you face engineering conversations: a system-design interview on a whiteboard, a pager that goes off at 3 AM, a Friday afternoon full of scope creep. Pick your answers, order the steps, and keep your nerve.

• A career trail from Junior Village towards Senior Summit, with SRE and Platform Engineering tracks
• Earn money from fixed incidents and spend it on homelab gear, starting with a Raspberry Pi
• Play in English or Dutch
• Touch controls made for phones, portrait and landscape, and full keyboard support
• Your progress is saved on your device

No ads. No tracking. No account. No in-app purchases. The game makes no network connections at all and works fully offline.
```

### Nederlands (nl-NL)

**Titel** (29 van 30): Nines: van Junior naar Senior

**Korte beschrijving** (73 van 80): Retro pixel-RPG: repareer servers in een terminal en word Senior engineer

**Volledige beschrijving:**

```text
Begin als Junior engineer in een klein pixeldorp en werk je op naar Senior.

Nines is een retro RPG van bovenaf over het echte werk: systemen draaiend houden. Praat met je collega's, loop de serverruimte in en ga achter een terminal zitten. De machines zijn gesimuleerd, de problemen zijn bijna echt:

• Een schijf die vol is, en iets dat hem steeds weer vult
• Een CI-pipeline die stuk is om een reden die niemand opschreef
• Een service die niet meer start na de wijziging van gisteravond
• En natuurlijk: het is altijd DNS

Je typt echte commando's (ls, df, du, grep, systemctl, journalctl, git en meer) in een terminal in het spel, met een ingebouwde editor. Doe je iets fout, dan laat het spel zien wat er gebeurde, soms pijnlijk: ja, je kunt de database weggooien. Hints helpen als je vastzit.

Tussen de storingen door voer je engineeringgesprekken: een system-design-interview aan het whiteboard, een pager die om 3 uur 's nachts afgaat, een vrijdagmiddag vol scope creep. Kies je antwoorden, zet de stappen op volgorde en houd het hoofd koel.

• Een carrièrepad van Junior Village naar Senior Summit, met SRE- en Platform Engineering-routes
• Verdien geld met opgeloste storingen en koop homelab-spullen, te beginnen met een Raspberry Pi
• Speel in het Nederlands of het Engels
• Aanraakbediening voor telefoons, staand en liggend, en volledige toetsenbordbediening
• Je voortgang wordt op je eigen toestel bewaard

Geen advertenties. Geen tracking. Geen account. Geen aankopen in de app. Het spel maakt helemaal geen netwerkverbindingen en werkt volledig offline.
```

## Data safety (answers for the Play Console form)

- Does your app collect or share any of the required user data types? **No.**
  Play's form then asks nothing further about data types, encryption in transit or deletion.
- What happens to data: the save (progress, settings) is written to the WebView's
  `localStorage` inside the app's private storage and never leaves the device.
- The app has **no permissions** at all: the manifest removes `android.permission.INTERNET`, so
  the OS itself stops any network connection (`aapt2 dump badging` lists only AndroidX's
  app-internal `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which is not a user permission).
- No account, no login, no analytics, no advertising ID, no crash reporting, no third-party SDKs
  beyond Capacitor's WebView shell and AndroidX.
- Backups: `android:allowBackup="false"`, and on Android 12+ the data extraction rules exclude
  everything from cloud backup and device-to-device transfer. Uninstalling removes the save.
- Privacy policy: Play asks every app for a privacy policy URL. Text to publish (EN; NL below):

  > Nines does not collect, store on a server, or share any personal data. The game has no
  > account, no ads, no analytics and no network access. Your progress is saved only on your
  > device and is removed when you uninstall the app. Contact: (Mark's email).

  > Nines verzamelt geen persoonsgegevens, slaat niets op een server op en deelt niets. Het spel
  > heeft geen account, geen advertenties, geen analytics en geen netwerktoegang. Je voortgang
  > wordt alleen op je toestel bewaard en verdwijnt als je de app verwijdert. Contact: (e-mail
  > van Mark).

## Content rating notes (IARC questionnaire)

Category: **Game**. Expected outcome: PEGI 3, ESRB Everyone, USK 0.

- Violence: **none** (no fighting, no weapons; "battles" are job interviews and incident calls).
- Fear, horror: none. Sexual content, nudity: none. Bad language: none.
- Drugs, alcohol, tobacco: none. Gambling or simulated gambling: none.
- Humour: **mild**, about workplace mishaps ("you deleted the database"); no crude humour.
- Users interact with each other: no. User-generated content shared: no. Shares location: no.
- Digital purchases: none. Unrestricted internet access: no (the app has no network access).
- Target audience (App content > Target audience): 13 and over. Not designed for children, so
  the Families policy does not apply.
- Ads: the app contains no ads.

## Screenshot checklist

Play wants 2 to 8 phone screenshots (PNG or JPEG, sides 320 to 3840 px, at most 2:1), a
512 x 512 icon and a 1024 x 500 feature graphic.

- [x] Store icon 512 x 512: `assets/store/icon-512.png` (own art, `tools/art/draw-art.mjs`)
- [ ] Feature graphic 1024 x 500, own art only
- [ ] Phone portrait: the village with the dialogue box (NL and EN)
- [ ] Phone portrait: the terminal with the soft keyboard and quick commands
- [ ] Phone portrait: a battle (the whiteboard interview) in the portrait layout
- [ ] Phone landscape: the village with the controls on both sides
- [ ] The Career Trail with lit nodes
- [ ] The Homelab Store with the Raspberry Pi
- [ ] 7" and 10" tablet screenshots, if Play asks for them
- [ ] Every screenshot from a release build on a real phone, no debug overlays, status bar clean

## Release

The upload key is `~/.config/nines/upload-keystore.jks` on the agents' host (alias
`nines-upload`, created 27 Nov 2026, certificate SHA-256
`AA:7C:07:9D:3C:9D:AE:65:D6:95:17:08:2D:12:C0:FC:7D:91:20:94:A7:28:1C:A5:C1:34:9D:7E:FA:35:70:D0`).
Its passwords are in `~/.config/nines/keystore.env` (mode 600). Neither file is ever committed or
printed. With Play App Signing, Google holds the app signing key; this is only the upload key, so
a lost upload key can be reset through Play Console support.

Gradle reads the signing config only from the environment: `NINES_KEYSTORE`,
`NINES_KEYSTORE_PASSWORD`, `NINES_KEY_ALIAS`, `NINES_KEY_PASSWORD`. With none set, the release
build is unsigned and says so; with only some set, it stops. A signed build also stops without
`-PninesVersionCode`, or with `NINES_APP_ID` set to anything but `work.westerweel.nines`.

1. Set the version: `version` in `package.json` is the `versionName`; pick a `versionCode`
   higher than the last upload.
2. Build the web game and copy it in: `npm ci && npm run build && npx cap sync android`.
3. Build the signed AAB, one Gradle build at a time and memory-capped on the shared host:

   ```sh
   . ~/.local/opt/android-env.sh
   set -a; . ~/.config/nines/keystore.env; set +a
   cd android
   systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 \
     ./gradlew --no-daemon -PninesVersionCode=<N> bundleRelease
   ./gradlew --stop
   ```

4. Check it: `jarsigner -verify app/build/outputs/bundle/release/app-release.aab` says "jar
   verified", and `keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab`
   shows the upload key's SHA-256 above (the name in the certificate proves nothing; the
   fingerprint does).
5. **Only with Mark's OK:** Mark uploads the AAB in Play Console, first to Internal testing.
   The first upload enrols the app in Play App Signing and registers this upload key.

CI (`.github/workflows/ci.yml`, job `android`) builds a debug APK and an unsigned release AAB on
every pull request and push to `main` and keeps both as workflow artifacts for 30 days. The CI
debug APK is signed with a throwaway key per run, so installing a newer one over an older one
needs an uninstall first (which removes the save).
