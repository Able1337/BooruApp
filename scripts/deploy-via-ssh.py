"""Alternate CI deployment. Credentials come exclusively from the Actions secret."""
import json
import os
from pathlib import Path
import re
import shlex
import tarfile
import tempfile
import time
import urllib.request
import paramiko

sha = os.environ['GITHUB_SHA']
if not re.fullmatch(r'[0-9a-f]{40}', sha):
    raise SystemExit('Invalid release identifier')
password = os.environ.get('BOORU_DEPLOY_PASSWORD', '')
if not password:
    raise SystemExit('BOORU_DEPLOY_PASSWORD is not configured')
remote = '/tmp/booru-source-' + sha
with tempfile.TemporaryDirectory(prefix='booru-deploy-') as folder:
    archive = Path(folder) / 'source.tar.gz'
    with tarfile.open(archive, 'w:gz') as bundle:
        for name in ['web', 'server', 'scripts', 'tests', 'package.json']:
            bundle.add(name, arcname=name)
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    # Equivalent to a first-connection SSH host-key record on an ephemeral runner.
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('109.120.140.198', username='root', password=password,
                   timeout=20, auth_timeout=20, look_for_keys=False, allow_agent=False)
    try:
        with client.open_sftp() as sftp:
            sftp.put(str(archive), remote + '.tar.gz')
        command = (f'set -eu; mkdir -p {shlex.quote(remote)}; '
                   f'tar -xzf {shlex.quote(remote + ".tar.gz")} -C {shlex.quote(remote)}; '
                   f'bash {shlex.quote(remote + "/scripts/install-server.sh")} frank.eben-grad.ru; '
                   f'bash {shlex.quote(remote + "/scripts/enable-ip-https.sh")}; '
                   f'rm -rf {shlex.quote(remote)} {shlex.quote(remote + ".tar.gz")}')
        channel = client.get_transport().open_session()
        channel.exec_command(command)
        while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
            if channel.recv_ready():
                print(channel.recv(32768).decode('utf8', 'replace'), end='', flush=True)
            if channel.recv_stderr_ready():
                print(channel.recv_stderr(32768).decode('utf8', 'replace'), end='', flush=True)
            time.sleep(0.1)
        if channel.recv_exit_status() != 0:
            raise SystemExit('Remote installation failed; see application installer output')
    finally:
        client.close()

body = json.dumps({'url': 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&pid=0&limit=1&tags=landscape'}).encode()
for origin in ['https://109.120.140.198', 'https://frank.eben-grad.ru']:
    with urllib.request.urlopen(origin + '/healthz', timeout=30) as response:
        assert json.load(response)['ok'] is True
    with urllib.request.urlopen(origin + '/', timeout=30) as response:
        assert 'sourceCards' in response.read().decode('utf8')
    request = urllib.request.Request(origin + '/api/posts', data=body, headers={
        'Content-Type': 'application/json', 'Origin': origin})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
        assert isinstance(payload, list) or isinstance(payload.get('post', payload.get('posts')), list)
    print('Verified HTTPS, multi-booru interface and API:', origin)
