"""Contracts, invariants and atomic regions: the contextual words have hover docs and completions, and the outline
keeps the methods of a struct that declares an invariant."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

struct Failed;

struct Account {
    mut i64 balance;
    invariant(this.balance >= 0);

    Account(i64 start) {
        this.balance = start;
    }

    public void withdraw(i64 amount) require(amount > 0) ensure(this.balance == old(this.balance) - amount) {
        this.balance = this.balance - amount;
    }
}

uow Spend {
    Account* from;
    i64 amount;
    writes(*from)
    access(exclusive from)
}

unsafe void spend(Account* from, i64 amount) writes(*from) uow(Spend) strategy cooperative {
    from.balance = from.balance - amount;
}

unsafe void inside(Account* from) requires uow {
}

unsafe i32 move(Account* from, i64 amount) throws(Failed) {
    atomic(*from) {
        from.withdraw(amount);
    } after_commit {
        amount = 0;
    }
    cooperative {
        amount = 1;
    }
    return 0;
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


def position_of(text, needle, delta=0):
    index = text.index(needle)
    line = text.count("\n", 0, index)
    column = index - (text.rfind("\n", 0, index) + 1)
    return {"line": line, "character": column + delta}


client = Client(exe)
options = {"runtimeDir": os.path.abspath(runtime)}
if os.environ.get("DJINNC"):
    options["compilerPath"] = os.environ["DJINNC"]
init = client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": options})
types = init["capabilities"]["semanticTokensProvider"]["legend"]["tokenTypes"]
client.notify("initialized", {})
path = os.path.join(root, "src", "guarantees_demo.djinn")
uri = uri_of(path)
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})

for word in ["invariant", "atomic", "cooperative", "after_commit", "old"]:
    hover = client.request("textDocument/hover", {"textDocument": {"uri": uri}, "position": position_of(SOURCE, word + ("(" if word in ("invariant", "atomic", "old") else " "), 1)})
    check("hover documents " + word, hover is not None and word in hover["contents"]["value"], hover)

for word in ["uow", "writes", "strategy"]:
    hover = client.request("textDocument/hover", {"textDocument": {"uri": uri}, "position": position_of(SOURCE, word + ("(" if word != "strategy" else " "), 1)})
    check("hover documents " + word, hover is not None and word in hover["contents"]["value"], hover)

completion = client.request("textDocument/completion", {"textDocument": {"uri": uri}, "position": position_of(SOURCE, "cooperative {", 0)})
labels = [item["label"] for item in completion["items"]] if completion else []
check("completion offers atomic and invariant", "atomic" in labels and "invariant" in labels, labels[:40])

symbols = client.request("textDocument/documentSymbol", {"textDocument": {"uri": uri}})
names = []


def walk(items):
    for item in items:
        names.append(item["name"])
        walk(item.get("children", []))


walk(symbols or [])
check("outline keeps the methods next to an invariant", "withdraw" in names and "move" in names, names)
check("the invariant is not a member", "invariant" not in names, names)

data = client.request("textDocument/semanticTokens/full", {"textDocument": {"uri": uri}})["data"]
lines = SOURCE.split(chr(10))
found = {}
line = character = 0
for i in range(0, len(data), 5):
    dl, ds, length, kind, mods = data[i:i + 5]
    line += dl
    character = ds if dl else character + ds
    found.setdefault(lines[line][character:character + length], []).append(types[kind])
for word in ["uow", "writes", "access", "strategy", "requires"]:
    check("semantic tokens color " + word + " as a keyword", "keyword" in found.get(word, []), found.get(word))
for word in ["invariant", "atomic", "cooperative", "after_commit", "old"]:
    check("semantic tokens color " + word + " as a keyword", "keyword" in found.get(word, []), found.get(word))

client.request("shutdown", None)
client.notify("exit", None)
if failures:
    print("FAILED: " + ", ".join(failures))
    sys.exit(1)
print("guarantees_test: all passed")
