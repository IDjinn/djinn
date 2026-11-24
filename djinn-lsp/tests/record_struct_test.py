"""'struct Name(T a, U b);' declares the struct and one field per parameter."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

struct Point(i32 x, i32 y);

struct Named(str name) {
    i32 twice() { return 1; }
}

i32 main() {
    Point p = Point(3, 4);
    return p.x;
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
uri = uri_of(os.path.join(root, "src", "record_struct_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
symbols = list(flatten(client.request("textDocument/documentSymbol", {"textDocument": {"uri": uri}})))
names = {s["name"] for s in symbols}
check("the record struct is declared", {"Point", "Named"} <= names, names)
check("parameters become fields", {"x", "y", "name"} <= names, names)
point = [s for s in symbols if s["name"] == "Point"]
children = {c["name"] for s in point for c in s.get("children", [])}
check("the fields belong to the struct", {"x", "y"} <= children, children)
check("a method next to the record parameters is kept", "twice" in names, names)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
