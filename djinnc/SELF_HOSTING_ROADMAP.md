# Roadmap: self-hosting e2e do Djinn

Objetivo final: **stage2 == stage3** (fixpoint), com um djinnc **rápido por construção** (modelo Jai: memória em
arenas, dados compactos e contíguos, zero alocação por nó, nada de free individual).

```
stage0 (C++)   --compila-->  djinnc/  => stage1.exe
stage1         --compila-->  djinnc/  => stage2.exe   (+ stage2.ll)
stage2         --compila-->  djinnc/  => stage3.exe   (+ stage3.ll)
diff stage2.ll stage3.ll  == vazio
```

## Status das fases

| Fase | Situação |
|---|---|
| 0, 1 | Concluídas. |
| 2 — Memória e dados | Concluída: arena, tokens SoA, interning de átomos (keywords pré-registradas), AST de nós de 16 bytes. |
| 3 — Multi-arquivo | Concluída: namespaces com escopo (aninhados, fundidos por nome, acesso qualificado `a::b`), `import a::b;` ativo (torna os nomes do namespace visíveis no namespace do arquivo, ver `SUBSET.md`), entradas ordenadas, símbolos por `(namespace, atom)`. O próprio fonte do djinnc não usa `import` (tudo em `namespace djinnc`). |
| 4 — Semântica | Concluída: `TypeTable` (`TypeId` u32 interned), `SemanticAnalyzer` (coleta, layout, assinaturas), `TypeChecker` (tipo e símbolo por nó, loops, imutabilidade); o codegen só consome a AST anotada. Fixpoint stage2 == stage3 verificado. |
| 5 — Codegen e backend | Concluída no Windows: 5.1 completa e 5.2 com objeto direto, `-O2`, `--runtime-lib` e `--lld` (`lld-link`) validados. `ld.lld` em POSIX validado no Linux (Docker, `Dockerfile`): bootstrap, fixpoint e samples com `--lld`. |
| 6 — Harness de bootstrap | Concluída: `tools/bootstrap.sh`/`.ps1`, alvo CTest `djinnc_bootstrap`, `tools/bench.reference.json` (com tempo de lex, parse e codegen), samples com `.exit` e `.stdout` opcional comparados nos três estágios. |

## Estado atual (histórico, anterior às Fases 2–4)

| Área | Situação |
|---|---|
| stage0 (C++) | Compila `djinnc/` (com `libs: ['std']`). Estado por-função espalhado em ~25 membros do `Generator` e ~8 do `Binder`. |
| djinnc lexer/parser | Cobre o subset usado pelo próprio fonte, incluindo structs (só parse). |
| djinnc codegen | Funções, externs, locais, aritmética, ponteiros, controle de fluxo. **Sem structs, métodos, `this`, consts de struct, multi-arquivo.** |
| djinnc driver | Um único arquivo de entrada. O próprio djinnc tem 15 arquivos. |
| djinnc memória | `malloc` individual por `Token`, `Node`, `TypeRef` e `PtrVec` (`Mem.zalloc`). `Node` gordo (~100 B: 4 ponteiros-filho + `PtrVec*` + `i64` + `f64` + `i8*`). Tipos recriados a cada uso (sem interning). Strings copiadas (`copy_text`). Busca de símbolo linear com `strlen`+`memcmp`. |
| djinnc backend | Escreve `.ll` texto → `clang` reparseia → recompila `djinn_runtime.c` + `logger.c` com `-flto -O2` **a cada build**. |
| Testes djinnc | 3 samples (`arith`, `control`, `pointers`) comparando exit code. |

O que o fonte do djinnc usa (e portanto o djinnc precisa compilar): `namespace`, blocos `extern "C"`,
structs com campos, `const` dentro de struct (`NodeKind.PROGRAM`), métodos estáticos (`Mem.zalloc`),
métodos de instância com `this` (813 usos), acesso a campo via ponteiro com auto-deref (`vec.data[i]`),
casts, `sizeof(Struct)`, `void**`, varargs (`printf`), `??`, dependência de `std` (`malloc`, `strlen`, `printf` via
`std::libc`, que importa `std::types` — genéricos, impls etc.).

---

## Princípios de performance (valem para todas as fases do djinnc)

1. **Arenas, não malloc.** Toda alocação do compilador vai para uma arena de lifetime conhecido. Não existe `free`
   de objeto individual; a arena é resetada ou o processo termina. `malloc` só aparece dentro do `Arena` (blocos
   de 1–64 MiB) e via LLVM.
2. **Índices de 32 bits, não ponteiros.** Tokens, nós, tipos, símbolos e strings são `u32` em arrays contíguos.
   Metade do tamanho, cache-friendly, serializável, e comparação é igualdade de inteiro.
3. **Structure-of-Arrays onde o acesso é por coluna.** Lexer/parser leem só `kind` de tokens na maioria das vezes
   → `kinds[]` separado de `starts[]`.
4. **Interning em todo lugar.** Identificadores viram `Atom` (u32) uma vez, no lexer. Tipos viram `TypeId` (u32)
   único por tipo estrutural. Depois do lexer nunca mais se compara/hasheia string.
5. **Zero cópia do fonte.** Arquivo lido inteiro num buffer; texto de token é `(start, length)` dentro dele.
   Linha/coluna são calculadas sob demanda (só em diagnóstico) a partir de uma tabela de início de linha.
6. **Scratch arena por função.** Sema/codegen de uma função usam uma arena temporária com `mark`/`reset`, então o
   pico de memória não cresce com o número de funções.
7. **Medir sempre.** `--stats` imprime tempo por fase, linhas/s, tokens/s e bytes por arena. Toda fase que mexe em
   hot path anexa o antes/depois.
8. **Determinismo é consequência.** IDs atribuídos na ordem de primeira ocorrência, arquivos em ordem ordenada,
   emissão na ordem de declaração → mesmo IR sempre (requisito do fixpoint).

---

## Fase 0 — Endurecer o stage0 (C++)

Tudo que o stage1/stage2 vai exercitar passa primeiro pelo stage0. Bugs de estado aqui geram IR errado de forma
silenciosa e dependente da ordem de geração — exatamente o que quebra um fixpoint. Performance do stage0 **não** é
prioridade (ele só existe para o bootstrap); o investimento de velocidade vai para o djinnc.

**Status (implementado, ainda não compilado nem testado):**

