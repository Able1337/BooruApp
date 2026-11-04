# Server deployment

Target: `https://frank.eben-grad.ru/` on `109.120.140.198`.

The browser calls same-origin `POST /api/posts`. The server forwards only bounded post-list requests to the Safebooru, Rule34 and Danbooru HTTPS APIs. Upstream redirects are rejected, API responses are capped at 4 MiB, requests time out after 25 seconds, and concurrency/rate limits apply. API keys are sent in POST bodies from the browser and in provider-required query parameters only on the outbound HTTPS request. Request bodies and provider errors are not logged. Media is loaded directly from its original HTTPS source.

Favorites and source credentials remain in browser local storage, separately for every origin. Import an existing favorites export to migrate; switching origins does not transfer data automatically. The server receives API credentials transiently to perform requests, but does not persist them. Only use the HTTPS site for entering keys.

## Installation

On Debian/Ubuntu, from a checked-out source tree, as root:

```sh
bash scripts/install-server.sh frank.eben-grad.ru
```

The installer uses Node 18+ with no npm dependencies, nginx, systemd and Certbot. DNS A/AAAA records must point at the server; ports 80 and 443 must be reachable. It creates a dedicated unprivileged `booru-pocket` user, serves on loopback port 18737, backs up this application's configuration in `/var/backups/booru-pocket`, and preserves unrelated virtual hosts. If the domain belongs to an existing nginx vhost or port 18737 is occupied by another service, installation stops for review.

Application releases are stored in `/opt/booru-pocket/releases`; `/opt/booru-pocket/current` selects the active release. The service is `booru-pocket`. Check status with `systemctl status booru-pocket` and logs with `journalctl -u booru-pocket`. The optional one-time `remove_xray` workflow input stops Xray and its managing panel, disables their autostart and archives Xray executables/configuration privately under `/root/booru-before-xray-removal`. It is false for normal deployments. Nginx config is `/etc/nginx/sites-available/booru-pocket.conf`.

For automatic deployment, run the **Deploy server** Actions workflow. It uses the repository secret `BOORU_DEPLOY_PASSWORD` for SSH and never includes the password in source. Remove that temporary secret in repository settings after the deployment if future deployments are not needed. SSH uses a runner-local host-key record from its first connection; the key is not committed.

## Verification

```sh
npm test
curl --fail https://frank.eben-grad.ru/healthz
```

The deployment workflow additionally verifies the server-specific page marker and a real Safebooru API response. Rule34 needs the user's own API credentials; it cannot be verified using the deployment secret. Runtime API credentials are unrelated to SSH credentials.

## IP HTTPS

The exact additional origin `https://109.120.140.198` is configured through `ADDITIONAL_ORIGINS`. Arbitrary other origins remain rejected. `scripts/enable-ip-https.sh` provisions an IP-address certificate with a separate Certbot 5.9 virtual environment and separate configuration directory `/etc/letsencrypt-booru-ip`. The nginx IP vhost is the default TLS server because clients connecting to IP literals do not send a DNS SNI name. Domain SNI still uses the domain certificate.

The short-lived IP certificate is automatically checked for renewal every four hours by `booru-ip-certificate-renew.timer`; the deploy hook reloads nginx. The distro Certbot and its existing domain certificate renewal are preserved. No private key or certificate account data is committed.

## Automatic publication

Pushes to `main` affecting the web UI, API gateway, tests, package metadata or server installation workflow automatically run **Deploy server**. It runs tests, installs the current source over SSH and verifies public HTTPS and API access on both the domain and IP address. New deployments supersede older queued/in-progress deployments in the `booru-server` concurrency group. Keep `BOORU_DEPLOY_PASSWORD` in Repository secrets for ongoing automatic updates. Source credentials entered in the browser are separate and are never added to this secret. The alternate Windows deployment remains manual as a fallback. APK builds only run automatically for Android/build-script changes; browser-only updates do not need an APK build.
