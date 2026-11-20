"""The command line for agents: a short list of problems, and the details of one on demand."""
import os
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
source = os.path.join(here, "fixture", "src", "agent_probe.djinn")
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


def run(*args):
    return subprocess.run([exe, *args], capture_output=True, text=True, timeout=120).stdout


with open(source, "w", newline="") as handle:
    handle.write('namespace demo;\n\nvoid c() {\n    auto s = "open;\n}\n')
try:
    short = run("diagnostics", source)
    wanted = [l for l in short.splitlines() if " E1000 " in l]
    number = wanted[0].split()[0].lstrip("#") if wanted else "1"
    detail = run("explain", source, number)
    check("the list says how many problems there are", "problems" in short.splitlines()[0], short)
    check("a problem is one line with its position and code", "4:14 error E1000 Unterminated string literal [fix]" in short, short)
    check("the list stays short: no source, no help", "^" not in short and "help:" not in short, short)
    check("the list says how to ask for more", "djinn-lsp explain" in short, short)
    check("explain shows the line with the carets", 'auto s = "open;' in detail and "^~~~" in detail, detail)
    check("explain has the help and the suggestion", "help:" in detail and "suggestion:" in detail, detail)
    check("explain gives the edit to apply", 'fix: insert `"` at 4:19' in detail, detail)
    check("explain knows the documentation page", "docs.link/errors/E1000" in detail, detail)
    check("an unknown number is refused", "no #9" in run("explain", source, "9"))
finally:
    os.remove(source)
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
