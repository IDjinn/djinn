# Promoção do djinnc a compilador oficial

Registro do processo de tornar o djinnc (escrito em Djinn) o compilador oficial e remover o compilador C++ (stage0).
Este arquivo é atualizado a cada etapa, até o fim do processo. Levantamento feito por leitura de código em `76a46a7`,
sem compilar nem executar nada; "ausente" quer dizer que não existe caminho no código, não que um teste falhou.

## Decisões

| Tema | Decisão |
|---|---|
| Seed | Tag `stage0-final` no último commit com C++, mais uma GitHub Release com binários de Windows e Linux. O bootstrap recebe `--seed <djinnc>` |
| LSP (`lsp/`) | Removido junto com o C++; o porte futuro é um TODO (abaixo) |
| Gaps silenciosos | Só documentados (seção própria); o djinnc não é alterado nesta promoção |
| gtests do C++ (724 casos) | Removidos e catalogados; recuperáveis pela tag. O sistema de testes do djinnc continua básico (`run.sh`, `fixpoint.sh`, bootstrap) porque o framework nativo ainda não existe |
| Sintaxe que falta | Entra aos poucos depois, primeiro no djinnc |

Regra do projeto: builds e testes são rodados pelo usuário (`AGENTS.md`). A remoção do C++ só acontece depois do portão da etapa 3.

## Status das etapas

| Etapa | Situação |
|---|---|
| 1 — Este documento | Feito |
| 2 — Tirar o stage0 do caminho (branch `feature/promote-djinnc`) | Feito no código, **não executado**: `bootstrap.sh/.ps1` com `--seed`, `tools/build_runtime.sh/.ps1`, `debug_tests.sh`, `playground.*`, `docker/run.sh`, regra do seed no `SUBSET.md`, CTest `djinnc_bootstrap` retirado do `CMakeLists.txt` |
| 3 — Portão: verificação e seed | **Pendente (usuário)** |
| 4 — Remoção do C++ | Pendente (depende da 3) |
| 5 — Documentação final | Pendente (depende da 4) |

## Por que o stage0 ainda não podia sair

- **Não havia seed.** Sem tags nem releases; os únicos binários eram cópias locais de Windows em `build/` (ignorado pelo git).
- **O fixpoint no HEAD não estava confirmado.** O build em `build/bootstrap` é de 4/nov e conta 145.208 tokens, contra 155.137 em `tools/bench.reference.json`.
- `tools/bootstrap.sh` chamava o stage0 com `-r`, que o djinnc rejeita (`options.djinn:135`).
- O alvo `djinn_runtime`, o CTest `djinnc_bootstrap` e o `Dockerfile` dependiam de CMake e do stage0.
- Sem CI: `.github/workflows/build.yml` foi apagado em `8e73d8d` (2026-08-20) e o badge do `README.md` está morto.

## Etapa 3 — Portão (usuário)

Nada é removido antes disto. Na branch `feature/promote-djinnc`, com o C++ ainda presente:

1. Gerar o seed local com o stage0 atual: `djinn -r djinnc` (sai em `djinnc/build/djinnc[.exe]`).
2. Gerar a biblioteca do runtime: `tools/build_runtime.sh` (ou `.ps1`). Saída em `build/runtime`.
3. Bootstrap: `tools/bootstrap.sh --seed djinnc/build/djinnc.exe --runtime-dir runtime --runtime-lib build/runtime/djinn_runtime.lib --lld`. Esperado: `PASS fixpoint`, samples e `PASS bootstrap`.
4. `tests/djinnc/run.sh <stage2> runtime` e `tests/djinnc/fixpoint.sh <stage1> runtime`.
5. Repetir no Linux: `docker build -t djinn-linux .` e `docker run --rm --cap-add=SYS_PTRACE --security-opt seccomp=unconfined djinn-linux`; guardar o `djinnc` gerado como seed de Linux.
6. Criar a tag `stage0-final` e a Release com os dois seeds (exigem LLVM 21 em tempo de execução). A publicação é feita só com confirmação explícita.

Pontos a conferir na primeira execução (escritos sem poder rodar):

