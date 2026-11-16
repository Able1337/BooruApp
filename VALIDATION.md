# Verification of 0.1.1 — 2026-11-04

The supplied BooruApp-source.zip is the baseline. Its structure and existing implementation were preserved. No signing key or APK was present in the archive.

## Changes

- Missing or empty media URLs no longer resolve to the source homepage or `/undefined`.
- Null API rows and rows without an ID are ignored.
- Pagination uses the number of raw API rows, so filtering unavailable media does not prematurely end the feed.
- Favorites from both local storage and JSON import use the same validation, deduplication and HTTPS sample fallback.
- Removing a favorite refreshes the favorites grid; saving in the feed refreshes the heart indicators.
- Native-port arrival refreshes only the feed and leaves the favorites view intact.
- Native JSON export rejects files exceeding 5 MiB in UTF-8 bytes and overlapping export requests with a visible message.
- Version bumped to 0.1.1 (Android versionCode 2).
- APK workflow now also validates pull requests; Pages runs tests before deployment. Artifact upload fails if APK output is missing. Local build uses restrictive file permissions for generated signing keys.

## Passed

- Eight core tests: DAPI/Danbooru pagination and parsing, credentials and tags escaping, unsafe/missing media rejection, raw-row pagination, favorites validation.
- One application integration test with a simulated DOM and native message port: native request dispatch without browser fetch, search, stale-response rejection, video viewer construction/pause, favorite persistence and removal from the favorites grid.
- `npm test`, direct execution of both test files, JavaScript syntax check, shell syntax check.
- Both workflow files parsed as YAML and manually reviewed. This does not establish successful execution by GitHub Actions.
- Manual review of Java WebView setup, trust boundary, message-port lifecycle, HTTP redirects/limits, file chooser/export and fallback logic.

## Blocked / not tested

- No Android SDK, adb, emulator or /dev/kvm is installed. Build script was invoked and stopped because ANDROID_SDK_ROOT/ANDROID_HOME is not configured. No APK was produced or signature verified in this session.
- Android SDK download failed because the configured HTTP proxy at proxy:8080 was unreachable. Live Safebooru/media and Pages HTTP requests were not verified.
- No actual Android/WebView or real browser UI testing: layout, touch, media decoding, native HTTP, file picker, document export and bundled/Pages switching remain unverified on a device.
- GitHub API reports an empty Able1337/BooruApp repository with Pages disabled. A write attempt for .gitignore returned 403 Resource not accessible by integration, despite metadata advertising push permission. No repository content, Actions run or Pages deployment was created.
- The original v0.1 signing key is unavailable. A default local build would create a new development key; it cannot be assumed to update the installed v0.1. Supply the original key through the documented environment variables or Actions secrets, never in git.

## Next verification with a working SDK / GitHub access

1. Preserve the original private signing key outside the repository and configure signing variables/secrets.
2. Run `npm test` and `bash scripts/build-apk.sh` with Android SDK 35 and build-tools 35.0.0.
3. Install the signed APK; verify feed, tag search, image/video viewing, back navigation, favorites, JSON import/export and both interface modes. Check logcat for crashes and failures.
4. Upload source, enable GitHub Pages with GitHub Actions as its source, and confirm both workflows complete. Download the APK artifact and compare its signing certificate to v0.1 before attempting an update.