| Item | Estado |
|---|---|
| 0.1 `FunctionContext` | Feito. `generator/FunctionContext.h` + `Generator::FunctionScope` (troca o contexto por swap, escopo de variáveis enraizado no global, restaura o insert point). Todos os corpos de função/método/propriedade/main usam o scope. Também corrigiu: structs/enums monomorfizados agora são registrados no escopo global (antes ficavam no escopo local e sumiam no `pop_scope`), e `return` em método instanciado não emite mais cleanup dos locais do chamador. |
| 0.2 `_lastFieldAccess*` | Feito. `generate_field_access(expr, PointeeHint*)` devolve a dica por parâmetro de saída. |
| 0.3 tipos do Binder | Parcial. `Binder::bindExpression` grava o tipo de cada expressão em `ScopedSymbolTable::expressionTypes`; `Generator::type_of(expr)` consulta. Migrados `resolve_index_element_type` (elementos escalares) e as dicas de ponteiro-para-struct (`bound_pointee`: receptor de chamada de método e `auto x = <expr>`), que só valem para structs não genéricos; os acessos de campo seguem com a heurística antiga como primeira fonte. `pointer_struct_name` já recebe o `Type` da declaração; resta `get_type_name_for_value` (só o caso `unknown` usa `type_of`). |
| 0.4 `StructDef`/`EnumDef` estáveis | Feito. `unique_ptr` + `define_*` preserva endereço. |
| 0.5 `BindContext` | Feito. `Binder::FunctionBindScope`. |
| 0.6 contadores do Parser | Feito. Viraram membros. |
| 0.7 determinismo | Feito. `SymbolTable` guarda ordem de definição; `constExprOrder`/`staticVarOrder` guardam a ordem de declaração (via `addConstExpr`/`addStaticVar`) e constexprs são avaliados por tentativas repetidas até não haver progresso, então dependem de declarações posteriores. `.djlib` sai nessa ordem. |
| 0.8 testes | `tests/compiler/function_context.cpp`. |

### 0.1 `FunctionContext` no Generator (substitui estado solto)

**Problema confirmado.** Estado de "função atual" vive em membros soltos do `Generator`
(`generator/Generator.h:285-397`): `currentFunction`, `currentStructName`, `breakTargets`, `continueTargets`,
`inAsyncFunction` + 7 campos `async*`, `currentFunctionThrows`, `insideTryOperand_`, `inSwitchArmBlock_` +
3 campos `arm*`, `currentContracts_`, `contractReturnAlloca`, `_currentGenericCtx`.

A geração de função **é reentrante**: `monomorphize_struct` (`generator/GeneratorType.cpp:92-157`) gera corpos de
métodos no meio da geração de outra função. Ele salva/restaura manualmente só currentFunction, async e genericCtx.
Não salva `currentFunctionThrows`, `currentContracts_`, `contractReturnAlloca`, `breakTargets`/`continueTargets`,
`insideTryOperand_`, estado de switch-arm, `currentStructName` nem o escopo. Ex.: um `array<T>` monomorfizado
pela primeira vez dentro de um `for` de uma função `throws` com `ensure(...)` volta com contratos zerados
e `currentFunctionThrows = false` (`GeneratorFunction.cpp:37-114` sobrescreve sem restaurar). Os
`SetInsertPoint(savedBlock)` também perdem o ponto de inserção exato e o debug location.

**Design.**

```cpp
// generator/FunctionContext.h
struct LoopTargets
{
    llvm::BasicBlock* breakBlock;
    llvm::BasicBlock* continueBlock;
    size_t scopeDepth;            // cleanup até esta profundidade em break/continue
};

struct CoroutineState
{
    llvm::Value* id = nullptr;
    llvm::Value* handle = nullptr;
    llvm::Value* promise = nullptr;
    llvm::BasicBlock* finalSuspend = nullptr;
    llvm::BasicBlock* cleanup = nullptr;
    llvm::BasicBlock* suspend = nullptr;
    llvm::Type* returnType = nullptr;
};

struct SwitchArmYield
{
    llvm::BasicBlock* block = nullptr;
    llvm::AllocaInst* slot = nullptr;
    bool didYield = false;
};

struct FunctionContext
{
    llvm::Function* function = nullptr;
    std::string structName;
    const GenericContext* generics = nullptr;
    std::optional<CoroutineState> coroutine;         // nullopt == função síncrona
    bool throws = false;
    bool insideTryOperand = false;
    std::vector<const ContractClause*> contracts;
    llvm::AllocaInst* contractReturn = nullptr;
    std::vector<LoopTargets> loops;
    std::vector<SwitchArmYield> armYields;           // pilha: switch dentro de arm de switch
};

class FunctionScope
{
public:
    FunctionScope(Generator& gen, FunctionContext ctx);   // empilha ctx, novo GeneratorScope raiz
    ~FunctionScope();                                      // desempilha, restaura escopo
private:
    Generator& gen_;
    llvm::IRBuilderBase::InsertPointGuard ipGuard_;       // restaura bloco + ponto + debug loc
    std::shared_ptr<GeneratorScope> savedScope_;
};
```

No `Generator`: `std::vector<FunctionContext> functionStack_;` + `FunctionContext& fn()` (assert se vazio).
Loops viram `LoopGuard` RAII (`fn().loops.push_back` / `pop_back`), try-operand vira guard de flag.

**Passos.**
1. Criar `FunctionContext.h` + `FunctionScope`/`LoopGuard`.
2. Migrar `generate_function_body`, `generate_async_function_body`, `generate_method`,
   `generate_async_method_body`, `monomorphize_method`, `monomorphize_property`, `generate_primitive_impl_method`,
   `GeneratorImpl.cpp:70`, `generate_default_main` (`Generator.cpp:317,385`) para `FunctionScope`.
3. Remover o bloco manual de save/restore de `monomorphize_struct` (`GeneratorType.cpp:92-157`) — vira um
   `FunctionScope` por método monomorfizado.
4. Trocar os 5 pares `breakTargets.push_back/pop_back` em `GeneratorStatement.cpp` por `LoopGuard`.
5. Apagar os membros antigos do `Generator.h`. O compilador acusa cada uso esquecido.

### 0.2 Remover o canal lateral `_lastFieldAccess*`

`_lastFieldAccessPointeeType` / `_lastFieldAccessStructName` (`Generator.h:414`) são escritos em
`FieldAccess.cpp:155-278` e lidos em `VariableInit.cpp:394` e `FunctionCall.cpp:804`. Qualquer expressão gerada
entre a escrita e a leitura (argumento de chamada, índice, monomorfização) corrompe o valor.

**Design.** Função pura que retorna o resultado em vez de vazar:

```cpp
struct FieldAccessResult
{
    llvm::Value* value = nullptr;
    llvm::StructType* pointeeStruct = nullptr;   // quando o campo é ponteiro para struct
    std::string pointeeStructName;
};

FieldAccessResult generate_field_access_typed(const FieldAccess& expr);
llvm::Value* generate_field_access(const FieldAccess& expr) { return generate_field_access_typed(expr).value; }
```

`VariableInit` e `FunctionCall` chamam a versão `_typed` quando o operando é `FieldAccess`.

### 0.3 Tipos das expressões vindos do Binder

Hoje o Generator re-deriva tipos Djinn a partir de tipos LLVM (`get_type_name_for_value`,
`pointer_struct_name`, `resolve_index_element_type`), o que é frágil com ponteiros opacos — é a raiz do 0.2.

