import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = os.path.join(here, "..", "build", "djinn-lsp.exe")
compiler = os.environ.get("DJINNC")
example = os.path.abspath(os.path.join(here, "..", "example"))
runtime = os.path.abspath(os.path.join(here, "..", "..", "runtime"))
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


def open_file(client, path):
    text = open(path, encoding="utf-8").read()
    uri = uri_of(path)
    client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": text}})
    return uri, text


def position(text, needle, delta=0):
    index = text.index(needle)
    line = text.count("\n", 0, index)
    return {"line": line, "character": index - (text.rfind("\n", 0, index) + 1) + delta}


def diagnostics_for(client, uri):
    client.wait_for("window/logMessage", lambda p: "checked" in p["message"], timeout=90)
    latest = None
    for message in client.notifications:
        if message.get("method") == "textDocument/publishDiagnostics" and message["params"]["uri"].lower() == uri.lower():
            latest = message["params"]["diagnostics"]
    client.notifications[:] = [m for m in client.notifications if m.get("method") != "textDocument/publishDiagnostics"]
    return latest


options = {"runtimeDir": runtime}
if compiler:
    options["compilerPath"] = compiler

client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(example), "capabilities": {}, "initializationOptions": options})
client.notify("initialized", {})

main_uri, main_text = open_file(client, os.path.join(example, "src", "main.djinn"))
doc = {"uri": main_uri}

hover = client.request("textDocument/hover", {"textDocument": doc, "position": position(main_text, "add(p.sum", 1)})
check("hover shows the doc comment of add", hover is not None and "Adds two numbers" in str(hover), hover)

definition = client.request("textDocument/definition", {"textDocument": doc, "position": position(main_text, "Point.make", 1)})
check("definition of Point crosses files and namespaces", definition and str(definition).replace("\\", "/").endswith("shapes.djinn") or "shapes.djinn" in str(definition), definition)

definition = client.request("textDocument/definition", {"textDocument": doc, "position": position(main_text, "r.area", 3)})
check("definition of a member through the inferred receiver type", definition and "shapes.djinn" in str(definition), definition)

references = client.request("textDocument/references", {"textDocument": doc, "position": position(main_text, "clamp(", 1), "context": {"includeDeclaration": True}})
check("references of clamp span two files", references and len(references) >= 2, references)

completion = client.request("textDocument/completion", {"textDocument": doc, "position": position(main_text, "box.get", 4)})
items = completion["items"] if isinstance(completion, dict) else completion
check("member completion on Box<i32> lists get", items and any(i["label"] == "get" for i in items), items)

symbols = client.request("textDocument/documentSymbol", {"textDocument": doc})
check("document symbols include main", symbols and "main" in str(symbols), symbols)

workspace = client.request("workspace/symbol", {"query": "Rect"})
check("workspace symbols find Rect", workspace and "Rect" in str(workspace), workspace)

tokens = client.request("textDocument/semanticTokens/full", {"textDocument": doc})
check("semantic tokens are produced", tokens and len(tokens["data"]) > 10, tokens)

diagnostics = diagnostics_for(client, main_uri)
check("clean example has no compiler diagnostics", diagnostics == [], diagnostics)

errors_root = os.path.join(example, "errors")
errors_uri, errors_text = open_file(client, os.path.join(errors_root, "src", "main.djinn"))
diagnostics = diagnostics_for(client, errors_uri)
codes = sorted(d["code"] for d in diagnostics)
check("errors project reports the six expected codes", codes == ["E3002", "E3002", "E3027", "E3027", "E3042", "E3053"], codes)
nope = [d for d in diagnostics if "Color::nope" in d["message"]]
line = errors_text.splitlines()[nope[0]["range"]["start"]["line"]] if nope else ""
range_ = nope[0]["range"] if nope else None
check("a qualified call is underlined on the member name only", range_ and line[range_["start"]["character"]:range_["end"]["character"]] == "nope", (line, range_))
check("every diagnostic has a non-empty range", all(d["range"]["end"] != d["range"]["start"] for d in diagnostics), diagnostics)

hinted = [d for d in diagnostics if "cuont" in d["message"] or d["code"] == "E3002" and "Did you mean" in d["message"]]
check("a close typo gets a did-you-mean hint", len(hinted) == 1 and "'count'" in hinted[0]["message"], diagnostics)
check("a name with no close match gets no hint", all("Did you mean" not in d["message"] for d in diagnostics if "missing" in d["message"] or "nothing" in d["message"]), diagnostics)

actions = client.request("textDocument/codeAction", {"textDocument": {"uri": errors_uri}, "range": hinted[0]["range"], "context": {"diagnostics": [hinted[0]]}})
check("quick fix replaces cuont with count", actions and len(actions) == 1 and actions[0]["edit"]["changes"][errors_uri][0]["newText"] == "count", actions)
other = [d for d in diagnostics if "missing" in d["message"]][0]
check("no quick fix without a confident match", client.request("textDocument/codeAction", {"textDocument": {"uri": errors_uri}, "range": other["range"], "context": {"diagnostics": [other]}}) == [])

typos_uri, typos_text = open_file(client, os.path.join(example, "typos", "src", "main.djinn"))
typo_diagnostics = diagnostics_for(client, typos_uri)
check("an unknown field type suggests the declared type", typo_diagnostics and "'Color'" in typo_diagnostics[0]["message"], typo_diagnostics)

client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
