"""'struct mut Name' is a struct declaration named Name."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

struct mut Counter {
    i32 count;
    i32 limit;
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


def flatten(symbols):
    for symbol in symbols:
        yield symbol
        yield from flatten(symbol.get("children", []))


client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
uri = uri_of(os.path.join(root, "src", "struct_mut_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
names = {s["name"] for s in flatten(client.request("textDocument/documentSymbol", {"textDocument": {"uri": uri}}))}
check("struct mut declares the struct by its name", "Counter" in names, names)
check("struct mut does not declare a symbol named mut", "mut" not in names, names)
check("fields of a struct mut are members", {"count", "limit"} <= names, names)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