**Design.** O Binder grava o tipo resolvido de cada expressão numa tabela lateral:

```cpp
struct BindingResult
{
    ...
    std::unordered_map<const Expression*, Type> expressionTypes;
};
```

`Generator::type_of(const Expression&)` consulta a tabela. Migração incremental: primeiro FieldAccess,
IndexAccess e chamadas de método (onde estão os hacks), depois o resto. Não bloqueia as fases do djinnc.

### 0.4 Armazenamento estável de `StructDef` / `EnumDef`

`GeneratorScope.h:231,263` usa `unordered_map<std::string, StructDef>`; o próprio código já documenta
ponteiros invalidados por rehash (`GeneratorType.cpp:82-90`). Trocar para
`unordered_map<std::string, std::unique_ptr<StructDef>>` (idem `EnumDef`). Ponteiros ficam estáveis e o
`auto properties = genericDef->properties` defensivo pode sair.

### 0.5 `BindContext` no Binder

Mesmo problema, menor: `currentFunction_`, `currentStructName_`, `currentFunctionThrows_`,
`currentFunctionThrowsAny_`, `currentFunctionThrowsTypes_`, `insideTryExpression_`,
`tryOperandSawThrowingCall_` (`binder/Binder.h:114-119,247`). `bindMethod` seta `currentStructName_`
(`FunctionBinder.cpp:121`) e nunca limpa — uma função livre bindada depois herda o struct.
Mesma solução: `struct BindContext` + `std::vector<BindContext>` + guard RAII.

### 0.6 Estado global no Parser

`Parser.cpp:1544` (`static size_t destructureCounter`) e `Parser.cpp:1707` (`static int anonRangeCounter`)
são estáticos de processo: nomes gerados mudam conforme quantos arquivos foram parseados antes (quebra
determinismo, cache e LSP). Mover para membros do `Parser`.

### 0.7 Determinismo de saída

Pré-requisito do fixpoint também no stage0 (para comparar stage0 vs stage1 IR):
- Nada de iterar `unordered_map` para decidir **ordem de emissão** de funções/globais/tipos. Onde isso ocorrer
  (`functions`, `typeInfoConstants`, `stringGlobalCache`, structs do escopo), usar ordem de inserção
  (vetor auxiliar) ou ordenar por nome antes de emitir.
- Nenhum nome derivado de endereço de ponteiro.

### 0.8 Testes de regressão

Em `tests/` (GTest, padrão atual):
- método genérico monomorfizado pela 1ª vez dentro de `for` + `break` numa função `throws` com `ensure`;
- idem dentro de função `async`;
- field access de ponteiro-para-struct usado como argumento de chamada com outro field access no meio;
- compilar o mesmo programa duas vezes no mesmo processo → IR idêntico.

**Pronto quando:** testes acima passam, `Generator.h` não tem mais estado por-função solto, stage0 gera IR
idêntico em duas execuções.

---

## Fase 1 — Definir o "Djinn bootstrap subset" e desacoplar do std

O djinnc precisa ser escrito num subset que **ambos** stage0 e djinnc compilam. Sem isso cada feature nova do
fonte do djinnc vira uma corrida.

1. Documentar o subset em `djinnc/SUBSET.md` (lista fechada de construções; tudo fora é proibido no fonte
   do djinnc até ser implementado no codegen do djinnc). Precisa incluir `u8`/`u16`/`u32`, aritmética de
   ponteiro e cast ponteiro↔`u64` (necessários para o `Arena` da Fase 2).
2. Criar `djinnc/src/support/libc.djinn` com os externs usados (`malloc`, `free`, `memset`, `memcpy`, `memcmp`,
   `strlen`, `printf`, `fopen`, `fread`, `fclose`, `system`, `getenv`, ...) usando só `i8*`, `i32`, `u64`, `void*`.
3. Remover `libs: ['std']` do `djinn.proj`. Assim o stage1 não precisa compilar `std/types` (genéricos, impls,
   interfaces) para se autocompilar. Validar que stage0 continua gerando um stage1 funcional.
4. Auditoria: rodar o stage1 com `--emit-ast` em cada arquivo de `djinnc/src` e listar os erros de parse →
   lista de lacunas concreta.

**Pronto quando:** `djinnc/` compila no stage0 sem std, `SUBSET.md` existe, stage1 parseia (`--emit-ast`) todos os
seus 15 arquivos sem erro.

---

## Fase 2 — Fundação de memória e dados do djinnc

Feita **antes** do driver multi-arquivo e da sema, porque tudo depois é construído em cima destas estruturas.
Reescrever lexer/parser/AST depois que a sema existe custaria o dobro.

### 2.1 `Arena` (`support/arena.djinn`)

```
struct ArenaBlock { ArenaBlock* prev; u64 size; u64 used; }   // dados logo após o header

struct Arena {
    ArenaBlock* head;
    u64 block_size;              // 1 MiB padrão, dobra até 64 MiB
    u64 total_reserved;          // para --stats

    static Arena* create(u64 block_size);
    void* alloc(u64 size, u64 align);        // bump; novo bloco se não couber; NÃO zera
    void* zalloc(u64 size, u64 align);       // bump + zero (só quando necessário)
    ArenaMark mark();
    void reset_to(ArenaMark m);              // libera blocos posteriores à marca (mantém 1 em cache)
}
```

Arenas globais do compilador (um `Compiler` struct passado explicitamente, nunca global solto):

| Arena | Lifetime | Conteúdo |
|---|---|---|
| `permanent` | processo | buffers de fonte, tabela de atoms, tipos, símbolos, layout de structs |
| `ast` | até fim do codegen | tokens, nós, listas extra |
| `scratch` | uma função (mark/reset) | locais da sema, temporários de codegen, `LLVMValueRef[]` de args |

`Mem.zalloc` some; `PtrVec` vira `Vec` com storage na arena (cresce copiando para nova região da arena;
o espaço antigo é desperdiçado — aceitável e mais rápido que realloc), ou, melhor, o padrão "conta primeiro,
aloca exato" quando o tamanho é conhecível.

### 2.2 Fonte e tokens em SoA

```
struct SourceFile { u32 id; i8* path; i8* text; u32 length; u32* line_starts; u32 line_count; }

struct TokenList {             // índice = TokenId (u32)
    u8*  kinds;
    u32* starts;               // offset no SourceFile.text
    u16* lengths;              // tokens > 65535 bytes (strings enormes) usam tabela de overflow
    u32* atoms;                // Atom para identificadores/keywords, literal index para literais
    u32  count;
    u32  file;
}
```

- Lexer faz **uma passada** e pré-dimensiona os arrays por heurística (`length / 4` tokens), crescendo raramente.
- Keywords resolvidas pelo próprio interning: os atoms das keywords são pré-registrados nos IDs `0..K`, então
  "é keyword?" = `atom < K` (substitui a cascata de `Str.equals` de `token_kind.djinn`).
