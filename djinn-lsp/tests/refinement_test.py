"""'struct Name : u32 where predicate;' is one declaration, ending at its ';'."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

struct Positive : u32 where value > 0;

struct Holder {
    mut Positive count;
}

i32 main() {
    Positive one = (Positive!)1u;
    return (i32)one;
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
uri = uri_of(os.path.join(root, "src", "refinement_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
symbols = client.request("textDocument/documentSymbol", {"textDocument": {"uri": uri}})
names = [s["name"] for s in symbols]
check("the refinement and what follows are separate symbols", {"Positive", "Holder", "main"} <= set(names), names)
positive = [s for s in symbols if s["name"] == "Positive"]
children = [c["name"] for s in positive for c in s.get("children", [])]
check("the refinement has no members", not children, children)
check("the refinement ends on its own line", positive and positive[0]["range"]["end"]["line"] == 2, positive)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
