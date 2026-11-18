"""Formatting: the bodies of css! and html! are re-indented, idempotently, and left alone when they cannot be read."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")

SOURCE = """namespace demo;

struct Look {
    static str sheet() {
        return css!{ .a{color:red;&:hover{color:blue}} .b { margin: 0 8px; background: url("x;y.png") }
            @media (width > 600px) { .a { padding: 16px; } } };
    }

    public unsafe Node render() {
        return html!{ <div class="card"   id="c"><h1>{title}</h1>
        <p>Hello   {name}, welcome</p><br><ul>{if (ready) { <li>a</li> }}<li>b</li></ul>
          <Button label="x" on_click={() => go(1)}/></div> };
    }

    static str bad() {
        return css!{ .a { color: red; // note
        } };
    }
}
"""

EXPECTED_SHEET = """        return css!{
            .a {
                color:red;
                &:hover {
                    color:blue
                }
            }
            .b {
                margin: 0 8px;
                background: url("x;y.png")
            }
            @media (width > 600px) {
                .a {
                    padding: 16px;
                }
            }
        };"""

EXPECTED_HTML = """        return html!{
            <div class="card" id="c">
                <h1>{title}</h1>
                <p>Hello {name}, welcome</p>
                <br>
                <ul>
                    {if (ready) { <li>a</li> }}
                    <li>b</li>
                </ul>
                <Button label="x" on_click={() => go(1)}/>
            </div>
        };"""


def apply(text, edits):
    unit_lines = text.split("\n")
    starts = [0]
    for line in unit_lines:
        starts.append(starts[-1] + len(line) + 1)

    def offset(pos):
        return starts[pos["line"]] + pos["character"]

    for edit in sorted(edits, key=lambda e: offset(e["range"]["start"]), reverse=True):
        a, b = offset(edit["range"]["start"]), offset(edit["range"]["end"])
        text = text[:a] + edit["newText"] + text[b:]
    return text


client = Client(exe)
client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}})
client.notify("initialized", {})
uri = uri_of(os.path.join(root, "format.djinn"))
client.notify("textDocument/didOpen", {"textDocument": {"uri": uri, "languageId": "djinn", "version": 1, "text": SOURCE}})

failures = 0


def check(name, ok, detail=""):
    global failures
    if not ok:
        failures += 1
    print(("ok   " if ok else "FAIL ") + name + (("\n" + detail) if detail and not ok else ""))


edits = client.request("textDocument/formatting", {"textDocument": {"uri": uri}, "options": {"tabSize": 4, "insertSpaces": True}})
formatted = apply(SOURCE, edits)
check("two bodies are edited, the one with a comment is not", len(edits) == 2, str(len(edits)))
check("css body is one item per line", EXPECTED_SHEET in formatted, formatted)
check("html body is one element per line", EXPECTED_HTML in formatted, formatted)
check("a body with a comment is kept", "color: red; // note\n        } };" in formatted, formatted)

client.notify("textDocument/didChange", {"textDocument": {"uri": uri, "version": 2}, "contentChanges": [{"text": formatted}]})
again = client.request("textDocument/formatting", {"textDocument": {"uri": uri}, "options": {"tabSize": 4, "insertSpaces": True}})
check("formatting twice changes nothing", len(again) == 0, str(again))

client.close()
sys.exit(1 if failures else 0)