- Linha/coluna: `line_starts` gerado no lexer; `location(token)` faz busca binária só quando há diagnóstico.

### 2.3 Interning de strings (`support/atoms.djinn`)

```
struct AtomTable {
    u32* slots;                // open addressing, cap potência de 2, guarda atom+1 (0 = vazio)
    u32* hashes;               // hash por atom, evita recomputar no rehash
    i8** texts;  u32* lengths; // por atom, apontando para o fonte (zero cópia)
    u32 count; u32 capacity;
    u32 intern(i8* text, u32 length);   // FNV-1a ou wyhash
}
```

Todo nome no compilador depois do lexer é `u32`. Nomes qualificados (`ns::Struct::method`) também são atoms
(interned na sema), então mangling e lookups não montam strings em loop.

### 2.4 AST compacta indexada

```
struct NodeData { u16 kind; u16 flags; u32 token; u32 a; u32 b; }   // 16 bytes, NodeId = u32

struct Ast {
    NodeData* nodes;  u32 node_count;
    u32* extra;       u32 extra_count;   // listas: (início, tamanho) em extra[]; payloads > 2 campos
    i64* ints;        f64* floats;       // literais fora do nó
}
```

- Nó cabe em 16 B (hoje ~100 B + `PtrVec` alocado por nó com lista). ~6× menos memória, iteração linear.
- `a`/`b` são filhos ou índices em `extra` conforme `kind` (padrão do Zig): `Binary{a=lhs,b=rhs}`,
  `Call{a=callee,b=extra_start}` com `extra[b]=count, extra[b+1..]=args`, `Function{a=sig_extra,b=body}`.
- Tipo resolvido e símbolo resolvido ficam em arrays paralelos da sema (`types[NodeId]`, `symbols[NodeId]`),
  não dentro do nó → parser não paga por campos que só a sema usa.
- Acessores tipados (`ast.binary_lhs(n)`, `ast.call_args(n)`) escondem o encoding; nenhum código fora de
  `ast/` lê `a`/`b` diretamente.

### 2.5 Migração

1. Implementar `Arena`, `AtomTable`, `TokenList` com testes unitários em samples (`arena.djinn`, `atoms.djinn`).
2. Portar lexer → `TokenList`. `--emit-tokens` continua idêntico (teste de regressão).
3. Portar parser → `Ast`. `--emit-ast` continua idêntico.
4. Portar o codegen atual para ler `Ast` (ainda sem sema).
5. `--stats`: tempo por fase (`QueryPerformanceCounter`/`clock_gettime` via extern), bytes por arena, tokens/s.

**Pronto quando:** samples verdes, `--emit-tokens`/`--emit-ast` idênticos ao antes, zero `malloc` fora de `Arena`
(grep), `--stats` funcionando com números de referência registrados.

---

## Fase 3 — Driver multi-arquivo no djinnc

1. Aceitar várias entradas posicionais: `djinnc a.djinn b.djinn ... -o out`.
2. Cada arquivo vira `SourceFile` + `TokenList`; todos compartilham o mesmo `AtomTable` e o mesmo `Ast` (NodeIds
   globais). Namespaces de mesmo nome se fundem. `import` vira no-op dentro do mesmo projeto (fase inicial).
3. Diagnósticos resolvem arquivo pelo `TokenList.file`.
4. Ordem dos arquivos sempre ordenada por caminho (determinismo dos IDs).
5. Depois: ler `djinn.proj` (parser YAML mínimo: `project`, `output.directory`, `native-libs`) e descobrir
   `src/**/*.djinn` (externs `FindFirstFileA`/`FindNextFileA` no Windows, `opendir` no POSIX).

Preparado para paralelismo (Fase 7): lex+parse por arquivo não tocam estado compartilhado exceto `AtomTable`.

**Pronto quando:** `djinnc $(find djinnc/src -name '*.djinn' | sort) --emit-ast` funciona.

---

## Fase 4 — Camada semântica (`sema/`) no djinnc

Hoje o codegen resolve nomes direto, com busca linear (`find_function` com `Str.same` em `PtrVec`), e guarda
`break_target`/`continue_target`/`current` como campos únicos do `CodeGen` — o mesmo problema da Fase 0.1, em
Djinn. Para métodos e `this.x` é preciso saber o tipo de cada expressão antes de gerar código.

```
djinnc/src/
  support/u32map.djinn     # hash map u32 -> u32 (chave = Atom), open addressing, na arena
  sema/types.djinn         # TypeTable: TypeId u32, interned
  sema/symbols.djinn       # GlobalSymbols: u32map qualified-atom -> SymbolId ; Symbol SoA
  sema/scope.djinn         # LocalScopes: pilha plana (atom, local_id) + marcas por bloco
  sema/sema.djinn          # passes collect -> layout -> check; preenche types[NodeId], symbols[NodeId]
  codegen/fn_ctx.djinn     # FnCtx: função atual, return TypeId, pilha de LoopTargets, scratch mark
```

- **TypeTable:** `kinds[]`, `payload[]` por `TypeId`. Primitivos com IDs fixos (`TY_I32 = 3`...). Ponteiro:
  `ptr_of[TypeId]` cacheia o `TypeId` de `T*` → criar/achar ponteiro é O(1), igualdade de tipo é `==`.
  Structs: `StructInfo { name_atom, first_field, field_count, size, align, llvm_type }` com campos em array
  contíguo.
- **Escopos locais:** pilha plana de `(atom, local_id)`; entrar em bloco = guardar topo; sair = truncar; lookup =
  varredura reversa (funções têm dezenas de locais — mais rápido que hash). Tudo na `scratch` da função.
- **Globais:** `u32map` por atom qualificado. Métodos: chave = atom de `Struct::method`.
- **Passes:** (1) coletar structs/funções/métodos de todos os arquivos; (2) layout de structs e assinaturas;
  (3) checar corpos função a função, com `scratch.reset_to(mark)` ao fim de cada uma.
- `CodeGen` consome só AST anotada; `FnCtx` é empilhado por função, loops numa pilha dentro do `FnCtx`.

**Pronto quando:** os samples atuais passam via sema+codegen, nenhuma comparação de string após o lexer.

---

## Fase 5 — Codegen das features do djinnc + backend direto

### 5.1 Features (na ordem de dependência; cada uma com sample antes da próxima)

