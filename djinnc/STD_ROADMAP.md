# Roadmap: std em Djinn compilada pelo djinnc

Objetivo: o djinnc compila `std/` por inteiro (hoje 3,9 mil linhas, sem exceções) e a std continua **opcional**: sem
`--std` / `libs: ['std']` só o core da linguagem (`runtime/core/`) entra na build. A std é a base do framework
futuro, então as mesmas fontes servem ao stage0 e ao djinnc.

## Como a std entra na build

- `--std` (ou `libs: ['std']` no `djinn.proj`) adiciona os `.djinn` de `std/`; `--std-dir <dir>` / `DJINN_STD_DIR` escolhe a pasta (padrão: `<runtime-dir>/../std`).
- `import a::b;` torna os nomes do namespace `a::b` visíveis no namespace declarado no mesmo arquivo. Dentro da std todos os namespaces `std*` enxergam uns aos outros (prelúdio), como no stage0.
- `struct size : u32;` (base primitiva ou ponteiro, sem corpo) é um alias de tipo.
- Quando a std declara `str`, `string`, `arr`, `TypeInfo` ou `object`, as declarações iguais de `runtime/core/` (e seus `impl`) são descartadas e os ganchos do compilador (interpolação, literais, boxing) usam as da std (`std::types`). Sem std, o core continua com as suas.
- `Debug.assert(cond, msg)` mínimo vive no core até `[Location]` existir.

## Estado

O djinnc compila os 19 arquivos de `std/` por inteiro com `--std` (a lista `pending_files` em `driver/std_library.djinn` está vazia). A suíte `tests/djinnc/std/` roda no `tests/djinnc/run.sh` com `--std` e cobre:

| Teste | O que exercita |
|---|---|
| `collections` | `array<T>` (crescimento a partir de capacidade 0), `map<K,V>` (set/get/has/remove, rehash) e `range` |
| `optional_result` | `optional<T>` e `result<T,E>` com `switch` e inferência de genéricos |
| `console` | `Console.writeSync` com `{n}`, argumentos `string`, `str` e inteiros empacotados em `arr<object>` |
| `math`, `io`, `process`, `logger`, `spectre` | bindings de libc, `i8*?` como `optional<i8*>`, saída ANSI do Spectre |
| `hash_version`, `hash_wide` | `Hashable` de inteiros, `f32` e `i128` |
| `version`, `semver` | `Version` com a gramática oficial do semver 2.0.0: `parse` estrito, pré-release, build e precedência |

Correções que a primeira compilação real exigiu:

- Com a std presente, `drop_overridden_core` não removia o `str`/`string`/`arr` do core (o teste ainda procurava `core.djinn` depois da divisão em `runtime/core/*.djinn`); os dois tipos coexistiam e uma chamada com literal falhava.
- O core enxerga `std::types` quando ele existe (o namespace raiz importa a std), porque os tipos descartados passam a vir de lá.
- `string` e `str` passados a `...args` são empacotados como `i8*` terminado em NUL (`Reflection.terminated`/`terminated_view`), como as demais conversões declaradas por `IFormatable`.
- `Console` lia o `i8*` empacotado sem a indireção (`data` aponta para o valor empacotado).
- `array.grow` dobrava a capacidade 0, e `map.get` afirmava `state == 0` no caso de sucesso.

## Pendente

1. `[Location]` e `Debug` da std no lugar do mínimo do core.
2. `for ... in` sobre `arr`/`array`.
3. Atributos declarados (`attribute`) e `[intrinsic]` além de leitura/descarte: `intrinsics.djinn`, `task.djinn`, `coro.djinn`.
4. `async` em I/O (`socket`), `Console.write` assíncrono e `readLine`.
5. `T*` sem aritmética/indexação na própria std (issue #57): a std ainda indexa e soma em `T*`.
6. Exceções (`throws`/`try`/`catch`): a std atual não usa nenhuma.
