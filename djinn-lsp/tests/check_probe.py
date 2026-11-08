import os
import sys
import time

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = os.path.join(here, "..", "build", "djinn-lsp.exe")
repo = os.path.abspath(os.path.join(here, "..", ".."))
target = os.path.abspath(os.path.join(repo, sys.argv[1]))

client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(repo), "capabilities": {}})
client.notify("initialized", {})
text = open(target, encoding="utf-8").read()
uri = uri_of(target)
started = time.time()
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": text}})
done = client.wait_for("window/logMessage", lambda p: "checked" in p["message"], timeout=90)
print("%.2fs %s" % (time.time() - started, done["message"]))
for message in client.notifications:
    if message.get("method") == "window/logMessage":
        print("log:", message["params"]["message"][:300])
    if message.get("method") == "textDocument/publishDiagnostics":
        params = message["params"]
        print("publish %s -> %d diagnostics %s" % (params["uri"].split("/")[-1], len(params["diagnostics"]), [(d["source"], d["message"], d["range"]["start"]["line"] + 1) for d in params["diagnostics"]][:4]))
client.close()
