"""Interop bindings: extern "JS" / extern "C" structs and abstract declarations are symbols, highlighted and checked."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

extern "JS" {
    struct Element {
        [Js("$this.focus()")]
        public void focus();

        [Js("document.createElement($0)")]
        public static Element create(str tag);
    }
}

extern "C" {
    struct Stream {
        [Symbol("stream_close")]
        public void close();
    }
}

abstract struct Shape {
    abstract i32 area();
}

void use(Element e) {
    e.focus();
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


def flatten(symbols):
    for s in symbols:
        yield s
        for child in s.get("children", []):
            yield from flatten([child])


client = Client(exe)
init = client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
client.notify("initialized", {})
legend = init["capabilities"]["semanticTokensProvider"]["legend"]
types = legend["tokenTypes"]
uri = uri_of(os.path.join(root, "src", "extern_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
doc = {"uri": uri}

names = {s["name"]: s for s in flatten(client.request("textDocument/documentSymbol", {"textDocument": doc}))}
for name in ("Element", "Stream", "Shape", "focus", "create", "close", "area"):
    check("symbol " + name + " is listed", name in names, list(names))

data = client.request("textDocument/semanticTokens/full", {"textDocument": doc})["data"]
lines = SOURCE.split("\n")
found = {}
line = character = 0
for i in range(0, len(data), 5):
    dl, ds, length, kind, mods = data[i:i + 5]
    line += dl
    character = ds if dl else character + ds
    found.setdefault((line, lines[line][character:character + length]), []).append(types[kind])


def at(line_no, text):
    return found.get((line_no, text), [None])[-1]


check("abstract is not a name", at(19, "abstract") is None and at(20, "abstract") is None, found)
check("binding struct is a struct", at(3, "Element") == "struct", found)

definition = client.request("textDocument/definition", {"textDocument": doc, "position": {"line": 24, "character": 6}})
check("a call on a binding goes to its declaration", definition and definition[0]["range"]["start"]["line"] == 5, definition)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
