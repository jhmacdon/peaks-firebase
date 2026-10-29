import datetime
import hashlib
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

url, destination = sys.argv[1:3]
path = pathlib.Path(destination)
if path.exists():
    raise SystemExit('Refusing to replace cached bytes: ' + str(path))
path.parent.mkdir(parents=True, exist_ok=True)
data = None
headers = {'User-Agent': 'peaks-glacier-import/1.0'}
if len(sys.argv) > 3:
    query = pathlib.Path(sys.argv[3]).read_text()
    data = urllib.parse.urlencode({'data': query}).encode()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
request = urllib.request.Request(url, data=data, headers=headers)
meta = {'url': url, 'method': request.get_method(), 'request_headers': headers,
        'fetched_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
    response = urllib.request.urlopen(request, timeout=150)
except urllib.error.HTTPError as error:
    response = error
except Exception as error:
    meta['error'] = str(error)
    path.with_suffix(path.suffix + '.fetch.json').write_text(json.dumps(meta, indent=2) + '\n')
    raise
with response:
    body = response.read()
    meta.update(status=response.status, final_url=response.url,
                response_headers=dict(response.headers), sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
path.write_bytes(body)
path.with_suffix(path.suffix + '.fetch.json').write_text(json.dumps(meta, indent=2) + '\n')
print(json.dumps({'file': str(path), 'status': meta['status'], 'bytes': len(body), 'sha256': meta['sha256']}))
if meta['status'] != 200:
    raise SystemExit(1)
