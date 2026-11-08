import os
import sys
import time

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = os.path.join(here, "..", "build", "djinn-lsp.exe")
repo = os.path.abspath(os.path.join(here, "..", ".."))

started = time.time()
client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(repo), "capabilities": {}})
client.notify("initialized", {})
log = client.wait_for("window/logMessage", lambda p: "ready" in p["message"], timeout=60)
print("ready after %.2fs: %s" % (time.time() - started, log["message"]))

target = os.path.join(repo, "djinnc", "src", "main.djinn")
text = open(target, encoding="utf-8").read()
uri = uri_of(target)
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": text}})


def pos(needle, occurrence=0, delta=0):
    index = -1
    for _ in range(occurrence + 1):
        index = text.index(needle, index + 1)
    line = text.count("\n", 0, index)
    return {"line": line, "character": index - (text.rfind("\n", 0, index) + 1) + delta}


def timed(label, method, params):
    t = time.time()
    result = client.request(method, params)
    print("%-28s %6.0f ms  %s" % (label, (time.time() - t) * 1000, str(result)[:150].replace("\n", " ")))
    return result


doc = {"uri": uri}
timed("hover Options.parse", "textDocument/hover", {"textDocument": doc, "position": pos("Options.parse", 0, 9)})
timed("definition Options.parse", "textDocument/definition", {"textDocument": doc, "position": pos("Options.parse", 0, 9)})
timed("definition CodeGenerator", "textDocument/definition", {"textDocument": doc, "position": pos("CodeGenerator.create", 0, 3)})
timed("definition gen.generate", "textDocument/definition", {"textDocument": doc, "position": pos("gen.generate", 0, 6)})
timed("hover run_compiler", "textDocument/hover", {"textDocument": doc, "position": pos("run_compiler", 0, 3)})
timed("references run_compiler", "textDocument/references", {"textDocument": doc, "position": pos("run_compiler", 0, 3), "context": {"includeDeclaration": True}})
timed("completion gen.", "textDocument/completion", {"textDocument": doc, "position": pos("gen.library_mode", 0, 4)})
result = timed("semantic tokens", "textDocument/semanticTokens/full", {"textDocument": doc})
print("   semantic token count:", len(result["data"]) // 5)
timed("document symbols", "textDocument/documentSymbol", {"textDocument": doc})
timed("workspace symbol 'Lexer'", "workspace/symbol", {"query": "Lexer"})

diag = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == uri.lower(), timeout=60)
print("diagnostics for main.djinn:", len(diag["diagnostics"]), [d["message"] for d in diag["diagnostics"]][:3])
client.close()
