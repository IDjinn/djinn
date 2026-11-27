"""A project with a web entry is also checked with --target web: what only the web build rejects shows in the editor,
underlined over the whole expression, and an error both builds report shows once."""
import os
import sys
import tempfile

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
runtime = os.path.join(here, "..", "..", "runtime")

FILES = {
    "djinn.proj": 'project: "webcheck"\ncompiler:\n  library-mode: false\n',
    "src/shared.djinn": "namespace webcheck;\n\nvoid take(i32 amount) {\n}\n\nvoid both() {\n    f64 shared = 2.5;\n    take(shared);\n}\n",
    "src/main.djinn": "namespace webcheck;\n\ni32 main() {\n    both();\n    return 0;\n}\n",
    "src/main.web.djinn": "namespace webcheck;\n\ni32 main() {\n    f64 value = 1.5;\n    take(value + 1.0);\n    return 0;\n}\n",
}

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


with tempfile.TemporaryDirectory() as root:
    os.makedirs(os.path.join(root, "src"))
    for name, text in FILES.items():
        with open(os.path.join(root, name), "w", newline="\n") as file:
            file.write(text)

    client = Client(exe)
    options = {"runtimeDir": os.path.abspath(runtime)}
    if os.environ.get("DJINNC"):
        options["compilerPath"] = os.environ["DJINNC"]
    client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": options})
    client.notify("initialized", {})
    web = uri_of(os.path.join(root, "src", "main.web.djinn"))
    shared = uri_of(os.path.join(root, "src", "shared.djinn"))
    for uri, name in ((web, "src/main.web.djinn"), (shared, "src/shared.djinn")):
        client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": FILES[name]}})

    def compiled(uri):
        def reported(params):
            return params["uri"].lower() == uri.lower() and any("E3054" in str(item.get("code")) for item in params["diagnostics"])

        try:
            params = client.wait_for("textDocument/publishDiagnostics", reported, timeout=60)
        except TimeoutError:
            return []
        return [item for item in params["diagnostics"] if "E3054" in str(item.get("code"))]

    found = compiled(web)
    check("the web only error is reported", len(found) == 1, found)
    if found:
        item = found[0]
        check("the message names the parameter", "parameter 'amount' of 'webcheck::take'" in item["message"].lower(), item["message"])
        check("the message says it comes from the web build", "(web build)" in item["message"], item["message"])
        check("the whole expression is underlined",
              item["range"] == {"start": {"line": 4, "character": 9}, "end": {"line": 4, "character": 20}}, item["range"])

    found = compiled(shared)
    check("an error of both builds is reported once", len(found) == 1, found)
    if found:
        check("it is not marked as a web error", "(web build)" not in found[0]["message"], found[0]["message"])

    client.close()

if failures:
    print("FAILED: " + ", ".join(failures))
    sys.exit(1)
print("web_check_test: all passed")
