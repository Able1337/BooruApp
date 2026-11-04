#!/usr/bin/env bash
# Explicit one-time migration, invoked only with the workflow remove_xray input.
set -euo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
backup="/root/booru-before-xray-removal/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup/binaries"
chmod 700 /root/booru-before-xray-removal "$backup" "$backup/binaries"
mapfile -t units < <(systemctl list-unit-files --no-legend | awk '$1 ~ /^(xray(@[^ ]*)?|x-ui|3x-ui)\.service$/ {print $1}')
paths=()
for path in /usr/local/x-ui /etc/x-ui /etc/xray /usr/local/etc/xray /usr/local/share/xray /etc/systemd/system/xray.service /etc/systemd/system/xray@.service /etc/systemd/system/x-ui.service /etc/systemd/system/3x-ui.service; do
 [[ ! -e "$path" ]] || paths+=("${path#/}")
done
binaries=()
pids=()
for comm_file in /proc/[0-9]*/comm; do
 [[ -r "$comm_file" ]] || continue
 read -r process_name < "$comm_file" || continue
 if [[ "$process_name" == xray || "$process_name" == xray-linux-* ]]; then
  pid="${comm_file#/proc/}";pid="${pid%/comm}";pids+=("$pid")
  binary="$(readlink -f "/proc/$pid/exe" 2>/dev/null || true)"
  [[ -z "$binary" ]] || binaries+=("$binary")
 fi
done
if ((${#paths[@]})); then tar -C / -czf "$backup/config-and-panel.tar.gz" "${paths[@]}";fi
if ((${#units[@]})); then systemctl disable --now "${units[@]}";fi
for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true;done
for attempt in {1..10}; do
 running=false
 for pid in "${pids[@]}"; do if kill -0 "$pid" 2>/dev/null; then running=true;fi;done
 [[ "$running" == true ]] || break
 sleep 1
done
for pid in "${pids[@]}"; do
 if kill -0 "$pid" 2>/dev/null; then echo 'Xray did not stop; review service before continuing.' >&2;exit 1;fi
done
for binary in "${binaries[@]}" /usr/local/bin/xray /usr/bin/xray /usr/local/x-ui/bin/xray-linux-amd64; do
 [[ -f "$binary" ]] || continue
 name="$(basename "$binary")"
 [[ "$name" == xray || "$name" == xray-linux-* ]] || { echo 'Unexpected Xray executable path; stopping.' >&2;exit 1; }
 mv -- "$binary" "$backup/binaries/${#binaries[@]}-$name"
done
systemctl daemon-reload
if ss -H -ltnp 'sport = :443' | grep -q xray; then echo 'Xray still owns port 443.' >&2;exit 1;fi
printf 'Xray stopped, autostart disabled and executables archived privately: %s\n' "$backup"