- `build_runtime.sh` no Windows usa `-fms-runtime-lib=dll` (equivalente ao `MultiThreadedDLL` do CMake) e `llvm-lib`; a flag é uma inferência, não foi testada.
- Os estágios agora são compilados com `-O2` (o djinnc ignora `optimization-level` do `djinn.proj`). O benchmark de referência só falha em regressão acima de 10%, então fica mais folgado; reajustar com `--update-ref` na máquina de referência.
- `--runtime-lib` com `--lld` exige o runtime em release, sem ASan.

Falhas desta etapa voltam para este documento e são corrigidas antes de seguir.

### Resultado no Linux (2026-11-06)

Depois das correções abaixo, no Docker (Ubuntu 24.04, LLVM 21): `PASS fixpoint`, todos os samples nos três estágios e com `-g`, `PASS benchmark`, `PASS bootstrap`, testes de debug (lldb) e `tests/djinnc/run.sh` com `--lld` (141 `PASS`, saída 0). O `djinnc` de Linux está em `build/seed-linux/djinnc`.

Antes disso o `error_async` abortava com `free(): invalid pointer` (exit 134, esperado 24) nos três estágios e com `-g`. Causa, confirmada com valgrind e desmontando o binário: `half` alocava o frame da corrotina com `malloc(40)` e gravava o byte de estado em `frame+0x28`, um byte além do bloco. O módulo nunca recebia *data layout*: o LLVM calculava o frame com o layout padrão (`i64` alinhado a 4) e o gerador media os tipos com o próprio (`i64:64`). Em Linux isso corrompe o cabeçalho do chunk seguinte; no Windows o heap tem folga e passava em silêncio, então **o bug existia nos dois**. Correção: `LLVMSetModuleDataLayout(gen.module, gen.layout_data)` em `CodeGenerator.create`. `--emit-ir` passa a imprimir a linha `target datalayout`.

Também corrigido em Linux: `tests/djinnc/run.sh` comparava `std/*.stdout` com CRLF contra a saída com LF (e tinha um CR literal no padrão do `tr`); agora tira o `\r` dos dois lados, e o `.gitattributes` fixa `tests/djinnc/std/*.stdout` em LF.

### Resultado no Windows (2026-11-06)

Bootstrap rodado pelo usuário com o stage0 de `cmake-build-release-visual-studio/djinn.exe`: o fixpoint e os samples passaram, **exceto um teste** que falhou e foi adiado (quase certamente o `error_async`, o mesmo bug de data layout do Linux). Refeito depois da correção: `build/bootstrap/stage2/djinnc.exe` (10:32) tem `target datalayout`, o IR do stage2 e do stage3 é idêntico, e `tests/djinnc/run.sh` com `DJINN_USE_LLD=1` e `build/runtime/djinn_runtime.lib` dá 141 `PASS`, saída 0.

**Limitação conhecida no Windows:** `run.sh` com `--runtime-lib` mas **sem** `DJINN_USE_LLD` falha em todo programa que usa `printf` (`lld-link: error: undefined symbol: printf`). O `printf` do UCRT é inline: a `.lib` do runtime feita pelo MSVC/CMake o carregava dentro dela; a feita por clang (`tools/build_runtime.sh`) não, e só o caminho `--lld` adiciona `legacy_stdio_definitions` (`driver/linker.djinn:58`). Usar sempre `--lld` com `--runtime-lib` no Windows até o caminho do clang receber o mesmo `defaultlib`. Problemas de ambiente achados no caminho:

- `djinn` não está no `PATH`; o stage0 sai com `0xC0000135` ao executar o djinnc se `LLVM-C.dll` não estiver no `PATH`, mas o `djinnc.exe` já foi gerado.
- Os wrappers `.ps1` pegavam o `bash` do WSL (`System32`), sem distribuição; passaram a preferir `C:\Program Files\Git\bin\bash.exe`.
- O LLVM de `C:\dev\llvm-21.1.1` não traz `clang` nem `lld-link`; eles vêm de `C:\Program Files\LLVM\bin`, que deve ficar depois no `PATH` para a `LLVM-C.dll` continuar sendo a da 21.
- **Linux (Docker): o stage0 falhava com `E3004: field 'symbols' could not be located inside struct 'CodeGenerator'`.** Causa: `DjinnCompiler::compileFromDirectory` junta os arquivos do projeto com `recursive_directory_iterator` sem ordenar (`DjinnCompiler.cpp:701`). No NTFS a iteração é alfabética, no Linux é arbitrária, e o stage0 precisa do arquivo do struct antes dos arquivos `impl` (`djinnc/README.md:24`). Corrigido com `std::ranges::sort(userFiles)` antes do parse. É a mesma classe de problema de determinismo da Fase 0.7. As listas da std (`DjinnCompiler.cpp:507, 588, 1043`) também iteram sem ordenar e não foram tocadas.
- No Git Bash, `/out:` do `llvm-lib` era reescrito como caminho Unix; `build_runtime.sh` usa `-out:`.

