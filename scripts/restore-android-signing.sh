#!/usr/bin/env bash
# CI fallback: keep one private signing identity on the deployment server.
# This directory is outside the website and readable only by root.
set -euo pipefail
umask 077
: "${RUNNER_TEMP:?}"
: "${GITHUB_ENV:?}"
: "${SSHPASS:?BOORU_DEPLOY_PASSWORD is required when no signing secret is configured}"
if [[ -z "$SSHPASS" ]]; then echo 'A persistent signing keystore or deployment secret is required; refusing a new disposable signature.' >&2; exit 1; fi
signing_dir="$RUNNER_TEMP/booru-signing"
mkdir -p "$signing_dir"
ssh-keyscan -T 15 -t ed25519 109.120.140.198 > "$signing_dir/known-hosts"
ssh_options=(-o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$signing_dir/known-hosts" -o ConnectTimeout=15)
remote=root@109.120.140.198
if ! sshpass -e ssh "${ssh_options[@]}" "$remote" 'test -s /var/lib/booru-pocket-signing/release.jks && test -s /var/lib/booru-pocket-signing/password'; then
  openssl rand -hex 32 > "$signing_dir/password"
  export BOORU_GENERATED_PASSWORD
  BOORU_GENERATED_PASSWORD="$(cat "$signing_dir/password")"
  keytool -genkeypair -keystore "$signing_dir/release.jks" -storepass:env BOORU_GENERATED_PASSWORD -keypass:env BOORU_GENERATED_PASSWORD -alias boorupocket -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Booru Pocket' >/dev/null
  upload_id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:-1}"
  [[ "$upload_id" =~ ^[0-9]+-[0-9]+$ ]] || exit 1
  sshpass -e ssh "${ssh_options[@]}" "$remote" 'install -d -m 700 /var/lib/booru-pocket-signing'
  sshpass -e scp "${ssh_options[@]}" "$signing_dir/release.jks" "$remote:/var/lib/booru-pocket-signing/$upload_id.jks"
  sshpass -e scp "${ssh_options[@]}" "$signing_dir/password" "$remote:/var/lib/booru-pocket-signing/$upload_id.password"
  # A concurrent build must use whichever key was installed first.
  sshpass -e ssh "${ssh_options[@]}" "$remote" "flock /var/lib/booru-pocket-signing/lock sh -c 'set -eu; cd /var/lib/booru-pocket-signing; if [ ! -s release.jks ] && [ ! -s password ]; then mv $upload_id.jks release.jks; mv $upload_id.password password; fi; rm -f $upload_id.jks $upload_id.password; chmod 600 release.jks password'"
  unset BOORU_GENERATED_PASSWORD
fi
sshpass -e scp "${ssh_options[@]}" "$remote:/var/lib/booru-pocket-signing/release.jks" "$signing_dir/release.jks"
sshpass -e scp "${ssh_options[@]}" "$remote:/var/lib/booru-pocket-signing/password" "$signing_dir/password"
signing_password="$(cat "$signing_dir/password")"
printf '::add-mask::%s\n' "$signing_password"
printf 'BOORU_KEYSTORE=%s\nBOORU_KEY_ALIAS=boorupocket\nBOORU_KEYSTORE_PASSWORD=%s\nBOORU_KEY_PASSWORD=%s\n' "$signing_dir/release.jks" "$signing_password" "$signing_password" >> "$GITHUB_ENV"
echo 'Restored the persistent Android signing identity.'
