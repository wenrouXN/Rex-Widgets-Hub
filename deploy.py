#!/usr/bin/env python3
"""从 projects/rex-widgets-hub/index.js 部署 Worker（真源在 projects，不在 /tmp）。"""
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

SRC = Path("/vol1/1000/config/share/projects/rex-widgets-hub/index.js")
ACCT_FILE = Path("/vol1/1000/config/share/cftemail/config.toml")
KV_NAME = "rex_kv"
WORKER = "rex-widgets-hub"

if not SRC.exists():
    sys.exit(f"源码不存在: {SRC}")

# 从 cftemail config 读 token
token = acct = None
for line in ACCT_FILE.read_text().splitlines():
    s = line.strip()
    if s.startswith("api_token") and "=" in s:
        token = s.split("=", 1)[1].strip().strip('"\'')
    elif s.startswith("account_id") and "=" in s:
        acct = s.split("=", 1)[1].strip().strip('"\'')
if not token or not acct:
    sys.exit("未读到 api_token / account_id")


def api(method, path, body=None, ctype="application/json"):
    r = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acct}{path}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": ctype},
        method=method,
    )
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


ns = [n for n in api("GET", "/storage/kv/namespaces").get("result", [])
      if n["title"].lower() == KV_NAME]
if not ns:
    sys.exit(f"找不到 KV namespace {KV_NAME}")
kv = ns[0]["id"]
print(f"✅ KV = {kv}")

code = SRC.read_text(encoding="utf-8")
print(f"Worker 源码 {len(code)} 字符  sha256={__import__('hashlib').sha256(code.encode()).hexdigest()[:12]}")

b = uuid.uuid4().hex
parts = [
    f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\n'
    f'Content-Type: application/json\r\n\r\n'
    f'{json.dumps({"main_module": "index.js", "bindings": [{"type": "kv_namespace", "name": "REX_KV", "namespace_id": kv}]})}\r\n',
    f'--{b}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\n'
    f'Content-Type: application/javascript+module\r\n\r\n{code}\r\n',
    f'--{b}--\r\n',
]
body = "".join(parts).encode()
r = api("PUT", f"/workers/scripts/{WORKER}", body,
        f"multipart/form-data; boundary={b}")
print(f"{'✅' if r.get('success') else '❌'} 部署 success={r.get('success')}")

# 确保自定义域绑定还在
dom = api("GET", f"/workers/domains")
hosts = [d["hostname"] for d in dom.get("result", [])]
print(f"自定义域: {hosts}")