| # | Feature | Sample | Notas |
|---|---|---|---|
| 5.1.1 | Tipos struct (`LLVMStructCreateNamed` opaco → `LLVMStructSetBody`), `sizeof(Struct)` | `struct_layout` | Dois passos permitem structs mutuamente recursivas via ponteiro. |
| 5.1.2 | Acesso a campo via ponteiro com auto-deref, leitura/escrita, `&p.x`, `p.data[i] = v` | `fields` | `this.data[this.length] = item` precisa de lvalue de campo + índice. |
| 5.1.3 | `const` em struct como constante de compilação (`NodeKind.PROGRAM`) | `struct_consts` | Sema avalia o inicializador; codegen emite `LLVMConstInt`. |
| 5.1.4 | Métodos estáticos `Struct.fn(...)`, mangling idêntico ao stage0 | `static_methods` | Mangling igual permite comparar IR stage0 vs stage1. |
| 5.1.5 | Métodos de instância com `this` implícito, chamada `p.m()` em ponteiro | `methods` | `this` = primeiro parâmetro `Struct*`. |
| 5.1.6 | `??`, `public`/`private`, atributos | `misc` | Visibilidade pode começar ignorada. |
| 5.1.7 | Namespaces multi-arquivo e nomes qualificados | `multifile/` | Sample com 2+ arquivos. |
| 5.1.8 | Lacunas restantes da auditoria da Fase 1.4 | — | `void**`, casts de ponteiro, `u8`/`u16`/`u32`. |

### 5.2 Backend sem reparse

1. Gerar objeto direto da memória: `LLVMGetTargetFromTriple` → `LLVMCreateTargetMachine` →
   `LLVMTargetMachineEmitToFile(..., LLVMObjectFile)`. Elimina escrever `.ll` texto + `clang` reparsear.
   `.ll` só com `--emit-ir` (usado no fixpoint).
2. Pipeline de otimização via `LLVMRunPasses` (new PM) com `-O0` por padrão em debug e `default<O2>` em release.
   `-O0` deve ser o caminho rápido do dia a dia (modelo Jai: build de debug em fração de segundo).
3. Runtime pré-compilado: `djinn_runtime.c` + `logger.c` compilados **uma vez** para `djinn_runtime.lib` /
   `.a` (alvo CMake) em vez de recompilar com `-flto -O2` a cada link. LTO do runtime só em release.
4. Link chamando `lld-link`/`ld.lld` direto com o objeto + `djinn_runtime.lib`, sem passar pelo driver do clang.

**Pronto quando:** stage1 compila `djinnc/src` inteiro e o stage2 resultante passa em todos os samples; build de
debug não invoca `clang`.

---

## Fase 6 — Harness e2e de bootstrap + benchmarks

1. `tools/bootstrap.ps1` (e `tools/bootstrap.sh`):
   - stage0 → `build/stage1/djinnc.exe`
   - stage1 → `build/stage2/djinnc.exe` + `stage2.ll`
   - stage2 → `build/stage3/djinnc.exe` + `stage3.ll`
   - `fc /b` / `cmp` de `stage2.ll` vs `stage3.ll`; falha mostra o primeiro diff.
2. `tests/djinnc/run.sh` evolui para comparar **stdout + exit code** (`.expected` vira `.stdout` + `.exit`) e
   roda cada sample com stage0, stage1 e stage2: os três devem concordar.
3. Determinismo do djinnc garantido pelos princípios (IDs por ordem de ocorrência, arquivos ordenados, emissão
   na ordem de declaração, contadores de temporários no `FnCtx`).
4. **Benchmark no bootstrap:** o script roda `stage2 --stats` compilando `djinnc/` e grava
   `build/bench.json` (tempo por fase, linhas/s, pico por arena). Regressão > 10% em qualquer fase falha o job.
   Para medir front-end sem ruído, gerar um corpus sintético grande (ex.: djinnc concatenado N vezes com
   namespaces renomeados) e medir lex/parse/sema isoladamente.
5. Integrar ao CTest (target `djinnc_bootstrap`).

**Metas iniciais (a calibrar com a primeira medição):** lex+parse ≥ 1M linhas/s por núcleo; sema ≥ 500k
linhas/s; tempo total de `djinnc/` em `-O0` dominado pelo LLVM, não pelo front-end.

**Pronto quando:** `bootstrap` termina com fixpoint, todos os samples concordam entre os três estágios e o
`bench.json` de referência está commitado.

---

## Fase 7 — Pós-fixpoint (fora do escopo inicial)

- **Paralelismo:** lex+parse por arquivo em threads (arena `ast` por thread, `AtomTable` com shards ou lock
  por shard); codegen por função em módulos LLVM separados quando o volume justificar.
- Feito: `NodeKind`/`TokenKind` são `enum` reais no fonte (`NodeKinds`/`TokenKinds` guardam `COUNT` e as tabelas como `switch`; o nó guarda `u16 raw_kind` e expõe `kind()`/`set_kind()`). Falta usar genéricos e `string`/`arr<T>` no fonte, imports/namespaces separados e `libs: ['std']`.
- **Memória no código gerado (lado da linguagem, estilo Jai):** allocators como valor de primeira classe na std
  (`Allocator` interface + `Arena`/`Temp` allocator), contexto implícito de alocação por thread, e o próprio
  djinnc migrando suas arenas para essa API quando ela existir.
- Compilar `std/` com o djinnc e reativar `libs: ['std']`.
- Exceções (`try`/`throws`/`ensure`/`require`): ainda não implementadas no djinnc. Async e interpolação já estão feitos.
- Congelar o stage0: novas features da linguagem entram primeiro no djinnc.

---

## Marcos

| Marco | Entregável | Depende de |
|---|---|---|
| M0 | Stage0 sem estado solto, determinístico, testes de regressão | — |
| M1 | djinnc sem std, `SUBSET.md`, stage1 parseia o próprio fonte | M0 (0.7) |
| M2 | Arena, atoms, tokens SoA, AST indexada, `--stats` | M1 |
| M3 | Driver multi-arquivo | M2 |
| M4 | `sema/` + `FnCtx`, samples atuais verdes | M3 |
| M5 | Structs, campos, consts, métodos, backend direto → stage1 compila djinnc | M4 |
| M6 | Bootstrap script, stage2 == stage3, benchmark de referência | M5 |

Fases 0 e 1 podem andar em paralelo (arquivos disjuntos: `generator/`+`binder/`+`parser/` vs `djinnc/`).

---

## Status da Fase 1

| Item | Estado |
|---|---|
| 1.1 `djinnc/SUBSET.md` | feito |
| 1.2 `support/libc.djinn` (+ `support/process.djinn`) | feito |
| 1.3 remover `libs: ['std']` (`libs: []`, `bool` próprio em `support/types.djinn`) | feito, validado (stage0 compila o djinnc sem std) |
| 1.4 auditoria `--emit-ast` | gramática ok: os 16 arquivos concatenados parseiam. Arquivo a arquivo falham 5 (tipos de outros arquivos desconhecidos) -> resolvido na Fase 3 (multi-arquivo) |

## Status da Fase 2

| Item | Estado |
|---|---|
| 2.1 `Arena` (alloc, zalloc, mark, reset_to, destroy) | feito, coberto por `djinnc --selftest` |
| 2.2 `Mem`/`PtrVec`/`ByteBuf` sobre a arena do processo (`unsafe static mut void*`), sem `free` | feito |
| 2.3 `AtomTable` (FNV-1a, endereçamento aberto, `intern` zero-copy e `intern_copy` terminado em NUL) | feito, usado pela AST; keywords do lexer ainda usam `Str.equals` |
| 2.4 `TokenList` contígua (32 bytes por token) | feito; SoA de verdade pendente |
| 2.5 AST em array contíguo, links de 32 bits, 60 bytes por nó | feito; alvo de 16 bytes pendente |
| 2.6 `--stats` (tokens, nós, bytes da arena, ticks de lex+parse) | feito; tempo por fase em ms pendente |

