#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk" ]]; then echo 'Set ANDROID_SDK_ROOT or ANDROID_HOME to your Android SDK.' >&2; exit 1; fi
bt="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
out="$PWD/build"
mkdir -p "$out/classes" "$out/dex" "$out/assets/web"
rm -rf "$out/classes" "$out/dex" "$out/assets"
mkdir -p "$out/classes" "$out/dex" "$out/assets/web"
cp web/index.html web/style.css web/app.mjs web/core.mjs web/sw.js web/manifest.webmanifest "$out/assets/web/"
cp -R web/icons "$out/assets/web/"
"$bt/aapt2" compile --dir android/res -o "$out/resources.zip"
"$bt/aapt2" link -o "$out/base.apk" -I "$platform" --manifest android/AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 35 -A "$out/assets" "$out/resources.zip"
find android/src -name '*.java' > "$out/sources.txt"
# Invoking the compiler module also works on JDK images without a javac launcher.
java com.sun.tools.javac.Main -encoding UTF-8 -source 8 -target 8 -classpath "$platform" -d "$out/classes" @"$out/sources.txt"
(cd "$out/classes" && java sun.tools.jar.Main cf "$out/classes.jar" .)
"$bt/d8" --min-api 26 --lib "$platform" --output "$out/dex" "$out/classes.jar"
cp "$out/base.apk" "$out/unsigned.apk"
(cd "$out/dex" && zip -q "$out/unsigned.apk" classes*.dex)
"$bt/zipalign" -f -p 4 "$out/unsigned.apk" "$out/aligned.apk"
key="${BOORU_KEYSTORE:-$out/debug.keystore}"
alias="${BOORU_KEY_ALIAS:-androiddebugkey}"
export BOORU_KEYSTORE_PASSWORD="${BOORU_KEYSTORE_PASSWORD:-android}"
export BOORU_KEY_PASSWORD="${BOORU_KEY_PASSWORD:-$BOORU_KEYSTORE_PASSWORD}"
if [[ ! -f "$key" ]]; then
 if [[ -n "${BOORU_KEYSTORE:-}" ]]; then echo 'Configured signing key does not exist.' >&2; exit 1; fi
 keytool -genkeypair -keystore "$key" -storepass "$BOORU_KEYSTORE_PASSWORD" -keypass "$BOORU_KEY_PASSWORD" -alias "$alias" -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Booru Pocket Development' >/dev/null
fi
"$bt/apksigner" sign --ks "$key" --ks-key-alias "$alias" --ks-pass env:BOORU_KEYSTORE_PASSWORD --key-pass env:BOORU_KEY_PASSWORD --out "$out/BooruPocket.apk" "$out/aligned.apk"
"$bt/apksigner" verify --verbose "$out/BooruPocket.apk"
echo "Built: $out/BooruPocket.apk"
