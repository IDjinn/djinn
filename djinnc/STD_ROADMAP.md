# Roadmap: std em Djinn compilada pelo djinnc

Objetivo: o djinnc compila `std/` por inteiro (hoje 3,9 mil linhas, sem exceções) e a std continua **opcional**: sem
`--std` / `libs: ['std']` só o core da linguagem (`runtime/core.djinn`) entra na build. A std é a base do framework
futuro, então as mesmas fontes servem ao stage0 e ao djinnc.

## Como a std entra na build

- `--std` (ou `libs: ['std']` no `djinn.proj`) adiciona os `.djinn` de `std/`; `--std-dir <dir>` / `DJINN_STD_DIR` escolhe a pasta (padrão: `<runtime-dir>/../std`).
- `import a::b;` torna os nomes do namespace `a::b` visíveis no namespace declarado no mesmo arquivo. Dentro da std todos os namespaces `std*` enxergam uns aos outros (prelúdio), como no stage0.
- `struct size : u32;` (base primitiva ou ponteiro, sem corpo) é um alias de tipo.
- Quando a std declara `str`, `string`, `arr`, `TypeInfo` ou `object`, as declarações iguais de `core.djinn` (e seus `impl`) são descartadas e os ganchos do compilador (interpolação, literais, boxing) usam as da std (`std::types`). Sem std, o core continua com as suas.
- `Debug.assert(cond, msg)` mínimo vive no core até `[Location]` existir.

## Arquivos da std

| Arquivo | Estado | O que falta |
|---|---|---|
| `types/types.djinn`, `types/constraints.djinn` | na build (`--std`) | `impl` genérico de `arr<T>`, `i128`/`u128`, `f32* p = &this`, literais de 64 bits sem sinal, `where` com `;` |
| `collections/array.djinn`, `map.djinn`, `range.djinn` | na build | `void*` → `T*` implícito (`malloc` em `array()`), `where Key : A, B;` seguido de `{`, aritmética `size` com literais `u` |
| `sys/libc.djinn`, `io.djinn`, `math.djinn`, `process.djinn`, `logger.djinn`, `test.djinn` | na build | `i8*?` já parseia; externs duplicados com o core (nomes iguais em namespaces diferentes) |
| `sys/debug.djinn`, `sys/intrinsics.djinn`, `util/version.djinn` | na build | `[Location]`, `attribute`, `[attribute]`, intrinsics de debug e inicializador posicional |
| `sys/task.djinn`, `builtin/coro.djinn` | fora | structs `[intrinsic]`/`[no_mangle]` sem corpo; `task<T>` e as corrotinas já estão no core |
| `sys/console.djinn`, `sys/spectre.djinn` | fora | `for ... in`, `async` em I/O, tamanho (2,4 mil linhas) |
| `net/socket.djinn` | fora | `async`, externs de rede |

A lista de exclusão está em `driver/std_library.djinn` (`pending_files`); cada item sai dela quando o djinnc passa a compilá-lo.

## Ordem proposta

1. Rodar `djinnc --std` com os arquivos acima e corrigir, um erro por vez, o que a primeira compilação apontar (nada disso foi executado ainda).
2. `[Location]` e `Debug` da std no lugar do mínimo do core.
3. `for ... in` sobre ranges e `arr`/`array`, depois `console`.
4. Atributos declarados (`attribute`) e `[intrinsic]`, depois `intrinsics.djinn`, `task.djinn`, `coro.djinn`, `version.djinn`.
5. `async` em I/O (`socket`), `spectre`.
6. Exceções (`throws`/`try`/`catch`): a std atual não usa nenhuma; entram depois, junto com o framework.