## Status das Fases 3 e 5 (parcial) e fixpoint

| Item | Estado |
|---|---|
| `unsafe` obrigatório em `static mut` (stage0 e djinnc) | feito |
| `static` global no djinnc (parser + codegen) | feito |
| Driver multi-arquivo (vários `.djinn` na linha de comando, tipos compartilhados, uma AST) | feito; diretório/`djinn.proj` pendente |
| Codegen de structs, métodos, `this`, constantes, `sizeof(Struct)` | feito |
| `--link-arg` | feito |
| Fixpoint: stage1 -> stage2 -> stage3, IR do stage2 == IR do stage3 | feito (`tests/djinnc/fixpoint.sh`) |

Medição (Windows, stage2 compilando os 21 arquivos do djinnc, 37 mil tokens, 20 mil nós): ~80 ms no total
(lex+parse ~11 ms), contra ~5 s do stage0 em build debug com ASan.

## Status da Fase 5.1 (features do codegen)

| Item | Estado |
|---|---|
| 5.1.1 a 5.1.5, 5.1.7, 5.1.8 | feitos (structs, campos, consts, métodos estáticos e de instância, multi-arquivo, `void**`, casts, `u8`/`u16`/`u32`) |
| 5.1.6 `??` | implementado só para ponteiros (`a ?? b`, associativo à direita, menor precedência, avalia o lado direito sob demanda); sample `coalesce` passa |
| 5.1.6 `public`/`private` | parseados e ignorados, como previsto; atributos ficam fora até o djinnc precisar deles |
| enums, `switch`, genéricos, `try`/`throws`, interfaces | não são da Fase 5: pertencem à Fase 7 e continuam fora do subset |

## Status da Fase 5.2 (backend direto)

| Item | Estado |
|---|---|
| 5.2.1 objeto direto (`ObjectWriter`, `LLVMTargetMachineEmitToFile`, só x86) | implementado e testado (samples, fixpoint); roda `default<O0>` sempre, pois o lowering de corrotinas é necessário para emitir o objeto; `.ll` só com `--emit-ir`/`--no-link`/`--keep-ir` |
| 5.2.2 `LLVMRunPasses` (`default<O2>`) | implementado e testado: `-O2` roda `default<O2>`, sem a flag roda `default<O0>` |
| 5.2.3 runtime pré-compilado | `--runtime-lib` aceita o alvo CMake `djinn_runtime` (precisa ser build release, sem ASan); `tests/djinnc/run.sh` e `fixpoint.sh` recebem o caminho como 3º argumento. Testado no Windows: samples e fixpoint passam |
| 5.2.4 link direto com lld | implementado com `--lld` (só Windows, `lld-link`, exige `--runtime-lib`), testado com `coalesce`; o padrão continua sendo o driver do clang; em POSIX chama `ld.lld` direto com `crt1.o`/`crti.o`/`crtn.o` (`DJINN_LD_LLD`, `DJINN_CRT_DIR`, `DJINN_DYNAMIC_LINKER`), testado no Linux via Docker (`docker run` com `--cap-add=SYS_PTRACE --security-opt seccomp=unconfined`); os scripts usam `--lld` com `DJINN_USE_LLD=1`. No Windows com `--lld`, as `native-libs` do `djinn.proj` (`-L`, `-l`) são traduzidas para `/libpath:` e `.lib` |

## TODO — Performance (djinnc)

- [x] `--stats` com tempo por fase (`PerformanceMonitor` com voltas numeradas: lex, parse, codegen, write-ir, object, link, mais o total) via `__djinn_now_us` do runtime, independente de `CLOCKS_PER_SEC`.
- [x] Arena: os arrays da AST (nós, extra, tipos, símbolos) vêm de `calloc` e deixam de passar pelo `memset` da arena; a compilação do djinnc usa 6,4 MB de arena em vez de 14,9 MB. Tokens e nós por lista já são contíguos.
      antiga; estimar a capacidade pelo tamanho do fonte; `PtrVec` por lista de nós substituído por vetor contíguo de ids.
- [x] Tokens em SoA (`kinds`, `starts`, `atoms`; 9 bytes por token).
- [x] AST de 16 bytes por nó, com filhos em `extra[]`.
- [x] Keywords do lexer via `AtomTable` pré-populada (`Atoms.keyword_kind`). Símbolos ainda são lidos por caractere.
- [x] `Memory.arena()`: a verificação de `null` usa `unlikely`; o custo é um desvio previsto.
- [x] JIT no djinnc: `--run` (`driver/jit.djinn`, ORC LLJIT via LLVM-C; implementado, ainda não compilado nem testado; o stage0 já tinha JIT em `jit/JitRunner.cpp`).
- [x] Objeto direto via `LLVMTargetMachineEmitToFile` (o clang só faz o link).
- [~] `tools/bench_scale.sh <djinnc> <runtime>` gera arquivos de 1k, 10k e 100k linhas e imprime o tempo por fase (crescimento linear). Falta fixar o resultado em CI e comparar com o stage0.
- [~] Debug symbols como metadata nativa do LLVM em vez de strings embutidas. Feito no djinnc (`-g`, `codegen/debug_info.djinn`) e no stage0 (`-g`, `generator/DebugInfo.cpp`, `llvm::DIBuilder`): `DICompileUnit`, `DIFile`, `DISubprogram`, `DILocation` por instrução, `DILocalVariable` (locais e parâmetros) e tipos básicos, ponteiro e struct; no djinnc também `DILexicalBlock`, membros de struct, enums, globais, bindings de `switch`, nomes de método e flag `isOptimized`; o stage0 também tem `DILexicalBlock`, membros de struct e parâmetros struct tipados. PDB no Windows; o stage0 com `-g` linka sem `-flto`, que descarta o CodeView. Testes com lldb em `tools/debug_tests.sh` (`STAGE0=<djinn.exe>` inclui o stage0). DWARF validado no Linux com lldb (Docker). Stack trace simbolizado em crashes: o runtime instala um handler (SEH no Windows com dbghelp+PDB; sinais no POSIX com addr2line+DWARF) e imprime `função (arquivo:linha)` de programas compilados com `-g`, também usado em `__djinn_runtime_error` sem shadow stack; validado no Windows e no Linux (`tests/djinnc/crash`). Falta: ids de localização nos descritores de trap (hoje substituídos por esse simbolizador; só valem a pena se os descritores forem removidos do IR).
      localização, nomes e fonte vão como globals de texto nos descritores de erro de runtime
      (`generator/RuntimeDiagnostics.cpp`), o que incha o IR e o binário e não é lido por debuggers. Alvo: `DICompileUnit`,
      `DIFile`, `DISubprogram` (nome, linkageName, escopo, arquivo, linha, tipo, `spFlags: DISPFlagDefinition`),
      `DILocation` (linha, coluna, escopo) por instrução, `DILocalVariable` (nome, escopo, arquivo, linha, tipo) e
      `DIBasicType` (nome, tamanho, encoding) via `LLVMDIBuilder*` do LLVM-C no djinnc e `llvm::DIBuilder` no stage0.
      Os descritores de trap passam a guardar só um id de localização resolvido a partir dessa metadata. Opt-in por
      `-g`, sem custo quando desligado.