## O que falta do compilador original

Evidência em `arquivo:linha`; caminhos do C++ na raiz do repositório, do djinnc em `djinnc/src/`.

### Parser

| Feature | C++ (`parser/Parser.cpp`) | djinnc |
|---|---|---|
| Ternário `a ? b : c` | 1939 | ausente (`parser/parser_expressions.djinn:52`) |
| `?.` e `!.` | 2209 | ausente (no C++ o binder e o gerador nunca leem o kind) |
| `??=` | 2681 | ausente (`parser_expressions.djinn:36`) |
| `yield;` / `yield v;` | 1541 | ausente (`parser_statements.djinn:17`) |
| Braço de `switch` com bloco `-> { }` | 2868 | ausente; `{` vira struct init (`parser_statements.djinn:161`) |
| `switch x {}` como statement | 1504 | ausente; exige `(` (`parser_statements.djinn:119`) |
| Vírgulas opcionais em braços e variantes | 2882, 3131 | obrigatórias (`parser_statements.djinn:164`, `parser_aggregates.djinn:93`) |
| Destructuring `auto {a, b} = e` | 1581 | ausente |
| Contracts `require`/`ensure`, `return` em `ensure` | 1399, 2410 | rejeitado (`parser_declarations.djinn:406`) |
| Range anônimo `for (0..n)` | 1722 | ausente (`parser_statements.djinn:406`) |
| `if` compile-time no topo | 1013 | ausente (`parser_declarations.djinn:70`) |
| `const` no topo | 1263 | ausente (`parser_declarations.djinn:121`) |
| Struct anônima | 578, 1244 | ausente (`parser_aggregates.djinn:235`) |
| Encaminhamento `...` | 2338 | ausente; no C++ também é parcial (`generator/expressions/FunctionCall.cpp:469` comentado) |
| `new [1,2]`, `new i32[1,2]` | 2173 | ausente (`parser_expressions.djinn:348`) |
| Literal tipado `i32[1,2]` | 2515 | ausente |
| `Point[n]` | 2535 | só primitivos (`parser_expressions.djinn:374`) |
| Operador com corpo `=> expr` | 3412 | ausente (`parser_declarations.djinn:488`) |
| `T {1, 2}`, `T {}` | 2717 | parcial; exige `{ .` (`parser_expressions.djinn:445`) |
| Interpolação implícita `f("x={x}")` | 3983 | ausente; o djinnc só tem `$"..."` |
| Palavras-chave como nome de membro | 2244 | ausente (`parser_expressions.djinn:266`) |
| Atributos `[a-b]`, `k=v`, `A\|B` | 921 | parcial, argumentos descartados (`parser_attributes.djinn:14`) |
| Alvos na declaração de atributo | 3436 | descartados (`parser_declarations.djinn:182`) |
| Macro: fragmento `block` | 3575 | ausente, lido como literal (`parser_macros.djinn:41`) |
| Macro: substituição de `type` | 3841 | sem binding (`parser_macros.djinn:205`) |
| Macro: corpo | 3613 (fluxo de tokens) | só uma expressão (`parser_macros.djinn:71`) |
| Campos em `impl` | 3252 | rejeitado (`semantic/analyzer/semantic_analyzer_impls.djinn:86`) |
| Posição do `where` em método | 440, antes de `(` | depois de `)` (`parser_declarations.djinn:396`); incompatível |

