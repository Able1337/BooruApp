# Booru Pocket

Android API client with a shared static web interface. No application server, media proxy, account service, analytics, or runtime JavaScript dependencies.

## Version 0.1.1

- Masonry feed, tag search, paginated loading, image/GIF/video viewer.
- Local favorites, JSON import/export, keyboard navigation on desktop.
- Configurable HTTPS source: Gelbooru/DAPI or Danbooru JSON format. The default is **Safebooru**, a safe-for-work source. Custom sources require their own compatible public API and may require credentials.
- Android performs API GET requests using native HTTPS, so browser CORS restrictions do not apply to those API requests. Authentication, source availability, anti-hotlink rules, API limits, and terms still apply.
- Bundled web UI works before hosting is configured. The native **Интерфейс** button switches to `https://able1337.github.io/BooruApp/`. If the hosted page fails to load, the app falls back to the bundled interface.
- Ordinary browser use requires the source to permit CORS. There is no backend fallback or CORS proxy.

The hosted interface and bundled interface have separate browser origins and therefore separate local storage. Use favorites export/import to transfer between them. API keys remain on the device but are accessible to the trusted interface; never add keys to the repository or use an untrusted hosted UI. Some APIs use a different authentication convention; the generic optional fields currently support DAPI `user_id` and `api_key` only.

## Install

Download `BooruPocket.apk` from a successful **Build APK** Actions run (artifact **BooruPocket-APK**, unpack the ZIP). Android 8.0 or newer, with an updated Android System WebView, is required. Allow installation from the browser/file manager used to open the APK.

This initial APK is development-signed. It was built and its signature verified; device/emulator runtime testing has not yet been completed. An APK from a different signing key cannot update an installed copy. Export favorites before uninstalling.

## GitHub Pages

In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, then run **Publish web interface**. Expected URL:

`https://able1337.github.io/BooruApp/`

Pages only serves the UI. API requests and media go directly from the device to the selected source. To use another repository, update `REMOTE` in `android/src/ru/able/boorupocket/MainActivity.java` before rebuilding.

## Reproducible build steps

Requires JDK 17, Android SDK platform 35 and build-tools 35.0.0, `zip`, and Node 22 for the tests. No Gradle or npm install is needed.

```sh
sdkmanager 'platforms;android-35' 'build-tools;35.0.0'
npm test
export ANDROID_SDK_ROOT=/path/to/android-sdk
bash scripts/build-apk.sh
```

Output: `build/BooruPocket.apk`. The build compiles resources with AAPT2, Java with the JDK compiler, bytecode with D8, aligns the APK, signs it, and verifies the signature. The APK has no native ABI-specific libraries.

Without a configured key, a development key is generated in `build/debug.keystore`. Keep that file private and preserve it for subsequent local builds. GitHub runners generate a new development key per run unless persistent signing secrets are configured.

Optional GitHub Actions secrets for stable signing:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded private keystore |
| `ANDROID_KEY_ALIAS` | Alias in the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key password |

For local stable signing, set `BOORU_KEYSTORE`, `BOORU_KEY_ALIAS`, `BOORU_KEYSTORE_PASSWORD`, and `BOORU_KEY_PASSWORD`. Do not commit private keystores.

## Local web development

```sh
npm run serve
```

Open `http://localhost:8080`. Browser API calls depend on source CORS. `npm test` checks pagination, tag/credential escaping, both JSON formats, unsafe and missing URL rejection, favorites validation, and a simulated native-port/viewer/favorites flow. See VALIDATION.md for the scope of verification.

## Boundaries and security

Only the exact bundled document and this repository's HTTPS Pages document receive the native message port. There is no global JavaScript interface. External navigation opens the system browser. Native requests are GET-only, omit browser cookies, restrict destinations to public HTTPS/443, validate redirects, bound concurrency, and cap response size at 4 MiB. Remote UI updates execute with this client capability: protect the repository and review updates.

Favorites contain source metadata and media URLs, not downloaded media. No cross-device sync, account system, multi-source merged feed, background downloading, or offline media library is included in v0.1.
