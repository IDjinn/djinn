"""'sync' is a modifier before a declaration and an ordinary name after the return type."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

sync i32 blocked() {
    return 1;
}

task<i32> forwarded() {
    return start();
}

struct File {
    i32 handle;

    public sync i32 flush() {
        return this.handle;
    }

    public i32 sync() {
        return this.handle;
    }
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
uri = uri_of(os.path.join(root, "src", "sync_modifier_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
names = {s["name"] for s in flatten(client.request("textDocument/documentSymbol", {"textDocument": {"uri": uri}}))}
check("a sync function is declared by its name", "blocked" in names, names)
check("a task function is declared by its name", "forwarded" in names, names)
check("a sync method is declared by its name", "flush" in names, names)
check("a method may be named sync", "sync" in names, names)
check("the return type of a sync function is not a symbol", "i32" not in names, names)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
