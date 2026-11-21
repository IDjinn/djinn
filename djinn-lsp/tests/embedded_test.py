"""Embedded languages: a macro bound in djinn.editor gets highlighting and lint for its body."""
import os
import sys

from lsp_client import Client, uri_of

here = os.path.dirname(os.path.abspath(__file__))
exe = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "build", "djinn-lsp.exe")
root = os.path.join(here, "fixture")
runtime = os.path.join(here, "..", "..", "runtime")

SOURCE = """namespace demo;

void page(str title) {
    auto view = html! {
        <div class="card" data-id="a">
            <h1>{title}</h1>
            <Button label="x" items=["Open", title] on_click={go}/>
            <br>
            {if (ready) { <b>yes</b> }}
        </div>
    };
    auto rows = query!(select count(id) from users where id == 1);
}

void broken() {
    auto a = html! { <div class="a" class="b"><span></div> };
    auto b = html! { </p> };
    auto c = html! { <section> };
}

struct Card {
    str title;
}

void use_card() {
    auto d = html! { <Card title="x"/> };
}

str sheet() {
    return css! {
        .card:hover > p { color: #3b82f6; --gap: 4px; margin: -4px auto; }
        @media (min-width: 600px) { .card { padding: 8px 1.5rem; background: var(--gap) !important; } }
        .bad { colr: red; }
        .none { color red; }
        .empty { margin: ; }
        { color: blue; }
    };
}
"""

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + ("" if condition else "  " + str(detail)[:600]))
    if not condition:
        failures.append(name)


client = Client(exe)
init = client.request("initialize", {"processId": None, "rootUri": uri_of(root), "capabilities": {}, "initializationOptions": {"runtimeDir": os.path.abspath(runtime), "checkOnChange": False}})
client.notify("initialized", {})
legend = init["capabilities"]["semanticTokensProvider"]["legend"]
types, modifiers = legend["tokenTypes"], legend["tokenModifiers"]
uri = uri_of(os.path.join(root, "src", "embedded_probe.djinn"))
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
    found.setdefault((line, text), []).append(types[kind])


def at(line_no, text):
    return found.get((line_no, text), [None])[-1]


check("legend has tag, operator and string", all(t in types for t in ("tag", "operator", "string")), types)
check("html macro name is a macro", at(3, "html") == "macro", found)
check("native tag is a tag", at(4, "div") == "tag", found)
check("attribute name is a property", at(4, "class") == "property", found)
check("hyphenated attribute is one property", at(4, "data") == "property" and at(4, "id") == "property", found)
check("attribute value is a string", at(4, '"card"') == "string", found)
check("tag bracket is an operator", at(4, "<") == "operator", found)
check("closing tag name is a tag", at(9, "div") == "tag", found)
check("component tag is a class", at(6, "Button") == "class", found)
check("array attribute values are Djinn", at(6, "title") == "parameter" and at(6, "items") == "property", found)
check("{title} stays Djinn", at(5, "title") == "parameter", found)
check("tag inside a code group is markup", at(8, "b") == "tag", found)
check("rule language keyword", at(11, "select") == "keyword" and at(11, "from") == "keyword" and at(11, "where") == "keyword", found)
check("rule language function", at(11, "count") == "function", found)
check("rule language plain word", at(11, "users") == "variable", found)

check("css macro name is a macro", at(29, "css") == "macro", found)
check("css class selector is a class", at(30, "card") == "class", found)
check("css pseudo class is a keyword", at(30, "hover") == "keyword", found)
check("css element selector is a tag", at(30, "p") == "tag", found)
check("css property is a property", at(30, "color") == "property", found)
check("css custom property is a variable", at(30, "gap") == "variable", found)
check("css hex color is a string", at(30, "3b82f6") == "string", found)
check("css keyword value is an enum member", at(30, "auto") == "enumMember", found)
check("css at-rule is a decorator", at(31, "media") == "decorator", found)
check("css function is a function", at(31, "var") == "function", found)
check("css important is a keyword", at(31, "important") == "keyword", found)

definition = client.request("textDocument/definition", {"textDocument": {"uri": uri}, "position": {"line": 25, "character": 29}})
check("component attribute goes to the struct field", len(definition) == 1 and definition[0]["range"]["start"]["line"] == 21, definition)

diagnostics = client.wait_for("textDocument/publishDiagnostics", lambda p: p["uri"].lower() == uri.lower() and len(p["diagnostics"]) > 0)["diagnostics"]
codes = {d.get("code") for d in diagnostics}
check("repeated attribute is reported", "html-duplicate-attribute" in codes, diagnostics)
check("mismatched closing tag is reported", "html-mismatched-tag" in codes, diagnostics)
check("stray closing tag is reported", "html-unexpected-closing-tag" in codes, diagnostics)
check("unclosed tag is reported", "html-unclosed-tag" in codes, diagnostics)
check("well formed markup is clean", not any(d["range"]["start"]["line"] < 12 for d in diagnostics), diagnostics)
check("unknown css property is reported", "css-unknown-property" in codes, diagnostics)
check("css declaration without a colon is reported", "css-expected-declaration" in codes, diagnostics)
check("css property without a value is reported", "css-missing-value" in codes, diagnostics)
check("css rule without a selector is reported", "css-rule-without-selector" in codes, diagnostics)
check("well formed css is clean", not any(d["range"]["start"]["line"] in (30, 31) for d in diagnostics), diagnostics)
client.close()
print("%d failure(s)" % len(failures))
sys.exit(1 if failures else 0)