- [x] `-O1` a `-O3`, `-Os` e `-Oz` rodam `default<On>` (padrão `-O0`), inclusive em `--emit-ir`.

## TODO — Pendências de correção

- [x] Erros do lexer, parser, sema e codegen citam o arquivo certo (um `Diagnostics` por arquivo e `Node.file_name()`). Só o erro "no 'main' function defined" usa o primeiro arquivo, por não ter nó.
- [ ] Suíte C++ completa: assertion do LLVM (operandos binários com tipos diferentes) sem causa identificada.
- [ ] Rodar os gtests do stage0 após a mudança de `unsafe`.
- [x] Fase 4: camada semântica (`semantic/`), enums, genéricos, `switch` e interfaces. Resta só `try`/`throws` (ver "Sintaxe do self-compiler", item 8).

## TODO — Sintaxe de ponteiros

- [ ] Hoje `i8*` serve ao mesmo tempo como "ponteiro para byte", "endereço bruto" e "string C" (ex.: `Ast.id_of`,
      `Ast.at`, `Arena.alloc` fazem `(i8*)node`, `base + id * sizeof(Node)` e `(i64)address - (i64)base`). Isso não
      expressa a intenção e assume ponteiros de 64 bits, então não é portável para 32 bits.
- [~] Tipos inteiros por tamanho e por arquitetura: `isize` (com sinal) e `usize` (valores que não podem ser negativos) têm sempre 32 bits, em qualquer alvo, e `sizeof` é `isize`. `nint` tem a largura do ponteiro do alvo (`--target <triple>`, `Target` em `codegen/target/target.djinn`) e `ptr` é o tipo de endereço; `iptr` e `uptr` foram removidos. Sample `pointer_sized`. Objeto só para x86 (o LLVM linkado só tem esse backend); outros alvos geram IR com `--emit-ir`. O stage0 também aceita `isize` e `usize` (32 bits).
- [~] Modelo de ponteiros (decidido; fase 1 parcial: `ptr`, `ptr<T>`, `unsafe` em bloco e função são parseados pelo stage0 e pelo djinnc e todo raw pointer do djinnc já usa a sintaxe, sem imposição de regras ainda):
      - `T*` é o ponteiro seguro: nunca nulo, tipado, sem aritmética nem indexação, e com o borrow checker futuro vale como
        referência com tempo de vida (o compilador poderá emitir `nonnull`, `align`, `dereferenceable`, `readonly` e `noalias`).
      - `T?` é açúcar para `optional<T>` com qualquer T; `T*?` é o ponteiro nullable e usa o nulo como nicho (8 bytes, sem tag).
      - `ptr<T>` é o raw pointer do tamanho da plataforma (8 bytes em x64); `ptr` é `ptr<void>`. Desreferência, aritmética,
        indexação e as conversões que fabricam ponteiro (`ptr<T>` -> `T*`, inteiro -> `ptr<T>`) só em contexto `unsafe`.
      - Nenhuma conversão implícita entre ponteiro e inteiro, nem de `T*` para `ptr<T>`: só cast explícito.
      - `unsafe` vale por bloco e por função; função `unsafe` só é chamada de contexto `unsafe`. `extern "C"` só exige
        `unsafe` quando a assinatura usa ponteiros.
      - Indexação segura é de `arr<T>` e dos tipos com bounds check (`get_unchecked` só em `unsafe`).
      - Async: manter ou usar `T*`/`ptr` vivo através de um suspend é erro de compilação até existir acesso atômico.
      - Fases: (1) `unsafe` como contexto, `ptr<T>` e restrição de aritmética; (2) nicho de `optional<T*>` [feito no djinnc: união com duas variantes, uma vazia e outra com um único ponteiro, vira 8 bytes sem tag e `None` é o nulo; `T?` é açúcar para `optional<T>` (e `T*?` para `optional<T*>`, com nicho) resolvido pelo djinnc quando existe um `optional` genérico no escopo; falta a reflexão em tempo de execução de uniões nicho, que ainda lê a tag no offset 0]; (3) borrow checker.
      O stage0 só parseia a sintaxe nova; o djinnc impõe as regras.
- [ ] Aritmética de ponteiros definida na linguagem, só em `unsafe`: `p + n` em unidades do elemento, `p - q` entre ponteiros do
      mesmo tipo devolvendo `isize` (hoje não compila: "invalid types for binary expression"), `offset_of`/`align_of`.
- [ ] Mutabilidade do apontado: hoje `mut` só vale para a variável (`mut ptr<i8> p` pode ser reatribuída) e escrever em `*p` ou `p[i]` é sempre permitido. Decidir `ptr<mut T>` (apontado imutável por padrão, `mut` opt-in, coerente com o resto da linguagem) para o `T*` seguro, junto do `readonly`/`noalias` e do borrow checker; o `ptr<T>` cru continua escrevível dentro de `unsafe` (FFI, `malloc`). Os parsers ainda não aceitam `mut` dentro de `<...>`.
- [~] Remover os `(i8*)` e `(i64)` de endereço do djinnc (os `(i8*)` já viraram `ptr<i8>`; faltam os `(i64)` de endereço em `ast/node/ast.djinn`, que passarão a usar `nint`/`isize`) (`ast/node.djinn`, `support/arena.djinn`, `support/atoms.djinn`)
      quando a sintaxe existir; registrar a mudança no `SUBSET.md`.

## TODO — Framework de testes nativo

- [ ] `SelfTest` (`djinnc/src/driver/selftest.djinn`) é um runner escrito à mão (`check(bool, nome)` + `printf`). Deve virar
      um framework de testes nativo da linguagem: atributo `[Test]` em funções/métodos, descoberta automática pelo
      compilador, `Assert.equal/true/false/null/throws`, fixtures com setup/teardown, filtro por nome
      (`djinnc --test --filter U32Map.*`), relatório com contagem, tempo por teste e saída em stderr/JUnit XML,
      exit code diferente de zero em falha. Os testes ficam ao lado do código (`*_test.djinn`) e não entram no binário
      de release. Substitui o `--selftest` e permite rodar `tests/djinnc/samples` pelo mesmo runner.