Sem diferença no lexer: todo token e palavra-chave do C++ existe em `lexer/token_kind.djinn`. Alguns (`?.`, `!.`, `??=`, `yield`, `require`, `ensure`) existem como token, mas o parser do djinnc nunca os usa. Closures e lambdas não existem em nenhum dos dois; `private` não é imposto por nenhum; defaults genéricos (`GRAMMAR.md:240`) não são parseados por nenhum.

### Tipos e intrinsics

| Feature | C++ | djinnc |
|---|---|---|
| Sufixos de overflow `w/t/c/s` (tipo e literal) | `generator/expressions/OverflowArith.cpp:60` | parseados e descartados (`ast/types/type_ref.djinn:127`) |
| Non-zero `i32n` | `binder/validation/TypeValidator.cpp:97` | parseado e descartado (idem) |
| `nfloat` | f32 (`parser/Parser.cpp:290`) | f64 (`ast/types/type_ref.djinn:104`) |
| `nintt` e outros `nint` com sufixo | `parser/ast/Type.h:68` | ausente |
| `f16`, `f128` | `parser/ast/Type.h:112` | viram `double` (`codegen/code_generator_types.djinn:13`) |
| `T?` com rejeição de null | flag, `binder/types/TypeResolver.cpp:214` | açúcar de `optional<T>` (`semantic/symbols/symbol_table.djinn:189`), sem rejeição |
| `alignof`, `bitcast`, `expect`, `await_block` | `generator/Intrinsics.h:30` | ausentes (`ast/node/intrinsic.djinn:32`) |
| `sizeof(expr)`, `typeof(expr)` | `generator/expressions/FunctionCall.cpp:60` | só tipos (`parser/parser_expressions.djinn:393`) |
| `coro::suspend` | `generator/expressions/IntrinsicMethods.cpp:83` | sem `__djinn_mark_waiting` |
| Coerção `str` para `i8*` | testes `aggregates/slices` | rejeitada (`semantic/checker/type_checker_calls.djinn:195`) |

### Semântica e geração de código

| Feature | C++ | djinnc |
|---|---|---|
| `destroy()` automático no fim do escopo | `generator/GeneratorStatement.cpp:714` | **ausente**; a std define `destroy()` (`std/collections/array.djinn:64`, `map.djinn:155`) e vaza sem isso |
| Checagem de divisão por zero | `generator/statements/GeneratorErrorHandling.cpp:323` | ausente; sem `__djinn_runtime_error` |
| Contracts e checagem non-zero na entrada | `GeneratorErrorHandling.cpp:354, 381` | ausentes |
| Hierarquia de erros e família `Exception` | `binder/ErrorTypes.h:33` | só tipo exato (`semantic/symbols/function_info.djinn:35`); o core tem apenas `Error` |
| Relatórios debug/release, rastreio de variáveis | `generator/RuntimeDiagnostics.cpp:61` | parcial: só push/pop de frame e captura de stack |

Há paridade em propriedades, operadores (incluindo `!=` derivado), try/throw, async, reflexão e debug info.

### Diagnósticos

O djinnc não tem códigos numéricos, notas, ajuda nem trechos de fonte (`support/source/diagnostics.djinn:12`) e para no primeiro erro de parse por arquivo; o C++ se recupera (`Parser.cpp:256`).

| Grupo | C++ (`binder/`) | djinnc |
|---|---|---|
| 3005: overflow de literal, negativo para unsigned, float para int, ponteiro incompatível | `types/TypeResolver.cpp:329, 394, 412, 459` | ausente; `check_variable` não compara tipos |
| 3005: null para não-nullable, avisos de cast/boxing | `TypeResolver.cpp:216`, `visitors/BinderExpressionVisitor.cpp:159`, `generator/expressions/VariableInit.cpp:181` | ausente |
| 3007: local, parâmetro ou variante de enum duplicado | `expressions/VariableBinder.cpp:29`, `statements/FunctionBinder.cpp:77`, `declarations/EnumCollector.cpp:43` | ausente |
| Regras de enum flag | `EnumCollector.cpp:29, 35, 82, 91` | ausente |
| 3016 `MEMORY_LEAK` | `expressions/FieldBinder.cpp:190` | ausente |
| 4006: `mut const`, const sem inicializador | `parser/Parser.cpp:722, 808` | o primeiro é aceito em silêncio; o segundo é erro genérico de parse |
| 7001: constante em `if` de runtime | `statements/ControlFlowBinder.cpp:87` | ausente |
| 9003: `throw` de tipo que não é erro | `visitors/BinderStatementVisitor.cpp:129` | permitido (sample `error_primitive`) |
| 9006, 9007: throw ou violação provável | `Binder.cpp:479-539` | ausente |
| 9008: braço inalcançável | `generator/GeneratorExpression.cpp:338` | parcial: só variantes duplicadas |

