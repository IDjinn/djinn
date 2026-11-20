"""Lexical diagnostics: the rules under src/diagnostics/rules run over the syntax tree."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

void a() {
    if (true {
    }
}

void b() {
    }
}

void c() {
    auto s = "open;
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
client.notify("initialized", {})
uri = uri_of(os.path.join(root, "src", "lint_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
diagnostics = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == uri.lower() and len(p["diagnostics"]) > 0)["diagnostics"]
by_code = {}
for d in diagnostics:
    by_code.setdefault(d.get("code"), []).append(d)
check("unclosed bracket is reported on its line", any(d["range"]["start"]["line"] == 3 for d in by_code.get("unclosed-bracket", [])), diagnostics)
check("unmatched bracket is reported on its line", any(d["range"]["start"]["line"] == 9 for d in by_code.get("unmatched-bracket", [])), diagnostics)
check("unterminated string is reported on its line", any(d["range"]["start"]["line"] == 12 for d in by_code.get("unterminated-literal", [])), diagnostics)
check("lexical findings are errors from djinn-lsp", all(d["severity"] == 1 and d["source"] == "djinn-lsp" for d in diagnostics), diagnostics)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