- [ ] Testes do stage0 (gtest) levam ~6 s cada porque cada um compila o std inteiro e linka com clang; ver o TODO de
      performance: cache do std compilado, IR sem link para testes de front-end e execução em paralelo.

## Bugs do stage0 encontrados na Fase 4 (corrigidos)

- [x] Operandos `u32` eram estendidos com `sext` e comparados com predicados com sinal, então `u32 == 4294967295` dava
      falso. O binder agora grava `leftSigned`/`rightSigned` em `BinaryExpression` (literais adotam o sinal do outro
      operando) e o gerador usa `zext` e `icmp u*` quando os operandos são sem sinal. Testes em
      `tests/types/unsigned_compare.cpp`.
- [x] O sintoma de out-param (`map.f(&v) && v == 8642`) tinha a mesma causa, a comparação com sinal. A escrita via
      endereço de local funciona (verificado com o local mutável e imutável).
- [x] `Node* == Node*` entre campo de struct e variável local dentro de um namespace falhava porque o tipo do campo
      voltava sem normalizar (`Node` contra `ns::Node`). `bindFieldAccess` agora normaliza o tipo do campo. Teste em
      `tests/types/pointer_field_namespace.cpp`.
- [x] Contornos revisados: não há mais casts para `void*` em comparações de `Node*`. `U32Map.find` continua devolvendo `i64` (-1 = ausente) de propósito, pois um sentinela `u32` colidiria com valores válidos.

## TODO — Falhas conhecidas da suíte do stage0

- [x] `NonZero.RejectsCastOfZeroLiteral` e `NonZero.RejectsSuffixOnFloatType`: o erro era emitido duas vezes
      (o `CompileError` não levava a localização, então o dedupe do `DiagnosticEngine` não reconhecia a cópia) e a posição vinha como `line: 0` (o cast usava a localização zerada do tipo). `PARSER_ERROR`/`PARSER_WARNING` agora passam a localização, o cast usa o `(`, e `f32n a = 1.5;` é rejeitado como declaração local.
- [x] `NonZero.DivisionByConstantSkipsZeroCheck`: o teste dividia dois literais, que o `IRBuilder` dobra sem emitir `sdiv`; agora usa um parâmetro como dividendo.
- [x] `float + literal double` abortava no LLVM (operandos de tipos diferentes); o literal agora adota o tipo do outro
      operando em `BinaryExpression`.
- [x] `Node* p = &a;` com `a` declarado como `Node a = { ... }` gerava ponteiro contra struct na comparação `==`: o binder dava a `&a` o tipo de `a` e a `*p` o tipo de `p`. `bindUnaryExpression` agora tipa `&x` como `T*` e `*p` como o elemento. Implementado, ainda não compilado nem testado; testes em `tests/types/address_of_pointer.cpp`.
- [ ] `get_type_name_for_value` ainda é a fonte dos nomes de TypeInfo para inteiros, floats e `ptr`; só o caso `unknown` consulta `type_of`. Migrar o resto muda nomes de TypeInfo e precisa dos testes de boxing e `typeof` rodando.

## TODO — Sintaxe do self-compiler (Fase 7 antecipada)

O djinnc só compila o subset de `djinnc/SUBSET.md`. Falta, em ordem de dependência (cada item com sample em
`tests/djinnc/samples` e linha no `SUBSET.md`; o fonte do djinnc só passa a usar a construção depois que o stage1 a compila):

1. [~] **Enums simples e `==`/`!=` em enums**: feito no djinnc (samples `enums`, `enum_methods`, `enum_is`). `NodeKind`/`TokenKind` já são `enum` no fonte (`ast/node/node_kind.djinn`, `lexer/token_kind.djinn`); cada enum é um tipo próprio (`==` só entre o mesmo enum, o resto via `getValue()`), e `switch` aceita o braço `_` (samples `enum_value`, `enum_switch_wildcard`, erro `enum_cross_compare`).
2. [x] **`switch`** sobre enums e inteiros (statement e expressão), com checagem de exaustividade (sample `switch`).
3. [x] **Structs por valor**: parâmetros, retornos, atribuição e inicializador `{ campo: valor }` (samples `struct_values`, `typed_struct_init`).
4. [~] **`for x in range`** feito (`[a..b]`, `[a..b)`, `a..b`, `a..=b`, lowering no parser); `auto` e início aberto `(a..b]` implementados (sample `range_open_start`, ainda não compilado nem testado). Argumentos nomeados em chamadas e construtores também feitos (`Point(y: 4, x: 3)`).
5. [x] **`string` e interpolação**: tipo `string` e `operator +` em `runtime/core/`, literais `$"...{expr}..."` (estilo C#, `{{`/`}}` escapam) viram `INTERP_*` no lexer e um builder em Djinn (`__djinn_text_*`) em `runtime/core/`, com limites u32 checados; formatação `{x:-08.2}` (largura, alinhamento, zeros, precisão) implementada (sample `interp_format`, ainda não compilado nem testado); falta `str`/`string` em mais operadores.
6. [x] **Genéricos** (structs, enums, funções e métodos, com monomorfização sob demanda e inferência de argumentos; samples `generics`, `generic_*`): base para `array<T>`, `map<K,V>`, `optional<T>`. O fonte do djinnc ainda não usa genéricos.
7. [x] **`impl`/interfaces** e constraints (`where T : Comparable<T>`, interfaces genéricas, `impl` em primitivos; samples `interfaces`, `generic_interfaces`, `impl_many_types`, `primitive_methods`).
8. [~] **`async`/`await`/`spawn`** feitos (lowering para corrotinas LLVM, `task<T>`, `async main`; samples `async_basic`, `async_main`). **`try`/`throws`/`ensure`/`require`** não: o parser recusa com "throws and contracts are not supported yet" e `SUBSET.md` os mantém proibidos.
9. [~] Enums tagged (ADT), macros, `constexpr`/`consteval`, atributos, ownership (move) e reflexão feitos (samples `tagged_enums`, `macros`, `constexpr*`, `attributes`, `ownership`, `reflection`). Destructuring e closures seguem de fora.
10. [~] Compilar `std/` com o djinnc e reativar `libs: ['std']` (critério de saída da Fase 7): `--std`, `import`, alias de tipo e substituição dos tipos do core implementados; ver `STD_ROADMAP.md` (ainda não compilado nem testado).

## Status: `var`/`auto`, impl em primitivos e README

- [x] `var` e `auto` são sinônimos (atom pré-internado + `TypeRef`); stage0 e djinnc.
- [x] `impl Iface for <primitivo>` e `impl <primitivo>`, chamada `x.hash()` e restrições `where K : Hashable` para argumentos primitivos (`tests/djinnc/samples/primitive_methods.djinn`). `impl A for X, Y` (vários tipos) ainda não.
- Exemplos do README que o djinnc ainda não compila: `printf` sem `extern` (std), `consteval/constexpr`, `optional/result` da std (enum genérico com payload gera 'type 0 has no code generation').