Paridade em 3001-3015 (exceto o acima), 5001-5002, 6001, 8001 e 9001-9005.

### Avaliador de constantes

- Projeto diferente: o C++ é uma VM de pilha com bytecode (`evaluator/ConstEvaluator.h:28`); o djinnc percorre a árvore (`semantic/const_eval/const_eval.djinn`).
- Ausente no djinnc: `THROW` (cai em "não suportado", `const_eval.djinn:867`) e `Int128` (valores são `i64`).
- Mesmos limites: 1M de passos e profundidade 512. O djinnc também faz do-while, switch, break/continue e strings.

### CLI e `djinn.proj`

Fontes: `main.cpp`, `config/ProjectConfig.h`, `djinnc/src/driver/options.djinn`, `project.djinn`.

- **Opções ausentes:** `-out`, `-r`, `--bundle`, `-l <.ll>`, `-macro`, `--no-coro-passes`, `--no-cache` (e o cache de build), `--debug`, `--release`, `--error-enforcement`, `--std-decl`, `--no-std`, e `-o x.djlib` com modo biblioteca automático.
- **Renomeadas:** `-ir` para `--emit-ir`, `-ast` para `--emit-ast`, `-c` para `--no-link`, `-run` para `--run` (JIT), `--native-lib` para `--link-arg`, `--inspect [--json]` para `--inspect-lib` (sem JSON).
- **Armadilhas:** `--lib` no C++ constrói uma biblioteca, no djinnc consome uma. A std é padrão no C++ e opt-in no djinnc (`--std`). O otimizador padrão é `-O3` no C++ e `-O0` no djinnc.
- **Chaves do `djinn.proj` lidas pelo djinnc:** `libs` (só `std`), `file`, `directory`, `generate`, e qualquer linha entre aspas vira argumento de link. O leitor varre linhas (`project.djinn:47-81`) e não parseia YAML; um diretório de projeto exige `<dir>/src` (`project.djinn:20-27`), então `std/` e `playground/` não funcionam como projeto; um `libs: [ 'std' ]` em várias linhas vira argumento de link.
- **Chaves ignoradas:** `project`, `version`, `compiler.logger.*`, `runtime.logger.*`, `generate-binary`, `run-after-compile`, `bundle-modules`, `internals.*`, `optimization-level`, `skip-coro-passes`, `library-mode`, `no-cache`, `build-mode`, `reflection-mode`, e entradas `.djlib` ou `.ll` em `libs`.
- **Ordem da std:** a lista ordenada do prelúdio do C++ (`DjinnCompiler.cpp:142-149`) não tem equivalente.

### Formato `.djlib`

Incompatível nos dois sentidos. C++: magia `DJLB`, cabeçalho de 16 bytes, metadados JSON e bitcode LLVM (`lib/DjLibFormat.h:15`). djinnc: magia `DJINNLIB`, cabeçalho de 128 bytes, seções com checksum, fonte minificado e objeto nativo (`driver/library.djinn:213`, ver `LIBRARY.md`).

## Gaps silenciosos

Compilam no djinnc, mas se comportam diferente do C++, **sem aviso**. Decisão: só documentar por enquanto.

| Construção | Comportamento no C++ | Comportamento no djinnc |
|---|---|---|
| Sufixos de overflow (`i32w`, `i32t`, `i32c`, `i32s`) | aritmética com wrap, trap, checada ou saturada | sufixo descartado: aritmética comum |
| Non-zero (`i32n`) | checado na entrada, elide checagem de divisão | sufixo descartado |
| `f16`, `f128` | tipos próprios | `double` |
| `nfloat` | f32 | f64 |
| Divisão por zero | trap de runtime | comportamento do LLVM |
| `destroy()` | chamado no fim do escopo | nunca chamado; vaza |
| `mut const` | erro 4006 | aceito |
| `throw` de tipo que não é erro | erro 9003 | aceito |
| Tipos incompatíveis em declaração (3005) | erro | aceito, sem comparação |

