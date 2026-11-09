import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
compiler = os.environ.get("DJINNC")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


client = Client(exe)
options = {"runtimeDir": os.path.abspath(runtime)}
if compiler:
    options["compilerPath"] = compiler
result = client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": options})
check("initialize advertises hover", result["capabilities"]["hoverProvider"] is True)
check("semantic token legend", len(result["capabilities"]["semanticTokensProvider"]["legend"]["tokenTypes"]) > 5)
client.notify("initialized", {})

main_path = os.path.join(root, "src", "main.djinn")
main_uri = uri_of(main_path)
main_text = open(main_path, encoding="utf-8").read()
client.notify("textDocument/didOpen", {"textDocument": {"uri": main_uri, "languageId": "djinn", "version": 1, "text": main_text}})


def position_of(text, needle, occurrence=0, delta=0):
    index = -1
    for _ in range(occurrence + 1):
        index = text.index(needle, index + 1)
    line = text.count("\n", 0, index)
    column = index - (text.rfind("\n", 0, index) + 1)
    return {"line": line, "character": column + delta}


def doc(uri):
    return {"uri": uri}


symbols = client.request("textDocument/documentSymbol", {"textDocument": doc(main_uri)})
check("document symbols list main", any(s["name"] == "main" for s in symbols), symbols)

hover = client.request("textDocument/hover", {"textDocument": doc(main_uri), "position": position_of(main_text, "add(", 0, 1)})
check("hover shows the signature of add", hover is not None and "i32 add(i32 left, i32 right)" in hover["contents"]["value"], hover)

hover = client.request("textDocument/hover", {"textDocument": doc(main_uri), "position": position_of(main_text, "sum()", 0, 1)})
check("hover shows the doc comment of a method", hover is not None and "Sum of both coordinates" in hover["contents"]["value"], hover)

definition = client.request("textDocument/definition", {"textDocument": doc(main_uri), "position": position_of(main_text, "Point.make", 0, 1)})
check("definition of Point goes to shapes.djinn", definition and definition[0]["uri"].lower().endswith("shapes.djinn"), definition)

definition = client.request("textDocument/definition", {"textDocument": doc(main_uri), "position": position_of(main_text, "sum()", 0, 1)})
check("definition of a method through a local", definition and definition[0]["uri"].lower().endswith("shapes.djinn"), definition)

definition = client.request("textDocument/definition", {"textDocument": doc(main_uri), "position": position_of(main_text, "total", 1, 1)})
check("definition of a local variable", definition and definition[0]["uri"].lower().endswith("main.djinn") and definition[0]["range"]["start"]["line"] == 4, definition)

references = client.request("textDocument/references", {"textDocument": doc(main_uri), "position": position_of(main_text, "add(", 0, 1), "context": {"includeDeclaration": True}})
check("references of add include declaration and use", references and len(references) == 2, references)

completion = client.request("textDocument/completion", {"textDocument": doc(main_uri), "position": position_of(main_text, "p.sum", 0, 2)})
labels = [item["label"] for item in completion["items"]]
check("member completion lists the fields and methods of Point", "x" in labels and "sum" in labels and "make" in labels, labels[:20])

signature = client.request("textDocument/signatureHelp", {"textDocument": doc(main_uri), "position": position_of(main_text, "add(p", 0, 5)})
check("signature help for add", signature and "add" in signature["signatures"][0]["label"], signature)

tokens = client.request("textDocument/semanticTokens/full", {"textDocument": doc(main_uri)})
check("semantic tokens are produced", tokens and len(tokens["data"]) > 20 and len(tokens["data"]) % 5 == 0, tokens)

folding = client.request("textDocument/foldingRange", {"textDocument": doc(main_uri)})
check("folding ranges", folding and len(folding) >= 1, folding)

workspace = client.request("workspace/symbol", {"query": "Point"})
check("workspace symbols find Point", any(s["name"] == "Point" for s in workspace), workspace)

rename = client.request("textDocument/rename", {"textDocument": doc(main_uri), "position": position_of(main_text, "total", 0, 1), "newName": "sum_total"})
edits = rename["changes"][main_uri]
check("rename edits every use of a local", len(edits) == 2, edits)

diagnostics = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == main_uri.lower() and any(d.get("source") == "djinnc" for d in p["diagnostics"]))
messages = [d["message"] for d in diagnostics["diagnostics"]]
check("compiler diagnostics report the undefined variable", any("undefined variable" in m for m in messages), messages)
check("diagnostic points at line 6", any(d["range"]["start"]["line"] == 5 for d in diagnostics["diagnostics"]), diagnostics)

fixed = main_text.replace("missing", "total")
client.notify("textDocument/didChange", {"textDocument": {"uri": main_uri, "version": 2}, "contentChanges": [{"text": fixed}]})
cleared = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == main_uri.lower() and len(p["diagnostics"]) == 0)
check("fixing the buffer clears the diagnostics without saving", cleared is not None)

client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
