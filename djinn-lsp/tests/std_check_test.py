"""Opening a file of the standard library (a project without a src folder) must not report parse errors
caused by types declared in sibling files (struct size : u32 lives in std/types)."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
compiler = os.environ.get("DJINNC")
repo = os.path.abspath(os.path.join(here, "..", ".."))
target = os.path.join(repo, "std", "collections", "bitfield.djinn")

client = Client(exe)
options = {"runtimeDir": os.path.join(repo, "runtime"), "stdDir": os.path.join(repo, "std")}
if compiler:
    options["compilerPath"] = compiler
client.request("initialize", {"processId": None, "rootUri": uri_of(os.path.join(repo, "std")), "capabilities": {}, "initializationOptions": options})
text = open(target, encoding="utf-8").read()
uri = uri_of(target)
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": text}})
params = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == uri.lower(), timeout=60)
messages = [d["message"] for d in params["diagnostics"] if d.get("source") == "djinnc"]
bad = [m for m in messages if "expected a struct member" in m]
print(("PASS" if not bad else "FAIL") + " std file has no 'expected a struct member' error", messages[:3])
client.close()
sys.exit(1 if bad else 0)