## Catálogo dos gtests do C++

Todos os 724 casos (54 arquivos em `tests/**/*.cpp`, mais `tests/TestHelpers.h`) chamam `DjinnCompiler::run` e só rodam com o stage0. Ficam disponíveis na tag `stage0-final`.

**Sem nenhuma cobertura em `tests/djinnc`:**

| Arquivo | Casos | Feature |
|---|---|---|
| `tests/arithmetic/overflow.cpp` | 36 | sufixos de overflow |
| `tests/types/non_zero.cpp` | 24 | non-zero |
| `tests/compile_time/contracts.cpp` | 14 | `require`/`ensure` |
| `tests/control_flow/runtime_errors.cpp` | 12 | traps de runtime |
| `tests/aggregates/destructuring.cpp` | 5 | destructuring |
| `tests/compiler/mangler.cpp` | 38 | mangling do C++ (o djinnc não tem equivalente) |

**Cobertura parcial:** `types/native_types`, `types/nullable`, `strings/string_interpolation` (forma implícita), `error_handling` (hierarquia, braços em bloco, throws em constexpr), `control_flow` (`RangeForAnonymous*`), `async` (`Yield_*`), intrinsics (`Alignof*`, `Expect`), `macro` (`TypeFragment`), `slices` (coerção), `object_typeinfo` (avisos de boxing), `types/const_field` (`MutAndConstError`), `types/pointer_compat` (`IncompatibleTypes`), `constexpr` (`WarningOnConstExprInRuntimeIf`).

**Testam o próprio stage0 (sem porte):** `compiler/selfhost.cpp`, `compiler/bootstrap_subset.cpp`, `compiler/binder.cpp`, `compiler/mangler.cpp`.

O que permanece: `tests/djinnc/run.sh` (selftest, `samples/`, `std/`, `errors/`), `fixpoint.sh`, `tools/bootstrap.sh`, `tools/debug_tests.sh`.

## Dependências do C++ e destino de cada caminho

| Caminho | Destino |
|---|---|
| `binder/ generator/ parser/ lexer/ visitor/ evaluator/ jit/ lib/ utils/ diagnostics/ config/` | remover (frente e meio do stage0); o djinnc tem os equivalentes |
| `main.cpp DjinnCompiler.* ErrorEnforcement.h` | remover. Única referência de arquivo mantido: um comentário em `runtime/djinn_runtime.c:1107` |
| `lsp/` | remover; ver TODO |
| `CMakeLists.txt`, `build_msvc.bat` | remover, depois de migrar o runtime (`tools/build_runtime.*`) |
| `tests/**/*.cpp`, `tests/TestHelpers.h` | remover (catalogados acima) |
| `.run/*.xml` | remover (todos são alvos CMake `djinn` ou `djinn-lsp`) |
| `ext/c4core` | remover: gitlink quebrado, sem entrada em `.gitmodules`, diretório vazio, não referenciado pelo CMake |
| `.gitmodules` | remover a entrada `external/googletest` (sem gitlink); só `docs` é válido |
| `Dockerfile`, `docker/run.sh` | migrar (etapa 4) |
| `tools/bootstrap.*`, `debug_tests.sh`, `playground.*` | migrados na etapa 2 |
| `tools/bench_scale.sh`, `bench.reference.json`, `tools/compiler-explorer/*` | já usam só o djinnc |
| `djinnc/ runtime/ std/ tests/djinnc/ examples/ GRAMMAR.md` | manter |
| `README.md`, `AGENTS.md`, docs do djinnc | atualizar (etapa 5) |
| `docs` (submódulo Fumadocs) | pendência em outro repositório: `libraries.mdx:99-185` documenta `--no-std`, `--std-decl`, `--bundle`, `-l`; há alteração não commitada em `reflection.mdx` |

