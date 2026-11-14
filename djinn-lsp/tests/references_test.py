"""Find references: a macro and a function with the same name stay apart; .gitignore files are not indexed."""
import os
import shutil
import sys
import tempfile

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
runtime = os.path.join(here, "..", "..", "runtime")

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


root = tempfile.mkdtemp(prefix="djinn-refs-")
os.makedirs(os.path.join(root, "src"))
os.makedirs(os.path.join(root, "skipped", "nested"))
open(os.path.join(root, "djinn.proj"), "w").write("project: \"refs\"\ncompiler:\n  entry: \"main.djinn\"\n")
open(os.path.join(root, ".gitignore"), "w").write("# comment\nskipped/\n")
main = """namespace demo;

extern "C" {
    f64 log(f64 x);
}

macro log!(expression e) {
    return e;
}

i32 main() {
    f64 a = log(2.0);
    i32 b = log!(1);
    return 0;
}
"""
open(os.path.join(root, "src", "main.djinn"), "w").write(main)
open(os.path.join(root, "skipped", "nested", "other.djinn"), "w").write("namespace demo;\nvoid hidden_function() {\n}\n")

client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
client.notify("initialized", {})
uri = uri_of(os.path.join(root, "src", "main.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": main}})
lines = main.split("\n")


def position(line_no, needle):
    return {"line": line_no, "character": lines[line_no].index(needle) + 1}


refs = client.request("textDocument/references", {"textDocument": {"uri": uri}, "position": position(6, "log"), "context": {"includeDeclaration": True}})
rows = sorted(r["range"]["start"]["line"] for r in refs if r["uri"].lower() == uri.lower())
check("the macro log! is found at its declaration and its use only", rows == [6, 12], rows)
refs = client.request("textDocument/references", {"textDocument": {"uri": uri}, "position": position(11, "log"), "context": {"includeDeclaration": True}})
rows = sorted(r["range"]["start"]["line"] for r in refs if r["uri"].lower() == uri.lower())
check("the function log is found at its declaration and its call only", rows == [3, 11], rows)
symbols = client.request("workspace/symbol", {"query": "hidden_function"})
check("files matched by .gitignore are not indexed", not symbols, symbols)
client.close()
shutil.rmtree(root, ignore_errors=True)
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
