"""A `return x == A || x == B || ...` over constants is a hint with a fix that turns it into a switch."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

struct Tags {
    static bool is_inline(str tag) {
        return tag == "a" || tag == "b" || tag == "i" || tag == "q" || tag == "u";
    }

    static unsafe bool is_url(str name) {
        return Tags.same_ignore_case(name, "href") || Tags.same_ignore_case(name, "src") || Tags.same_ignore_case(name, "action")
            || Tags.same_ignore_case(name, "cite") || Tags.same_ignore_case(name, "data");
    }

    static bool short_chain(str tag) {
        return tag == "a" || tag == "b";
    }

    static bool other_values(str tag, str other) {
        return tag == "a" || tag == "b" || other == "i" || tag == "q" || tag == "u";
    }
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
uri = uri_of(os.path.join(root, "src", "comparison_chain_probe.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})
diagnostics = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == uri.lower() and len(p["diagnostics"]) > 0)["diagnostics"]
chains = [d for d in diagnostics if d.get("code") == "comparison-chain"]
lines = sorted(d["range"]["start"]["line"] for d in chains)
check("the two chains are reported on their return", lines == [4, 8], lines)
check("a short chain and a chain over other values are not", all(l < 12 for l in lines), lines)


def apply(text, action):
    edit = action["edit"]["changes"][uri][0]["range"]
    new = action["edit"]["changes"][uri][0]["newText"]
    rows = text.split(chr(10))

    def off(pos):
        return sum(len(r) + 1 for r in rows[:pos["line"]]) + pos["character"]
    return text[:off(edit["start"])] + new + text[off(edit["end"]):]


def fixed_text(d):
    actions = client.request("textDocument/codeAction", {"textDocument": {"uri": uri}, "range": d["range"], "context": {"diagnostics": [d]}})
    return apply(SOURCE, actions[0]) if actions else ""


equality = fixed_text(next(d for d in chains if d["range"]["start"]["line"] == 4))
check("the equality chain becomes a switch with one case per constant", 'switch (tag) {' in equality and 'case "q": return true;' in equality and 'default: return false;' in equality, equality)
check("the chain is gone from the equality fix", 'return tag == "a" || tag == "b" || tag == "i"' not in equality, equality)
ignore_case = fixed_text(next(d for d in chains if d["range"]["start"]["line"] == 8))
check("the ignore case chain switches on the lower cased value", 'string name_lower = name.toLower();' in ignore_case and 'switch (name_lower) {' in ignore_case and 'case "href": return true;' in ignore_case, ignore_case)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