Pastas ignoradas pelo git (`build/` 5,3 GB com os únicos seeds locais, `cmake-build-debug-visual-studio/`, `cmake-build-release-visual-studio/`, `djinnc/build/`, `.scratch/`, `.idea/`) não são tocadas; apagar é decisão do usuário, depois de guardar os seeds. `playground/` é ignorado e `playground/main.djinn` não está versionado, então os scripts de playground falham em clone novo.

## TODOs que ficam depois da promoção

- **Porte do LSP.** O `lsp/` tinha `initialize`, `shutdown`, `didOpen`, `didChange`, `didClose` e `publishDiagnostics`, com sincronização de texto completo por stdio ou socket (`--socket`/`--port`, padrão 5007); hover, completion e definition estavam comentados (`lsp/LspServer.cpp:100-104`). Validava chamando `DjinnCompiler::run` em processo (`:200`) e tinha um bug: escrevia sequência de limpar tela no stdout (`:174`), corrompendo o protocolo em modo stdio. Não há extensão de editor no repositório. O porte pode chamar `djinnc --no-link` e ler `arquivo:linha:coluna: error:`, mas o djinnc ainda não tem diagnóstico legível por máquina (JSON).
- **Implementar os gaps** das seções acima, na ordem que a std e os usuários pedirem; os silenciosos primeiro (viram erro ou ganham semântica).
- **Framework de testes nativo** (`SELF_HOSTING_ROADMAP.md`, "Framework de testes nativo") e porte do catálogo dos gtests.
- **`optimization-level` do `djinn.proj`** é ignorado pelo djinnc; os scripts passam `-O2` explicitamente.
- **`djinn.proj` com caminho local do LLVM** (`-LC:/dev/llvm-21.1.1/...`); o `Dockerfile` corrige com `sed`. Aceitar variável de ambiente ou arquivo local.
- **CI.** Não existe; recriar com a cadeia seed, runtime, bootstrap, `run.sh`.
- **Runtime:** 6 exports usados só pelo stage0 (`__djinn_runtime_error`, `__djinn_runtime_error_min`, `__djinn_frame_set_line`, `__djinn_last_error_report`, `__djinn_var_track`, `__djinn_mark_waiting`) e 12 sem nenhuma referência (APIs de mutex e thread, `__djinn_runtime_error_message`, `__djinn_unix_timestamp_ms`). Remover ou usar.
- **POSIX:** o link com clang do djinnc não passa `-lm -lpthread` (o stage0 passava); em sistemas antigos usar `--link-arg`.
- **Resíduos do stage0 no fonte:** globais `void*` com cast (`SUBSET.md`, "Globals"), layout de `TypeInfo` "em sincronia com o stage0" e a regra de nomear arquivos `impl` depois do struct (`djinnc/README.md:24`). Nenhum quebra; limpar depois.
- `runtime/core/*.djinn` é obrigatório e o `--runtime-dir` padrão é relativo (`runtime`), então `fixpoint.sh` e `run.sh` só funcionam a partir da raiz.
- `djinnc/README.md:43-52` e `USAGE.md:109-111` listam como não suportado o que já existe (structs, genéricos, enums, interfaces, async, exceções, interpolação); corrigido na etapa 5.
- `examples/switch_expression_test.djinn` é antigo: reverificar com o djinnc.

## Só o djinnc tem

- Segurança: `ptr<T>` bruto como tipo distinto com `unsafe` imposto, e borrow checker (`T* p = &x`). No C++ `checkVariableBorrow` nunca é chamado, então 5003/5004 são código morto.
- Sintaxe: `$"..."` com formatos, `#fields`/`#methods`, `$inspect`, `for-in` sobre `arr`, ranges de início aberto `(a..b]`, argumentos nomeados, propriedades `T name => expr;`, enum com `= valor`, padrões com vários bindings, funções genéricas no topo, `typeof(função)`.
- Semântica: `switch` de erro exaustivo, nicho de ponteiro em `optional`, `panic`, `task<T, E>`.
- Driver: `--target`, `--cpu`, `--features`, `--emit-asm`, `-Os`, `-Oz`, `--stats`, `--selftest`, `--lld`.

## Histórico

- Branch `feature/promote-djinnc`: etapas 1 e 2 escritas, sem executar. `docker/run.sh` ainda gera o seed de Linux com o stage0 dentro da imagem, porque é a única fonte de um compilador Linux até a Release existir.
