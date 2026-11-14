"""Semantic highlighting: generics, macros, this.member vs parameters, operator keyword."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

macro twice(expression e) {
    return e + e;
}

struct Box<TKey, T> {
    map<T, i8> items;
    i32 count;

    void add(i32 amount) {
        this.count = this.count + amount;
        i32 doubled = twice!(amount);
    }

    operator get[](slice<T> view, size index) -> T {
        return view[index];
    }
}

macro shout! {
    (loud, local expression target, expression condition) => { condition && target.go() }
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


client = Client(exe)
init = client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
legend = init["capabilities"]["semanticTokensProvider"]["legend"]
types, modifiers = legend["tokenTypes"], legend["tokenModifiers"]
uri = uri_of(os.path.join(root, "src", "highlight_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
data = client.request("textDocument/semanticTokens/full", {"textDocument": {"uri": uri}})["data"]
lines = SOURCE.split("\n")
found = {}
line = character = 0
for i in range(0, len(data), 5):
    dl, ds, length, kind, mods = data[i:i + 5]
    line += dl
    character = ds if dl else character + ds
    text = lines[line][character:character + length]
    found.setdefault((line, text), []).append((types[kind], [m for b, m in enumerate(modifiers) if mods & (1 << b)]))


def at(line_no, text):
    return found.get((line_no, text), [None])[-1]


check("generic argument T in map<T, i8> is a type parameter", at(7, "T") and at(7, "T")[0] == "typeParameter", found)
check("TKey is a type parameter", at(6, "TKey") and at(6, "TKey")[0] == "typeParameter", found)
check("macro call twice!() is a macro", at(12, "twice") and at(12, "twice")[0] == "macro", found)
check("this.count is a class member property", at(11, "count") and at(11, "count")[0] == "property" and "classMember" in at(11, "count")[1], found)
check("parameter amount is a parameter", at(11, "amount") and at(11, "amount")[0] == "parameter", found)
check("operator is a keyword", at(15, "operator") and at(15, "operator")[0] == "keyword", found)
check("macro name is a macro", at(20, "shout") and at(20, "shout")[0] == "macro", found)
check("macro arm word is an enum member", at(21, "loud") and at(21, "loud")[0] == "enumMember", found)
check("macro fragment kind is a keyword", at(21, "expression") and at(21, "expression")[0] == "keyword", found)
check("macro parameter is a parameter", at(21, "target") and at(21, "target")[0] == "parameter", found)
check("macro parameter used in the body is a parameter", found.get((21, "condition"), [None])[-1] and found[(21, "condition")][-1][0] == "parameter", found)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
