# Djinn — Arquitetura de Garantias, Contratos e Segurança

**Status:** proposta técnica, rascunho para discussão. Nada aqui está implementado, salvo onde marcado **[existe]**.
**Escopo:** apenas `djinnc` (o compilador self-hosted). O compilador C++ (stage0) está obsoleto e nenhuma parte desta
proposta o toca.
**Origem:** consolida (a) o rascunho `djinn-semantic-concurrency-transactions-uow.md`, (b) o pedido de arquitetura de
garantias para sistemas externos, (c) a implementação antiga em C++ do branch `feature/exceptions` (usada só como
referência de semântica e de casos de teste, ver [Apêndice D](#apêndice-d--o-que-foi-absorvido-do-branch-featureexceptions))
e (d) o issue #55 (captura de erro em `extern "C"`, [Apêndice A](#apêndice-a--issue-55-captura-de-erro-em-extern-c)).

**Marcadores:** **[existe]** já está em `master`; **[proposto]** é o desenho recomendado; **[experimental]** só vale a
pena depois de validar o resto; **[evitar]** não deve ser feito no horizonte previsto.

## Como ler este documento

| Pedido (seção) | Onde está |
|---|---|
| A. Fundamentos e objetivos | §1, §2, §5.1 |
| B. Sistema de garantias | §5 |
| C. Recursos e capacidades | §4.2, §6 |
| D. Sistema de transações | §7 (capítulo dedicado, com resumo e veredito de viabilidade no fim) |
| E. Estados e transições | §4.3 |
| F. Efeitos colaterais | §4.4 |
| G. Runtime e compilador | §3, §9 |
| H. Exemplos práticos | §8 |
| I. Problemas e limitações | §11 |
| J. Comparação | §10 |
| K. Estratégia de implementação | §12 |
| Resumo executivo / recomendações finais | §1 / §13 |

---

## 1. Resumo executivo

### 1.1 Tese

O Design by Contract clássico (`require`/`ensure`/`invariant`) diz o que é verdade sobre **valores**. Em programas reais
os incidentes vêm de outra classe de problema: operações sobre **recursos que o programa não controla** (arquivos,
bancos, redes, hardware) e sobre **memória compartilhada**, onde o que importa é *quem sustenta a garantia*.

A proposta é que toda garantia no Djinn carregue sua **proveniência**: foi provada pelo compilador, imposta pelo
runtime do Djinn, delegada a um sistema externo identificado, verificada dinamicamente ou é apenas de melhor esforço.
O compilador **recusa** uma promessa que nenhuma dessas fontes sustenta, em vez de aceitá-la em silêncio.

### 1.2 Decisões centrais

1. **Cinco camadas com responsabilidades separadas** (§3): especificação, recursos e estados (tipos), Verification IR
   com verificador estático, protocolo de runtime e providers (adapters). A "State Machine" proposta no pedido deixa de
   ser camada própria e vira propriedade de tipos de recurso (typestate) mais um auxiliar de runtime para estados
   persistidos.
2. **Cinco categorias de garantia** (§5): `proved`, `enforced`, `checked`, `delegated`, `best_effort`. Cada
   `Obligation` do compilador carrega categoria, provedor e evidência.
3. **Erros são valores** **[existe]**. O record `{ i32 tag, payload }` de `throws`/`try`/`switch` é o único canal de
   falha recuperável. Não há exceções reais nem unwinding. Violação de `require`/`ensure` em modo `check` é **trap com
   diagnóstico** por padrão; só vira valor quando a função declara `throws(ContractViolation)`.
4. **Motor transacional incremental** (§7): começa em atomicidade em memória contra falhas (viável agora, resolve
   estado parcial depois de um `try`) e cresce por estratégias. STM, transações distribuídas e escolha automática de
   estratégia para sistemas externos ficam fora do horizonte.
5. **Sistemas externos entram por providers** (§6). O compilador verifica *requisitos × declaração do provider*. A
   verdade da declaração é validada por testes de conformance do provider e por handshake em runtime, nunca assumida
   como prova.
6. **Poucas palavras-chave novas.** `require` e `ensure` já existem como tokens. O resto da v1 usa atributos `[...]`
   **[existe]**, tipos genéricos e bibliotecas. Uma construção nova só entra com justificativa (§4.3, §7.2).
7. **Honestidade sobre o que é novo** (§10): quase todo ingrediente existe em outra linguagem. O que pode valer a pena é
   a integração em um único relatório de obrigações com proveniência, voltado a agentes de código.

### 1.3 Veredito de viabilidade por componente

| Componente | Veredito | Observação |
|---|---|---|
| `require`/`ensure` em modo `check` com trap | Viável agora | Parser rejeita hoje com "contracts are not supported yet" |
| Inferência de effects, `extern` = `unknown` | Viável (médio) | Fixpoint no grafo de chamadas; `.djlib` exige effects explícitos na API pública |
| Atomicidade em memória com rollback automático | Viável agora | Base: caminhos de saída de erro e `Ownership` existentes |
| Estratégia `cooperative` (sem suspensão na região) | Viável agora | Custo zero; condicional ao scheduler de uma thread |
| Typestate por tipos genéricos + move | Viável (médio) | Sem keyword nova na v1 |
| Locks assíncronos pertencentes à task, com ordering | Viável com runtime novo | Só necessário quando o pool executar coroutines |
| Providers com garantias declaradas | Viável como convenção de biblioteca | Garantia sempre condicional ao provider |
| Estratégia `database` | Viável só via provider | ACID `delegated`, nunca `proved` |
| Prova de propriedades gerais (SMT) | Experimental | Fragmento afim próprio primeiro |
| STM, 2PC, sagas na linguagem, polimorfismo de effects | Evitar no horizonte | Ver §12.5 |

---

## 2. Problemas que a arquitetura pretende resolver

A coluna "Alcance" usa quatro níveis: **elimina** (a classe de erro deixa de ser expressável), **detecta** (diagnóstico
em compilação ou em execução), **mitiga** (reduz janela ou probabilidade) e **fora de alcance**. Toda entrada é
**condicional** às premissas da última coluna; não há garantia absoluta fora do que o compilador prova sobre o próprio
programa.

| Problema | Alcance | Mecanismo | Premissa / limite |
|---|---|---|---|
| TOCTOU em recursos do SO | **Fora de escopo**: uma biblioteca futura trata do filesystem; o compilador não aplica nada | (ideia original: API só expõe handles (fd, `openat`, diretório como capability); path vira handle uma vez | O SO precisa oferecer a primitiva (`openat`, `O_NOFOLLOW`, `FILE_FLAG_OPEN_REPARSE_POINT`); diretório pai sob controle do atacante ainda permite troca de nomes) |
| Data race em memória | Detecta (best-effort) no IR; elimina só sob premissa de runtime | `shared`/`exclusive` no IR; estratégia `cooperative` | Hoje coroutines rodam em uma thread; com threads exige capabilities no tipo (v2) |
| Business race (check-then-act) | Detecta | Validação e escrita dentro da mesma região atômica; update guardado | Só vale dentro do processo; entre processos depende do sistema externo |
| Deadlock | Detecta ciclos de `ordering` declarados; elimina em locks que o runtime adquire ordenados | Grafo de ordem + aquisição ordenada | Não alcança locks de banco nem de outros processos |
| Estado desatualizado | Detecta no commit | Versão (`Versioned`), lease com fencing token | Exige que o sistema externo compare a versão atomicamente |
| Validação obsoleta | Elimina quando a validação vai para dentro da região | Predicado guardado (`WHERE saldo >= :v`) ou região atômica | É o TOCTOU lógico |
| Acesso concorrente incompatível | Detecta | `shared`/`exclusive` por recurso | Best-effort: sem análise de aliasing completa (§5.5) |
| Uso de recurso invalidado | Elimina para handles lineares; detecta o resto | Handle afim consumido por `close`; `Disposable` **[existe]** | Invalidação externa (fd fechado por outro código) é só `checked` |
| Falhas parciais | Elimina em memória (rollback automático); mitiga externas | Undo log / snapshot; saga com pivot | Rollback externo depende de compensação, que pode falhar |
| Efeitos colaterais inesperados | Detecta | Sistema de effects com claims auditadas | `extern` sem declaração é `unknown` |
| Duplicação de operação | Mitiga | Chave de idempotência + inbox | O compilador verifica o protocolo, não a unicidade real |
| Idempotência | Detecta uso inseguro de retry | Effect `idempotent` declarado como claim | Claim sobre código externo é confiança, não prova |
| Inconsistência transacional | Delegada | Provider com isolamento declarado | Sustentada pelo banco, não pelo compilador |
| Falha de rollback | Detecta e expõe | Rollback em memória é determinístico; compensação falha vira estado `Stuck` | Nunca eliminada: fora do processo não há garantia de que desfazer funcione |
| Perda de sincronização entre sistemas | Fora de alcance (mitigada por reconciliação) | Estado `Unknown` obrigatório + consulta por chave | Exige que o sistema externo permita consulta |
| Violação de invariantes | Prova no fragmento afim; checa o resto | `invariant` em `prove`/`check` | Invariantes que cruzam sistemas ficam fora |
| Permissão revogada | Detecta no ponto de uso | Checar usando a própria syscall como verificação | A janela entre a checagem e o uso só some se a operação for atômica no SO |
| Identidade × identificador | Elimina por tipo quando a API permite | `Handle` ≠ `Path`; id estável + versão | Nomes reutilizados (inode, número de conta) exigem versão ou geração |

---

## 3. Arquitetura proposta

### 3.1 Avaliação das cinco camadas do pedido

| Camada do pedido | Avaliação | Ajuste |
|---|---|---|
| Static Verification | Adequada, mas precisa de uma representação comum | Vira **Verification IR** + verificador |
| Resource System | Adequada | Absorve a State Machine (typestate) |
| State Machine | **Não é camada**: é propriedade de um recurso (tipo) mais dado persistido | Typestate no sistema de tipos; tabela de transições como auxiliar de runtime |
| Execution Runtime | Adequada, mas deve ser fina e opcional | Perfis `none`/`core`/`full` (§3.5) |
| External Adapters | Adequada | Renomeada **Providers**, com garantias declaradas |
| (ausente) | Falta onde o programador declara | **Especificação**: contratos, effects, claims |
| (ausente) | Falta um relatório | Saída transversal: `--obligations` e diagnósticos |

### 3.2 Camadas finais

```text
 L0  Linguagem base                [existe] tipos, ownership, borrow, throws/try, unsafe, async, atributos
 L1  Especificação                 require/ensure/invariant, reads/writes, effects, claims, atomic
 L2  Recursos e estados (tipos)    Handle<T>, Lease<T>, Versioned<T>, typestate por genéricos + move
 L3  Verification IR + verificador Obligation{kind, status, provedor, evidência}; fatos afins; ordering graph
 L4  Protocolo de runtime          trap, undo log/snapshot, lock assíncrono ordenado, retry limitado
 L5  Providers                     fs, banco, rede, SO, hardware: declaram o que sustentam
          \________ relatório: obrigações por categoria, diagnósticos legíveis por máquina ________/
```

| Camada | Responsabilidade | Não é responsabilidade |
|---|---|---|
| L1 | Declarar o que precisa ser verdade e o que a operação toca | Escolher mutex, STM ou SQL |
| L2 | Impedir usos inválidos por tipo (use-after-close, transição fora de ordem) | Provar aritmética |
| L3 | Provar o que é decidível, classificar o resto, recusar o que nenhuma fonte sustenta | Executar nada |
| L4 | Impor protocolos que o compilador não consegue provar | Prometer atomicidade de sistemas externos |
| L5 | Traduzir para o mecanismo real (fd, SQL, socket) e **declarar** suas garantias | Estar correto por decreto: a declaração é testada, não presumida |

### 3.3 Onde isso entra no pipeline de `djinnc`

O pipeline atual **[existe]** é: lexer, parser (`parser/parser_*.djinn`), `semantic/analyzer`, `semantic/checker`,
`codegen`. Proposta:

```text
 lexer → parser → semantic analyzer → type checker → [verify: novo] → codegen → LLVM
                      │                    │               │            │
                  FunctionInfo       ownership/borrow   Obligations   rollback, traps,
                  (+ spec, effects)  throws check       IR + report   locks, wrappers
```

Pontos de integração concretos:

- `parser/parser_declarations.djinn`: hoje rejeita `require`/`ensure` logo depois de `parse_throws_clause` com "contracts
  are not supported yet". A mudança é aceitar as cláusulas e guardá-las na declaração.
- `semantic/symbols/function_info.djinn`: ganha os campos de especificação, effects inferidos e claims.
- Novo diretório `semantic/verify/` com Verification IR, fatos afins e inferência de effects. Roda depois do type
  checker, porque precisa de tipos resolvidos e do grafo de chamadas.
- `codegen`: rollback automático nos caminhos de saída de erro (`codegen/code_generator_error_exit.djinn` e
  `code_generator_error_propagation.djinn`), traps de contrato e o wrapper de atomicidade.
- Fronteira `.djlib` (`djinnc/LIBRARY.md`): a interface é o fonte minificado com corpos removidos. Cláusulas na
  assinatura (`require`, `ensure`, effects, claims) sobrevivem; **o que for inferido do corpo não sobrevive**. Logo, a
  API pública de uma biblioteca precisa declarar effects explicitamente, e a compilação da própria biblioteca audita a
  claim contra o corpo (§4.4).

### 3.4 Alternativas consideradas

| Alternativa | Por que não |
|---|---|
| Tudo no sistema de tipos (estilo Rust/Pony) | Prova de ausência de data races exige análise de aliasing e capabilities em todo o tipo; custo de linguagem alto e não cobre sistemas externos |
| Tudo em runtime (monitores, asserts) | Descobre tarde, custa desempenho e não ajuda agentes a corrigir antes de executar |
| SMT geral como base | Falsos negativos "unknown" frequentes, tempo imprevisível; melhor como backend opcional sobre um fragmento afim |
| Uma construção única `transaction` | Mistura rollback em memória, banco e efeito externo irreversível, que têm garantias diferentes |
| Atribuir garantias ao compilador "por padrão" | Viola a regra de não prometer o que depende de SO ou serviço externo |

Decisão: arquitetura **híbrida**, com verificação estática no que é decidível, protocolo mínimo de runtime no que não
é, e delegação explícita no que pertence a outro sistema.

### 3.5 O runtime é obrigatório?

Não. Perfis, em ordem de custo:

| Perfil | Conteúdo | Para quem |
|---|---|---|
| `none` | Só `proved`, `assume` e `ignore`; `check` vira trap mínimo (`abort` ou handler do usuário) | Embarcado, kernel, `no_std` |
| `core` | Trap com diagnóstico, undo log/snapshot, retry limitado | Aplicações comuns |
| `full` | `core` mais locks assíncronos ordenados e adapters | Serviços |

O custo é pago só por quem usa: sem cláusulas `check` e sem regiões atômicas o código gerado é idêntico ao de hoje. O
runtime C atual já é linkado por completo (`runtime/*.c`, com `scheduler.c`, `threads.c`), então o perfil `none` exige
separar o que é opcional (a validar: ver §11).

### 3.6 Nome: "contrato" já está ocupado

Em `djinnc`, `StructInfo.contracts` e `InterfaceInfo` designam **interfaces** (por exemplo `Disposable`,
`semantic/symbols/ownership.djinn:15`). Chamar `require`/`ensure` de "contrato" cria ambiguidade em diagnósticos e na
documentação. Recomendação: no código e nos diagnósticos, chamar o conjunto de cláusulas de **especificação**
(*spec*); manter "contrato" apenas como o termo coloquial deste documento. **Decisão pendente** (Apêndice C).

---

## 4. Modelo conceitual

### 4.1 Obrigação (`Obligation`): a unidade do sistema

Toda cláusula, claim ou protocolo que o autor escreve vira uma obrigação que o verificador precisa classificar.

```text
Obligation {
    kind      Require | Ensure | Invariant | Effect | Access | Atomic | Ordering | Retry | Protocol | Provider
    subject   função, região, tipo ou recurso, com localização
    mode      prove | check | assume(motivo) | ignore          escolha explícita do autor
    status    Proved | Enforced | Checked | Delegated | BestEffort | Unverified
    provider  nenhum | runtime(perfil) | nome e versão declarados de um provider
    evidence  regra do verificador | ponto do runtime | referência à declaração do provider
}
```

Relação entre `mode` e `status`:

| `mode` escolhido | Resultado possível | Comportamento |
|---|---|---|
| `prove` | `Proved` ou erro de compilação | Não emite código. Se não consegue provar, o programa não compila |
| `check` (padrão) | `Proved` (check elidido) ou `Checked` (check emitido) | Tenta provar; o que não prova vira trap em execução |
| `assume("motivo")` | `BestEffort` ou `Delegated` | Aceito sem prova, **com justificativa obrigatória**, listado no relatório |
| `ignore` | nenhum | Descartado, mas listado no relatório |

Escolhi `check` como padrão (em vez de "ghost por padrão" da especificação antiga) porque o padrão tem de falhar de
forma segura: um contrato escrito e nunca verificado é pior que nenhum, pois dá falsa segurança. Quando o verificador
prova a cláusula, o check some, então o custo é pago só pelo que não se consegue provar. Um perfil de build pode
trocar `check` por `ignore` em `ensure`, com o relatório indicando quantas obrigações ficaram sem verificação.

Regras de expressão: cláusulas são **puras** (sem efeitos além de leitura e sem chamadas). O atributo `[Pure]`
**[implementado]** e agora é **verificado** (E3057): uma função `[Pure]` só escreve em variáveis locais (e campos de
structs locais), nunca por ponteiro, índice ou global, e só chama funções `[Pure]` (inclusive `extern` marcado
`[Pure]` e funções vindas de `.djlib`). Ele continua virando `memory(read)` no LLVM. É a base de pureza para chamadas
dentro de cláusulas; a inferência de effects (§4.4) generaliza a mesma regra.
`old(caminho)` captura o valor de entrada e só aceita tipos `TRIVIAL` (copiáveis por bytes), para não ter custo
escondido.

### 4.2 Recursos e capacidades

Vocabulário e como cada conceito se mapeia ao que `djinnc` já tem:

| Conceito | Papel | Situação |
|---|---|---|
| Ownership | Quem destrói o recurso | **[existe]** `Ownership.traits` classifica `TRIVIAL`/`VALUE`/`DISPOSABLE`/`NEEDS_DISPOSE` |
| Borrowing | Acesso temporário sem posse | **[existe]** `semantic/symbols/borrow.djinn` |
| Handle | Valor afim que representa **uma instância aberta** de um recurso | **[proposto]** `Handle<R>`; fechar é consumi-lo |
| Capability | Handle de **autoridade**, não de recurso (um diretório aberto, um endpoint) | **[proposto]** só se obtém por entrada do programa ou por derivação (`dir.open(nome)`) |
| Lifetime | Escopo do handle dentro do processo | **[existe]** escopo e `Disposable` |
| Lease | Direito de uso com prazo, sobre recurso externo | **[proposto]** `Lease<T>` com `fencing token` |
| Versão | Distingue o estado visto do estado atual | **[proposto]** `Versioned<T>` |

**O compilador deveria conhecer identidade e validade?** Resposta por tipo de conhecimento:

- **Identidade de recurso em processo: sim**, por tipo. `Handle<File>` é uma identidade; `Path` é um *identificador*
  que pode apontar para outro arquivo no instante seguinte. Tipos distintos impedem confundir os dois.
- **Validade em processo: sim, estática.** Handle afim consumido por `close` torna *use-after-close* um erro de
  compilação (mesmo mecanismo de move que já impede uso após `dispose`).
- **Validade do recurso externo: não.** Um fd pode ser invalidado por outro código, o arquivo pode ser removido, a
  conexão pode cair. Essas operações retornam `throws` (por exemplo `StaleHandle`) e a garantia é só `checked`.
- **Identidade de recurso externo (qual inode, qual linha): não.** Só dá para exigir versão ou geração e deixar o
  sistema externo comparar.

**Como evitar TOCTOU (fora de escopo do compilador; fica para uma biblioteca de filesystem futura):** a regra é *decidir e agir sobre o mesmo handle, na mesma operação*. Em prática:

1. O std oferece operações destrutivas apenas relativas a uma capability (`Dir.remove(nome)`), e `open` com
   `O_NOFOLLOW`/`FILE_FLAG_OPEN_REPARSE_POINT` como padrão seguro.
2. APIs por path ficam disponíveis, marcadas com effect e com aviso de TOCTOU (aviso, não erro, por usabilidade).
3. Padrão `check-then-act` sobre um *identificador* na mesma função, sem região atômica, gera diagnóstico heurístico
   (`W-RACE-xxx`). É uma heurística: tem falsos positivos e falsos negativos (§11).

**Lease não basta.** Um lease com prazo não protege contra o dono que pausa (GC, swap, rede) e continua agindo depois
de expirar. Só vale com *fencing token* monotônico verificado pelo recurso. Se o recurso não verifica o token, o lease é
`best_effort` e o relatório precisa dizer isso.

**Pré-requisito descoberto na leitura do código:** `Ownership.derive` classifica como `TRIVIAL` (copiável) qualquer
struct cujos campos sejam todos triviais e que não implemente `Disposable`
(`semantic/symbols/ownership.djinn:39-69`). Um `struct Transfer { i64 id; }` seria copiado em silêncio, e a versão
antiga continuaria utilizável depois de uma transição. Typestate e handles afins precisam de um jeito de declarar um
tipo *move-only* sem recurso associado (por exemplo um atributo `[MoveOnly]` ou tornar `VALUE` explícito).

### 4.3 Estados e transições

**Decisão: sem palavra-chave `state` na v1.** Dois casos distintos, com dois mecanismos.

**(a) Estado dentro do processo: typestate por genéricos e move**, sem sintaxe nova:

```djinn
struct Transfer<S> { i64 id; i64 amount; }

Transfer<Reserved> reserve(Transfer<Created> t) throws(ReserveFailed);
Transfer<Submitted> submit(Transfer<Reserved> t) throws(SubmitFailed, Unknown);
Transfer<Settled> settle(Transfer<Submitted> t);
```

O tipo de entrada é consumido; `reserve` só aceita `Transfer<Created>`; chamar `settle` direto sobre `Created` é erro
de tipo. Depende do pré-requisito move-only da §4.2. Custo de desempenho: nenhum (apagado na compilação).

**(b) Estado persistido (linha de banco, mensagem): enum mais tabela de transições**, porque o estado vive fora do
processo e muda por outros agentes. A tabela é dado verificável:

```djinn
enum TransferState { Created, Reserved, Submitted, Settled, Failed, Unknown }

[Transitions(
    Created   -> Reserved, Failed,
    Reserved  -> Submitted, Failed,
    Submitted -> Settled, Failed, Unknown,
    Unknown   -> Settled, Failed
)]
```

O compilador verifica sobre a tabela (grafo pequeno, custo polinomial):

- toda transição escrita com alvo literal pertence à tabela;
- não há estado não terminal sem saída (becos);
- todo estado alcançável é alcançável a partir do inicial;
- **todo `Unknown` tem transição de resolução** (`Unknown -> Settled | Failed`) e só ela o deixa;
- para estado persistido, a mudança é emitida como *update guardado* `WHERE state = :de`, e `0 linhas afetadas` é um
  erro tratado (outro agente mudou o estado).

**Falhas e resultados desconhecidos.** `Failed` é falha *definitiva* (o sistema externo confirma que não aconteceu).
`Unknown` significa *não sei se aconteceu* (timeout depois de enviar). `Unknown` carrega a chave de idempotência e só
sai por uma operação de *reconciliação* que consulta o sistema externo. Misturar os dois é a origem típica de cobrança
duplicada e de dinheiro perdido.

**Invariantes por estado** (por exemplo, `Settled` exige `ledger_id != 0`) são `invariant` checados na transição.

**Model checking.** Explosão de estados é o risco clássico. Proposta: o compilador só explora o grafo **de cada
máquina isoladamente**, nunca o produto de máquinas e threads do programa inteiro. Verificação de propriedades
temporais sobre o sistema completo (TLA+, SPIN) é ferramenta externa **[experimental]**, alimentada pela tabela
exportada.

### 4.4 Efeitos

**Vocabulário** (conjunto fechado; alargar é decisão de linguagem):

```text
pure | reads(R) | writes(R) | alloc | fs_read | fs_write | net | db | time | random | process | thread
irreversible     efeito externo que não pode ser desfeito (pagamento liquidado, e-mail enviado)
unknown          o conjunto de todos os efeitos
```

Propriedades derivadas: `retry_safe` (nenhum efeito `irreversible` nem não idempotente) e `idempotent` (claim do
autor, nunca inferida).

**Inferência.** Os efeitos de uma função são a união dos efeitos do corpo e dos de seus chamados, resolvidos por
ponto fixo sobre os componentes fortemente conexos do grafo de chamadas.

| Caso | Tratamento |
|---|---|
| Chamada direta | União com os efeitos do chamado |
| Recursão | Ponto fixo no componente conexo |
| Interface / método virtual | União dos implementadores conhecidos, senão `unknown` |
| Ponteiro de função | `unknown` (o tipo de função não carrega effects na v1) |
| Genéricos | Efeitos calculados após instanciar (instâncias já são emitidas pelo consumidor) |
| `extern "C"` | `unknown`, salvo declaração `[Effects(...)]` |
| Bloco/função `unsafe` | Escrita em endereço desconhecido: `writes(unknown)` |

**Propagação e restrição.** O chamador sempre herda os efeitos do chamado. Para restringir:

- cláusula `effects(...)` na função fixa o teto: efeito inferido fora do teto é erro (claim contra inferência);
- uma região `atomic` ou um `uow` proíbe `irreversible`/`net`/`process` dentro da janela de retry; o efeito vai para
  `after_commit` ou para o pivô (§7.8);
- política de módulo, por atributo no namespace: `[Forbid(net, process)]` para sandboxing de código gerado por agente.

**Explícito nas fronteiras.** A interface de uma `.djlib` tem os corpos removidos, então o que seria inferido some. A
regra é: na API pública de uma biblioteca, effects são **declarados**, e a compilação da biblioteca verifica
`inferido ⊆ declarado`. O consumidor confia na declaração e o relatório lista essa confiança como `Delegated`. Para
`extern`, a declaração é pura confiança (nada a verificar no corpo).

**Fora da v1: polimorfismo de effects.** Linguagens como Koka e Unison o têm, mas custam muito em tipos e mensagens
de erro. Sem ele, código de ordem superior fica pessimista (`unknown`). É um custo aceito conscientemente.

---

## 5. Semântica das garantias

### 5.1 Fundamentos: o que a arquitetura entrega além de Design by Contract

DbC clássico: precondição e pós-condição sobre valores, checadas em execução (Eiffel, C++26) ou provadas em
fragmento restrito (Ada/SPARK, Dafny). O que esta proposta acrescenta, e o que **não** acrescenta:

| Acrescenta | Não acrescenta |
|---|---|
| Proveniência da garantia (quem sustenta) em cada obrigação | Prova de propriedades arbitrárias de programas |
| Recursos, estados e efeitos como parte do que se declara | Garantia sobre sistemas que o programa não controla |
| Regiões atômicas com rollback automático em memória | Atomicidade distribuída |
| Recusa de promessas sem fonte (`delegated` exige provider) | Ausência de data race comprovada (§5.4) |
| Relatório legível por máquina para o ciclo com agentes | Substituto de testes, fuzzing e revisão |

### 5.2 Taxonomia de garantias

| Categoria | Quem sustenta | Como falha | Custo | Exemplo |
|---|---|---|---|---|
| `proved` | O verificador, sobre o modelo do programa | Bug do compilador, ou premissa da TCB violada (§5.3) | Zero em execução | `ensure(a.balance == old(a.balance) - v)` provado por fatos afins |
| `enforced` | Protocolo de runtime que o compilador instala | Bug do runtime, ou contorno por `unsafe`/FFI | Proporcional ao protocolo | Rollback por undo log; aquisição ordenada de locks |
| `checked` | Verificação dinâmica no ponto de uso | A violação **ocorre** e é detectada: trap ou erro como valor | Um teste por execução | `require(amount > 0)` com `amount` vindo de entrada |
| `delegated` | Sistema externo, via provider que **declarou** a garantia | Provider mente, tem bug ou está mal configurado | Custo da operação externa | Isolamento `serializable` do banco; `rename` atômico do SO |
| `best_effort` | Heurística sem prova nem imposição | Falso negativo | Zero | `shared`/`exclusive` sem análise de aliasing completa |

`best_effort` **nunca entra na contagem de garantias** do relatório. Ele aparece em uma seção própria, para que ninguém
confunda aviso com prova.

### 5.3 Garantia absoluta × condicional

Não há garantia absoluta. Toda entrada acima é **condicional** à base confiável (TCB):

| Componente da TCB | Quem depende dele |
|---|---|
| Compilador `djinnc` (parser, checker, verificador, codegen) | `proved`, `enforced` |
| LLVM e linker | Todas |
| Runtime C e `std` | `enforced`, `checked` |
| Código `unsafe` e `extern "C"` | Todas: qualquer um pode violar invariantes de memória |
| Justificativas `assume` | As obrigações assumidas e tudo que dependia delas |
| Providers e o sistema externo | `delegated` |
| SO e hardware | Todas |

Regra de relatório: cada obrigação lista suas **premissas** (por exemplo "sem `unsafe` no escopo", "scheduler de uma
thread", "provider postgres 16 declarado serializable"). Mudar o runtime para múltiplas threads invalida as obrigações
`cooperative`, e o compilador deve apontar quais.

### 5.4 Demonstrável, dependente do runtime, dependente de terceiros

| Propriedade | Fonte | Detalhe |
|---|---|---|
| Aritmética linear em `require`/`ensure`/`invariant` | Matematicamente demonstrável | Fragmento afim próprio (a versão antiga já tinha); fora dele, `unknown` e vira `check` |
| `inferido ⊆ declarado` para effects, reads, writes | Demonstrável | Verificação de inclusão em conjuntos |
| Ciclos em `ordering` declarado | Demonstrável | Grafo sobre chaves declaradas |
| Protocolo de typestate, tabela de transições | Demonstrável | Tipos e grafo pequeno |
| Use-after-close de handle em código seguro | Demonstrável | Move e borrow |
| Rollback em memória, retry limitado, trap | Depende do runtime | Cópias e logs determinísticos |
| Isolamento cooperativo | Depende do runtime | Vale só com scheduler de uma thread executando coroutines |
| Ausência de data race entre threads | **Não demonstrável na v1** | Exige capabilities no tipo (Rust/Pony); fica para um documento v2 |
| Atomicidade/durabilidade de banco, `rename`, entrega de rede | Depende de terceiros | `delegated` |
| Semântica de registradores de dispositivo | Depende do hardware | Fora do que o compilador vê |

### 5.5 Como isso aparece na linguagem e no compilador

Na linguagem, as cláusulas vêm depois da assinatura (como no desenho anterior), usando os tokens `require`/`ensure`
**[existem no lexer]**:

```djinn
i64 withdraw(Account mut a, i64 amount) throws(InsufficientFunds)
    require(amount > 0)
    require(a.balance >= 0) in mode prove
    ensure(a.balance == old(a.balance) - amount)
    reads(a.balance)
    writes(a.balance)
{
    if (a.balance < amount) {
        throw InsufficientFunds { available = a.balance };
    }
    a.balance = a.balance - amount;
    return a.balance;
}
```

**Regra de ouro: `require` é bug do chamador; `throws` é falha esperada.** `amount > 0` é `require` (violá-lo é erro
de programação: trap). Saldo insuficiente é `throws(InsufficientFunds)` (acontece em operação correta: valor). Isso
evita que `ContractViolation` contamine todas as assinaturas.

No compilador: `FunctionInfo` carrega cláusulas, efeitos inferidos e declarados; o verificador produz `Obligation`s;
`--obligations` imprime:

```text
withdraw(Account, i64)
  require amount > 0              checked    elidido em 3 de 4 chamadores; 1 não decidível
  require a.balance >= 0          proved     fatos afins
  ensure  a.balance == old - amt  proved     fatos afins
  writes  a.balance               proved     claim == inferido
  premissas: sem unsafe no escopo
```

---

## 6. Integração com sistemas externos

### 6.1 Providers: declarar, verificar a declaração, impor

Um **provider** é um tipo da biblioteca que fala com um sistema externo e **declara** o que consegue sustentar:

```djinn
[Guarantees(atomic, isolation = serializable, durable)]
[Effects(db)]
struct PostgresSession { /* ... */ }
```

Fluxo de verificação, com o que cada etapa realmente prova:

| Etapa | O que verifica | O que não verifica |
|---|---|---|
| Compilação | A especificação (`isolation: serializable`) é satisfeita pela `[Guarantees]` do tipo usado | Que a declaração seja verdadeira |
| Teste de conformance do provider | O provider passa um kit de testes de comportamento (commit, rollback, isolamento, perda de conexão) contra o sistema real | Todas as versões e configurações do sistema |
| Handshake em execução | Configuração efetiva: `SHOW transaction_isolation`, `PRAGMA synchronous`, versão do servidor, suporte a `fsync` | O que acontece sob falha de energia |

Se o handshake discorda da declaração, o provider devolve `ProviderMismatch` como valor, e o relatório registra
**nome e versão** do provider contra a qual cada obrigação `delegated` foi declarada.

**Por que não confiar cegamente:** drivers e sistemas variam. MySQL com tabelas MyISAM não tem transação;
SQLite com `synchronous=OFF` não é durável; `fsync` pode ser ignorado por hardware ou virtualização; semântica de
`rename` muda em rede (NFS). A regra "não prometer o que não se sustenta" exige a sonda em execução.

### 6.2 Banco de dados

- **Geração de SQL segura por tipo:** o tipo `Sql` só é construído a partir de constantes de compilação (o
  `constexpr` do `djinnc` já dobra interpolação constante), e valores entram **apenas por parâmetros vinculados**.
  Concatenar texto não é expressável, então a injeção de SQL deixa de ser possível por construção no caminho seguro.
  Um escape (`Sql.unchecked`) existe e exige `unsafe`.
- **Update guardado:** o compilador traduz `require(a.balance >= v)` mais `writes(a.balance)` em
  `UPDATE ... SET balance = balance - :v WHERE id = :id AND balance >= :v` e **exige consumir o número de linhas
  afetadas** (resultado marcado como `must_use`). Isso transforma o check-then-act em uma única instrução do banco.
- **Isolamento** é uma exigência da especificação; o mapeamento para o nível do SGBD é do provider (§7.7).
- Resultado de `COMMIT` desconhecido (queda de conexão) é `Unknown` obrigatório, nunca `Ok` nem `Failed`.

### 6.3 Sistema de arquivos

| Necessidade | Primitiva do SO | O que Djinn pode garantir | Limite |
|---|---|---|---|
| Evitar TOCTOU | `openat`, `unlinkat`, `O_NOFOLLOW`; no Windows, handles com `FILE_FLAG_OPEN_REPARSE_POINT` | Tipos: só existe API relativa a `Dir` | Se o atacante controla o diretório pai, nomes ainda podem ser trocados |
| Escrita atômica | Arquivo temporário no mesmo diretório, `fsync`, `rename` | O protocolo é seguido (sequência obrigatória) | Atomicidade de `rename` é do SO e do sistema de arquivos |
| Durabilidade | `fsync` do arquivo e do diretório | Chamadas na ordem certa | Hardware ou virtualização podem mentir |
| Exclusão entre processos | `flock`/`LockFileEx` | Aquisição e liberação pareadas | Locks consultivos não impedem quem não cooperou |
| Integridade | Checksums | Verificação na leitura | Não detecta tudo |

### 6.4 Rede

| Problema | Resposta |
|---|---|
| Timeout | Resultado `Unknown`, nunca `Failed`, se a requisição pode ter sido entregue |
| Retransmissão | Só para operações `idempotent` ou com chave de idempotência; o compilador recusa retry de efeito `irreversible` sem isso |
| Entrega duplicada | Inbox com restrição de unicidade na chave da mensagem (§7.9) |
| Consistência entre serviços | Pivô e compensação (§7.8); reconciliação por consulta |
| Prazo | Deadline propagado como parâmetro (não timeout por chamada) |

O tipo de falha distingue `Failed` (definitiva) de `Unknown` (com token de reconciliação); ambos são tipos de erro no
`throws` **[existe como mecanismo]**.

### 6.5 Hardware e sistema operacional

- Acesso a registradores: `[Volatile]` **[existe]**; falta uma API de ordenação de memória (só há
  `__djinn_atomic_add`, usado para refcount).
- Posse de periférico: tipo singleton move-only; o compilador impede dois donos.
- Seções críticas contra interrupção: região `atomic` com estratégia `interrupt_off` **[experimental]**.
- Permissões e capabilities: delegadas ao SO; Djinn expõe a capability como valor (§4.2).
- **Limite:** o compilador não vê a semântica do dispositivo, nem DMA, nem a ordenação de memória do hardware.

### 6.6 Drivers, bibliotecas externas e `unsafe`

- `extern "C"` tem efeito `unknown` e **nenhuma** garantia por padrão.
- O caminho recomendado é um wrapper pequeno em Djinn que adiciona `[Effects(...)]`, captura erro (Apêndice A) e
  expõe um tipo handle. A declaração é confiança (`Delegated`), e o relatório a lista.
- Dentro de `unsafe`, escritas por ponteiro bruto tornam o write-set desconhecido. Uma região `atomic` que contém
  `unsafe` com escrita opaca é **erro**, salvo `assume("motivo")`.
- Bibliotecas nativas que lançam exceções C++ ou usam `longjmp` atravessando frames Djinn: fora de alcance (`djinnc`
  não emite unwinding, `code_generator_errors.djinn` documenta "no unwinding").

### 6.7 O que Djinn não promete

Entrega de mensagens em rede; durabilidade além do que `fsync` e o hardware dão; que um provider esteja correto;
ausência de data race entre threads (na v1); tempo real; que um pagamento liquidado possa ser desfeito.

---

## 7. Motor transacional

Este capítulo aprofunda a seção D do pedido. Cada componente é avaliado em cinco eixos: **viabilidade em `djinnc`
hoje**, **casos de borda**, **utilidade real**, **custo/desempenho** e **recomendação** (manter, simplificar, adiar,
descartar). No fim há uma tabela-síntese, um resumo e o veredito de viabilidade (§7.16, §7.17).

### 7.0 Duas classes de operação, com garantias diferentes

O erro de projeto mais comum é tratar tudo como "transação". Há três camadas, e cada uma dá um subconjunto de ACID:

| Camada | Atomicidade | Consistência | Isolamento | Durabilidade | Desfazer |
|---|---|---|---|---|---|
| Memória do processo | `enforced` (rollback automático) | `proved`/`checked` (invariantes) | `enforced` pela estratégia (`cooperative`, `lock`) | não se aplica | Sim, determinístico |
| Banco de dados | `delegated` | `delegated` + `checked` (constraints) | `delegated` (nível declarado) | `delegated` | Sim, até o commit |
| Operação externa irreversível (pagamento, e-mail, atuador) | não existe | não existe | não existe | do outro sistema | **Não**: só compensação (nova operação) |

Consequência: o compilador pode exigir **ordem** (o irreversível por último, no máximo um por fluxo) e **protocolo**
(chave de idempotência, tratamento de `Unknown`), mas nunca "desfazer" um efeito externo.

### 7.1 Fatos de `djinnc` que mudam a análise

Todos verificados no código de `master`:

- **Ownership.** `semantic/symbols/ownership.djinn` classifica tipos em `TRIVIAL`, `VALUE`, `DISPOSABLE` e
  `NEEDS_DISPOSE`. Snapshot por cópia de bytes só é correto para `TRIVIAL`. `VALUE` (string, array, map) exige cópia
  profunda ou log. `DISPOSABLE` **não pode** ser restaurado por cópia: haveria dispose duplo ou recurso já liberado.
- **Erros como valor.** `try` propaga por retorno antecipado. O bug mais comum que uma região atômica resolve **hoje,
  sem concorrência alguma**, é o estado parcialmente atualizado quando um `try` sai no meio da atualização. Os
  caminhos de saída de erro já existem (`codegen/code_generator_error_exit.djinn`,
  `code_generator_error_propagation.djinn`) e são o ponto natural do rollback automático.
- **Scheduler.** Em `djinnc`, uma função só é async quando declarada `async`
  (`semantic/analyzer/semantic_analyzer_functions.djinn:173,189`), embora o `README.md` e o `AGENTS.md` descrevam o
  codegen como "async por padrão": a documentação e o código divergem e este capítulo segue o código. Coroutines rodam na thread do event loop; o pool de 4 threads existe, mas nada o alimenta (`runtime/scheduler.c`;
  `djinnc/TEST_ROADMAP.md` confirma). Logo, hoje **não há data race entre código Djinn**, mas **há business race em
  todo `await`**, porque o intercalamento é cooperativo.
- **`await` em função síncrona.** Chama `__djinn_event_loop_run`, que executa outras tasks de dentro da função
  síncrona. Qualquer análise de "sem suspensão" precisa tratar `await` em qualquer chamado transitivo, inclusive
  síncrono, como ponto de intercalamento.
- **Sem closures** (`djinnc/SUBSET.md:55`). Blocos não podem ser passados a funções de biblioteca, o que justifica
  sintaxe própria para `atomic { }` e `after_commit { }`.
- **Colisão de nome:** "contract" designa interfaces em `djinnc` (§3.6).

### 7.2 Superfície: o que manter do desenho antigo

O branch `feature/exceptions` tinha **sete** construções de transação. A maioria é redundante com o que `djinnc` já
tem ou cria acoplamento:

| Construção antiga | Decisão | Motivo |
|---|---|---|
| `uow Name { ... }` (declaração) | **Adiar** | Uma especificação reutilizada por vários membros é conveniência; a v1 usa cláusulas na própria função |
| `uow (Name)` (anexo) | **Adiar** | Idem |
| `commit;` explícito | **Descartar** | O commit é o fim normal da região; um `commit` no meio cria janelas parciais e bugs (commit em laço, `return` pulando o resto) |
| `rollback;` explícito | **Descartar** | Rollback é automático em saída de erro; "abortar sem erro" é `throw` |
| `before_commit { }` | **Descartar** | É exatamente `ensure`/`invariant` verificado no fim da região |
| `after_commit { }` | **Manter** (única sintaxe nova com `atomic`) | Executa fora da janela de retry; sem closures não dá para ser biblioteca |
| `catch` como sufixo de função | **Descartar** | `djinnc` não tem `catch`; erros são valores (`try ?:`, `switch`) |
| `lock(a, b) { }` | **Substituir** por estratégia `lock` + API de biblioteca | Evita sintaxe para um mecanismo |

Superfície final recomendada:

```djinn
void transfer(Account mut from, Account mut to, i64 amount) throws(InsufficientFunds)
    require(amount > 0)
    writes(from.balance, to.balance)
    atomic strategy cooperative
{
    ...
}

void publish(Order mut o) throws(Rejected)
{
    atomic {
        try reserve(o);
    } after_commit {
        try notify(o);
    }
}
```

`atomic` aparece como cláusula de função (a função inteira é a região) ou como bloco (parte dela); os dois geram a
mesma região na IR. Variáveis declaradas na região ficam visíveis (somente leitura) em `after_commit`, e `old()` também. **Novas palavras contextuais: `atomic`, `strategy` e `after_commit`.** `uow` fica reservada.

### 7.3 Atomicidade em memória contra falhas (o MVP do motor)

**Semântica.** Na entrada da região, captura-se o conjunto de escrita (*write-set*). Em saída **normal**, descarta-se.
Em qualquer saída **por erro** (`try` propagando, `throw`), restaura-se na ordem inversa e devolve-se o erro.

**Write-set.** É a união declarada em `writes(...)` e inferida do corpo (as duas precisam coincidir: *claim contra
inferência*, §4.4). Como cada categoria de `Ownership` é tratada:

| Categoria do campo | Mecanismo | Custo |
|---|---|---|
| `TRIVIAL` (inteiros, structs de inteiros) | Snapshot em *stack slots* de tamanho conhecido em compilação | Uma cópia por campo; zero alocação |
| `VALUE` (string, array, map) | Só se o tipo implementar a interface `Restorable` (`snapshot()`/`restore()`), senão erro | Definido pelo tipo; array pode registrar só o tamanho e os elementos alterados |
| `DISPOSABLE`/`NEEDS_DISPOSE` | **Rejeitado** no write-set | Restaurar por cópia duplicaria o dispose |
| Escrita por ponteiro bruto/`unsafe` | Opaca: erro, salvo `assume("motivo")` | n/a |

Custo total proporcional ao write-set, e nenhum quando a região não contém operação que possa falhar (o compilador
sabe pelo conjunto de `throws` dos chamados).

**Casos de borda:**

| Caso | Tratamento recomendado |
|---|---|
| Aliasing (`transfer(a, a)`) | Se o borrow checker **[existe: `semantic/symbols/borrow.djinn`]** rejeitar dois `mut` do mesmo objeto, o caso some (a validar); senão a ordem de snapshot e restauração precisa ser definida e testada |
| Recursão em função com `atomic` | Cada nível tem seus slots; custo cresce com a profundidade, avisar |
| `return` antecipado | É saída normal (commit); `after_commit` roda em **todo** caminho de saída normal (a implementação antiga o perdia em `return` explícito) |
| `commit` em laço | Não existe (commit explícito descartado) |
| Overflow checado no meio da atualização | É erro como valor: dispara o rollback. Este é o ganho prático mais concreto |
| Trap de contrato dentro da região | Mata o processo **sem** rollback. Aceitável em memória (o estado morre junto), documentado |
| Ordem entre drops e restauração | Drops de locais da região, depois restauração do write-set. Funções chamadas já entram no write-set inferido, inclusive `dispose` que escreve em estado rastreado |
| Região em função genérica | Write-set resolvido por instância |
| Escrita via `Disposable` externo à região | Não rastreada: efeito `writes(unknown)` e erro |

**Utilidade:** alta. Remove a classe "estado parcial depois de `try`" sem depender de threads, banco ou provider.

### 7.4 Atomicidade cooperativa (`strategy cooperative`)

Com o scheduler atual, só há intercalamento nos pontos de suspensão. Portanto, uma região **sem nenhum ponto de
suspensão alcançável** é isolada de todo outro código Djinn, a custo zero em execução.

- **O que conta como suspensão:** `await` (em async ou em função síncrona, que entra no event loop), `coro.suspend`
  (usado por `Task.pause`/`Task.delay`) e qualquer chamada, transitivamente, a uma função que faça isso.
- **Verificação:** novo efeito `suspends`, inferido por ponto fixo (§4.4). Região `cooperative` com `suspends` é erro.
- **Premissa registrada no relatório:** "scheduler de uma thread executando coroutines". Se o pool passar a executar
  coroutines, todas as obrigações `cooperative` ficam inválidas e o compilador deve listá-las.
- **Business race por `await` fora de região:** padrão "ler `p`, `await`, escrever `p`" na mesma função sem região
  gera aviso. É heurística (§11).

**Recomendação:** primeira estratégia de concorrência. É honesta sobre a premissa e entrega valor imediato.

### 7.5 Locks (`strategy lock`)

A implementação antiga usava um mutex recursivo por thread, numa tabela global por endereço. Para `djinnc` isso falha
em quatro pontos:

| Problema | Por quê | Solução |
|---|---|---|
| Mutex de thread não exclui duas coroutines na mesma thread | As duas "possuem" o lock | Lock **pertencente à task**, não à thread |
| Segurar mutex de SO através de `await` | O event loop trava (deadlock) | Lock assíncrono: quem espera cede o scheduler |
| Tabela global por endereço, O(n), sem remoção | Escala mal e vaza | Lock embutido no objeto (heap) ou tabela *striped* por hash |
| Structs passadas por valor são copiadas | Lock por endereço trava a cópia (identidade × identificador) | Locks só para recursos com identidade estável (`owner`/`shared` **[existem em `std/memory`]**) |

**Ordem e deadlock.** A cláusula `ordering(Account.id ascending)` tem duas leituras:

- **Estática:** grafo programa-wide de chaves; ciclo entre duas funções (`x → y` e `y → x`) é erro. Só funciona se a
  ordem é declarada sobre *tipos de chave*, não sobre valores.
- **Em execução:** o runtime **ordena** os recursos pela chave antes de adquirir. A chave precisa ser imutável durante a
  região, o que se verifica contra o write-set (uma região que escreve a própria chave de ordenação é erro).
- `from == to`: deduplicação antes de adquirir (senão o lock é adquirido duas vezes e trava).

**Limite:** não cobre deadlock com locks de banco ou de outros processos.

### 7.6 Controle otimista e versionamento

Para dados com dono externo (banco, cache, arquivo): ler junto com a versão e gravar com compare-and-swap.

```djinn
Versioned<User> u = try await db.load(id);
u.value.name = new_name;
try await db.save_if_version(u);
```

| Aspecto | Observação |
|---|---|
| Utilidade | Alta para recursos externos; em memória com lock pessimista é desnecessário |
| Retry | Recarregar e reaplicar, com limite e *backoff*; o corpo precisa ser `retry_safe` |
| Borda: ABA | Versão que dá a volta; usar contador monotônico de 64 bits |
| Borda: livelock | Limite de tentativas e jitter; esgotar vira erro (`Conflict`) |
| Borda: deriva de esquema | `UPDATE` sem a coluna de versão volta a ser last-write-wins; o handshake do provider verifica |
| Compilador | `Versioned<T>` não pode ser gravado sem a versão (tipo); resultado de `save_if_version` é obrigatório |

### 7.7 Estratégia `database`

Depende de um provider (não há driver no `std`). O compilador impõe regras; o banco sustenta a atomicidade.

| SGBD | Observações para o mapeamento de `isolation` |
|---|---|
| PostgreSQL | `SERIALIZABLE` (SSI) pode abortar com falha de serialização (`40001`) e exige retry; deadlock (`40P01`) também |
| MySQL/InnoDB | `REPEATABLE READ` é o padrão e usa *gap locks*; tabelas não transacionais (MyISAM) não oferecem rollback |
| SQLite | Um único escritor por vez; durabilidade depende de `PRAGMA synchronous` |

**Casos de borda:**

- **`COMMIT` com resultado desconhecido** (a conexão cai durante o commit): `Unknown` obrigatório, com id da
  transação e chave de idempotência; nunca `Ok`, nunca `Failed`.
- **Região mista (memória e banco):** o banco é a fonte de verdade. Aplicar a memória, executar a transação, e em
  `Failed` restaurar a memória; em `Unknown` **não restaurar às cegas** (o banco pode ter confirmado): invalidar o
  estado em memória e reconciliar.
- **Deadlock/serialização do banco:** retry limitado pelo provider, só se o corpo for `retry_safe`.
- **Savepoints** para regiões aninhadas (`propagation: savepoint`): questão em aberto (interação com falha após
  `before_commit`).
- **Unidade de trabalho entre `await`:** a conexão pertence à task (§7.12).

### 7.8 Operação externa irreversível: pivô e compensação

Seguindo o padrão de *saga* (compensáveis → pivô → repetíveis):

```text
passos compensáveis   →   pivô (primeiro efeito irreversível)   →   passos repetíveis
(desfazíveis)             (no máximo um por fluxo)                  (idempotentes, repetem até concluir)
```

Verificações do compilador sobre a ordem:

- no máximo um pivô por fluxo;
- nenhum passo compensável depois do pivô;
- passos depois do pivô precisam ser `idempotent` (claim) e usar chave de idempotência;
- todo passo compensável declara sua compensação, e a compensação é idempotente.

Em execução: guardas de compensação executam ao sair por erro (estendendo a semântica de `Disposable`, a validar:
dispose hoje não é assíncrono nem falha). **Falha de compensação** produz o estado `Stuck`, que exige retry em segundo
plano ou operador. Nunca é eliminada. Transações distribuídas (2PC) ficam **[evitar]**.

### 7.9 Outbox, inbox e `after_commit`

- **`after_commit` é `best_effort`.** Roda depois da região, mas se o processo morrer entre o commit e o bloco, o
  efeito se perde. Serve para notificações descartáveis e invalidação de cache.
- **Outbox** garante entrega pelo menos uma vez: grava a *intenção* na mesma transação do banco; um despachante
  publica e marca como enviada. É biblioteca do `std` mais o provider, não construção de linguagem.
- **Inbox** dá processamento *efetivamente único*: insere a chave da mensagem (restrição de unicidade) **na mesma
  transação** do efeito. A entrega continua sendo pelo menos uma vez; quem deduplica é a restrição do banco.
- **Ack depois do commit.** Falha entre o commit e o ack gera reentrega, absorvida pelo inbox.
- **Riscos:** crescimento da tabela de inbox (TTL), mensagem venenosa, chave de mensagem instável entre produtores,
  vazamento de dado sensível no outbox.

### 7.10 STM

Viabilidade baixa a média: exigiria instrumentar toda leitura e escrita de estado compartilhado, mais modo
irrevogável para I/O, controle de *starvation* e effects maduros. Se um dia entrar, só por tipo explícito
(`tvar<T>`), nunca transparente. **[experimental]**.

### 7.11 Aninhamento e propagação

- `join` (padrão): a região interna participa da externa; o rollback é do conjunto.
- Em memória, regiões aninhadas empilham snapshots; `savepoint` é a mesma ideia com banco.
- `independent` (nova transação) pode causar deadlock com locks do pai: diagnosticar.
- Uma função que exige "estar dentro de uma região" (`requires atomic`) é verificável estaticamente.

### 7.12 Região atravessando `await` e threads

- O contexto da região deve ser **da task**, não da thread (mesmo problema do `errno`: coroutines retomam em outra
  thread quando o pool passar a executá-las).
- v1: `cooperative` proíbe `await`; `lock` e `database` permitem, com lock/conexão pertencente à task.
- Mover a região entre threads exige que o lock seja da task e que o snapshot seja acessível de qualquer thread.

### 7.13 Retry

- Com lock pessimista em memória não há conflito, então retry não faz sentido.
- Só se aplica a estratégia otimista, banco e (futuro) STM.
- Padrão **`retry: disabled`** (falha fechada); `retry: allowed(max = N, backoff = ...)` é opt-in e exige corpo
  `retry_safe` (sem `irreversible`, sem efeito não idempotente).
- Retry nunca é infinito por padrão; esgotar vira erro explícito.

### 7.14 Idempotência

| Aspecto | Regra |
|---|---|
| Chave | Determinística por operação lógica (por exemplo derivada do id do pedido), não aleatória por tentativa |
| Escopo e TTL | Declarados; chave expirada não protege |
| Reuso com payload diferente | Erro (`KeyConflict`), nunca "primeira vence" em silêncio |
| Resposta armazenada | O provider devolve a resposta original para repetições |
| Compilador | Operação `irreversible` exposta a retry sem parâmetro de chave é erro |
| Limite | Idempotência real é propriedade do sistema externo; a claim é confiança |

### 7.15 Interação com o resto da linguagem

| Tema | Consequência |
|---|---|
| Genéricos | Write-set, effects e snapshot resolvidos por instância; instâncias já são emitidas `linkonce_odr` no consumidor |
| `.djlib` | Cláusulas na assinatura sobrevivem à interface; effects e write-set de função pública precisam ser declarados (§3.3, §4.4) |
| Reflexão | `Restorable` pode usar a reflexão para snapshots automáticos de structs `[Reflect]` |
| Tamanho de código | Regiões instrumentadas crescem; relatório indica custo por região |
| Depuração | Em rollback, o erro carrega qual região restaurou e quais campos |
| async | `Unknown` e `Failed` propagam como erros normais do `throws` |

### 7.16 Tabela-síntese

| Componente | Viabilidade em `djinnc` | Utilidade | Complexidade | Desempenho | Recomendação |
|---|---|---|---|---|---|
| Cláusulas `require`/`ensure` com trap | Alta | Alta | Média | Um teste por violação possível | Fazer primeiro |
| Inferência de effects | Alta | Alta | Média | Só compilação | v1 |
| Atomicidade em memória (rollback) | Alta | Alta | Média | Proporcional ao write-set | v1 |
| `cooperative` | Alta | Média | Baixa | Zero | v1, ligado ao effect `suspends` |
| Lock assíncrono ordenado | Média | Média | Alta | Média | Quando o pool executar coroutines |
| Otimista/`Versioned` | Média | Alta (externo) | Média | Baixa | Com provider de banco |
| Provider `database` | Média (depende do provider) | Alta | Alta | Do banco | Avançado |
| Pivô e compensação | Média | Média | Média | Baixa | Biblioteca, depois |
| Outbox/inbox | Alta (biblioteca) | Alta | Média | Baixa | Depois de `database` |
| STM | Baixa | Baixa | Muito alta | Alta | Experimental |
| 2PC / distribuído | Baixa | Baixa | Muito alta | Alta | Evitar |

### 7.17 Resumo e veredito de viabilidade

- **Viável agora, com alto retorno:**
  - atomicidade em memória contra falhas, com rollback automático nas saídas de erro (snapshot para `TRIVIAL`, undo
    log ou `Restorable` para `VALUE`);
  - checagem estática de lifecycle e de write-set;
  - estratégia `cooperative` (sem suspensão dentro da região).

  São só compilador mais o runtime existente, com custo proporcional ao write-set ou zero. Resolvem um problema real
  de hoje: estado parcial depois de `try`.
- **Viável com trabalho de runtime, retorno médio:**
  - locks assíncronos pertencentes à task, com aquisição ordenada;
  - controle otimista/versionado.

  Dependem de identidade estável de recursos e, para retry, do sistema de effects. Só se tornam necessários quando o
  pool de threads executar coroutines.
- **Viável apenas via providers externos, com garantias condicionais:**
  - a estratégia `database`;
  - outbox/inbox.

  O compilador só verifica o protocolo (ordem, retry-safety, `Unknown`). Atomicidade, isolamento e durabilidade são
  `delegated` ao banco e nunca `proved`.
- **Não viável no horizonte próximo** (experimental ou evitar):
  - STM transparente;
  - transações distribuídas / 2PC;
  - sagas como construção da linguagem;
  - região atravessando `await` com locks de thread.
- **Conclusão:** o motor transacional é viável **como camada incremental**. Começa como garantia de atomicidade
  contra falhas, que não depende de concorrência nem de sistemas externos, e cresce por estratégias. A promessa "o
  compilador escolhe a estratégia" do rascunho original só é sustentável para a parte em memória. Para sistemas
  externos, a linguagem pode exigir e verificar o protocolo, mas não garantir o resultado.

---

## 8. Exemplos práticos

Todo o código Djinn desta seção é **conceitual**: usa cláusulas, `atomic`, `Handle`, `Versioned` e providers que ainda não
existem, e a sintaxe de `switch` é ilustrativa. Cada cenário traz os sete itens pedidos: implementação insegura,
vulnerabilidade, implementação em Djinn e, em tabela, o que o compilador verifica, o que o runtime executa, o que o
sistema externo garante e o risco que permanece.

### 8.1 Transferência bancária

**Insegura:**

```c
void transfer(Account* from, Account* to, long amount) {
    if (from->balance >= amount) {
        from->balance -= amount;
        write_audit(from, to, amount);
        to->balance += amount;
    }
}
```

**Vulnerabilidade:** *check-then-act* (dois fluxos passam no `if` e estouram o saldo); falha em `write_audit` deixa o
débito sem o crédito; se alguém adicionar locks, a ordem `from`/`to` inverte entre chamadores e gera deadlock.

**Djinn (em memória, sem `await`):**

```djinn
void transfer(Account mut from, Account mut to, i64 amount) throws(InsufficientFunds, AuditUnavailable)
    require(amount > 0)
    writes(from.balance, to.balance)
    ensure(from.balance + to.balance == old(from.balance) + old(to.balance))
    atomic strategy cooperative
{
    if (from.balance < amount) {
        throw InsufficientFunds { available = from.balance };
    }
    from.balance = from.balance - amount;
    try write_audit(from.id, to.id, amount);
    to.balance = to.balance + amount;
}
```

**Variante com banco** (`await` presente, então `cooperative` não serve):

```djinn
async void transfer_db(PostgresSession mut db, i64 from_id, i64 to_id, i64 cents) throws(InsufficientFunds, Unknown)
    require(cents > 0)
    atomic strategy database(isolation = serializable) retry allowed(max = 3)
{
    i64 rows = try await db.execute(Sql("UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?"), cents, from_id, cents);
    if (rows == 0) {
        throw InsufficientFunds {};
    }
    try await db.execute(Sql("UPDATE accounts SET balance = balance + ? WHERE id = ?"), cents, to_id);
}
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | `writes` declarado = inferido; região sem `suspends` (versão em memória); `ensure` afim provado; `require` elidido onde os chamadores provam; `Sql` só de constantes; resultado de `execute` consumido; corpo `retry_safe` (sem `irreversible`) |
| Runtime executa | Snapshot de dois slots `i64`, restaurado em saída por erro; na variante de banco, `BEGIN`/`COMMIT` e retry limitado pelo provider |
| Sistema externo garante | Banco: atomicidade e isolamento `serializable` (`delegated`), aborts por serialização |
| Risco que permanece | Trap no meio não restaura (o processo morre); premissa de scheduler de uma thread; ordem de bloqueio dentro do banco é do banco (deadlock detectado por ele, tratado como retry); `from == to` no SQL precisa de tratamento do chamador |

### 8.2 Pagamento Pix com integração externa

**Insegura:**

```c
int pay(Payment* p) {
    int r = psp_send(p->amount, p->destination);
    if (r == TIMEOUT) { r = psp_send(p->amount, p->destination); }
    p->status = (r == OK) ? PAID : FAILED;
    return r;
}
```

**Vulnerabilidade:** timeout não significa que o pagamento não ocorreu; o retry gera **cobrança duplicada**; marcar
`FAILED` num timeout perde dinheiro (o PSP processou).

**Djinn** (estados da §4.3; a liquidação é irreversível e o estorno é uma **nova** operação):

```djinn
[Transitions(Created -> Reserved, Failed; Reserved -> Submitted, Failed;
             Submitted -> Settled, Failed, Unknown; Unknown -> Settled, Failed)]
enum PixState { Created, Reserved, Submitted, Settled, Failed, Unknown }

async void submit(Db mut db, PixClient mut psp, PixPayment mut p) throws(Rejected)
    effects(db, net, irreversible)
{
    try await db.transition(p, Reserved -> Submitted);
    switch (await psp.send(p.txid, p.amount, p.destination)) {
        Accepted(receipt) => try await db.record_receipt(p, receipt),
        Rejected(reason)  => { try await db.transition(p, Submitted -> Failed); throw Rejected { reason }; }
        Unknown(token)    => try await db.transition(p, Submitted -> Unknown),
    }
}

async PixState reconcile(Db mut db, PixClient mut psp, PixPayment mut p)
    require(p.state == Unknown)
{
    ...
}
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | Transições escritas pertencem à tabela; `Unknown` tem saída por reconciliação; `psp.send` é `irreversible` e **fora** de região atômica e de retry; o parâmetro `txid` (chave de idempotência) existe na assinatura; todos os casos de `send` tratados (inclusive `Unknown`) |
| Runtime executa | `UPDATE ... WHERE state = :de` guardado (zero linhas afetadas = outro agente mudou o estado); persistência de `Unknown` antes de qualquer retry; job de reconciliação |
| Sistema externo garante | O PSP trata `txid` como chave de idempotência e permite consultar a transação por ela (**a validar na API do provedor escolhido**); liquidação final |
| Risco que permanece | PSP sem idempotência real; estorno exige nova operação com regras próprias; autenticidade do webhook; relógio; `Unknown` que nunca se resolve (tempo máximo e escalonamento humano) |

### 8.3 Escrita segura de arquivos

**Insegura:**

```c
FILE* f = fopen("config.json", "w");
fwrite(data, 1, n, f);
fclose(f);
```

**Vulnerabilidade:** `"w"` trunca antes de gravar; queda de energia ou erro no meio deixa o arquivo vazio ou parcial; sem
`fsync` o conteúdo pode estar só no cache.

**Djinn** (protocolo imposto por typestate: `replace` só aceita um arquivo temporário já sincronizado):

```djinn
void write_atomic(Dir mut dir, str name, Bytes data) throws(IoError)
    effects(fs_write)
{
    TempFile<Open> tmp = try dir.create_temp(name);
    try tmp.write_all(data);
    TempFile<Synced> synced = try tmp.sync();
    try dir.replace(synced, name);
    try dir.sync();
}
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | Ordem `write → sync → replace` (tipos `Open`/`Synced`); `tmp` consumido (sem uso depois do `replace`); o temporário é `Disposable` e é removido se qualquer passo falhar; effect `fs_write` declarado |
| Runtime executa | Chamadas de SO na ordem: `fsync` do arquivo, `rename`/`ReplaceFile`, `fsync` do diretório (POSIX) |
| Sistema externo garante | `rename` atômico no mesmo sistema de arquivos; `fsync` realmente persiste (`delegated`) |
| Risco que permanece | Temporário órfão se o processo morrer; `fsync` ignorado por hardware/virtualização; NFS e outros sistemas de arquivos com semântica diferente; Windows exige `ReplaceFile`/`MoveFileEx` com comportamento próprio; leitor com handle antigo continua vendo o conteúdo antigo (esperado) |

### 8.4 Exclusão de arquivos e prevenção de TOCTOU

> **Fora de escopo.** O tratamento de TOCTOU em filesystem será provido por uma biblioteca futura; o compilador não
> aplica nada disso. O texto abaixo fica apenas como análise do problema.

**Insegura:**

```c
if (access(path, W_OK) == 0 && !is_symlink(path)) {
    unlink(path);
}
```

**Vulnerabilidade:** entre a checagem e o `unlink`, um atacante troca `path` por um link simbólico para outro alvo
(clássico em diretórios graváveis por todos, como `/tmp`, num processo privilegiado).

**Djinn:**

```djinn
void remove_upload(Dir mut uploads, str name) throws(IoError, NotRegularFile)
    effects(fs_write)
{
    File f = try uploads.open_nofollow(name);
    FileInfo info = try f.info();
    if (!info.is_regular) {
        throw NotRegularFile {};
    }
    try uploads.remove_same(name, info.identity);
}
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | Não existe API de remoção por *path* em código seguro (só relativa a `Dir`); `f` é um `Handle` afim; `remove_same` exige a identidade vinda do mesmo handle |
| Runtime executa | `openat` com `O_NOFOLLOW`; `fstat` no handle; `fstatat` (sem seguir link) conferindo identidade imediatamente antes de `unlinkat` |
| Sistema externo garante | Semântica de `openat`/`unlinkat`; no Windows, remoção via *disposition* do handle (atômica sobre a identidade) |
| Risco que permanece | **No POSIX o `unlinkat` ainda é por nome**: a janela diminui, não some, se o atacante controla o diretório. A garantia real é "o diretório não é gravável por quem não é confiável" (condição declarada, não provada); hard links; permissões revogadas depois do `open` |

### 8.5 Acesso concorrente a recurso compartilhado

**Insegura** (perda de atualização por *business race*, sem nenhum data race de memória):

```djinn
async void increment(Counter mut c) {
    i64 v = c.value;
    await log("incrementando");
    c.value = v + 1;
}
```

**Vulnerabilidade:** duas tasks leem o mesmo `v`, ambas gravam `v + 1`; uma atualização se perde.

**Djinn** (o compilador rejeita a forma acima com diagnóstico "leitura de `c.value`, `await`, escrita de `c.value` sem
região" e oferece correções):

```djinn
async void increment(Counter mut c)
    writes(c.value)
{
    atomic strategy cooperative {
        c.value = c.value + 1;
    }
    await log("incrementando");
}
```

Correção alternativa quando o `await` precisa ficar dentro da região: `atomic strategy lock` com `access(exclusive c)`.

| Item | Conteúdo |
|---|---|
| Compilador verifica | Região `cooperative` sem `suspends`; padrão leitura-`await`-escrita detectado como aviso (heurístico) |
| Runtime executa | Nada na versão `cooperative`; na versão `lock`, lock assíncrono pertencente à task, com ordem |
| Sistema externo garante | Nada |
| Risco que permanece | Premissa de scheduler de uma thread; o aviso é heurístico (falsos positivos e negativos); lock mantido durante `await` aumenta latência e pode causar inversão de prioridade |

### 8.6 Atualização de dados com controle de versão

**Insegura:**

```c
User u = db_load(id);
u.name = new_name;
db_save(u);
```

**Vulnerabilidade:** *lost update*: outro processo gravou entre o `load` e o `save`; o `save` sobrescreve.

**Djinn:**

```djinn
async void rename_user(Db mut db, UserId id, str new_name) throws(Conflict, NotFound)
    effects(db)
    retry allowed(max = 3, backoff = exponential)
{
    Versioned<User> u = try await db.load(id);
    u.value.name = new_name;
    try await db.save_if_version(u);
}
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | `Versioned<T>` só é gravado por `save_if_version` (tipo); resultado tratado (`Conflict`); corpo `retry_safe` (apenas `db`) para autorizar o retry |
| Runtime executa | `UPDATE ... WHERE id = ? AND version = ?` e checagem de linhas afetadas; recarga e reaplicação até o limite |
| Sistema externo garante | Comparação atômica de versão e incremento atômico (`delegated`) |
| Risco que permanece | ABA se a versão for pequena; livelock sob contenção alta; deriva de esquema (coluna de versão ausente no `UPDATE`); leituras inconsistentes entre tabelas (versão por linha não cobre invariantes entre linhas) |

### 8.7 Comunicação com API externa sujeita a timeout

**Insegura:**

```c
for (int i = 0; i < 3; i++) {
    if (http_post(url, body) == 0) break;
}
```

**Vulnerabilidade:** repetir um `POST` não idempotente após timeout executa a ação várias vezes; sem prazo total, o
loop pode demorar mais que o chamador esperava.

**Djinn:**

```djinn
async Label create_label(HttpClient mut http, Order o, Deadline deadline) throws(Rejected, Unknown)
    effects(net, irreversible)
{
    IdempotencyKey key = IdempotencyKey.for_order(o.id);
    return try await http.post_idempotent(url, o.payload, key, deadline);
}
```

| Operação | Pode repetir após timeout? | Condição |
|---|---|---|
| `GET` / leitura | Sim | Sem efeito externo |
| `PUT`/`DELETE` idempotente | Sim | A API garante idempotência (claim) |
| `POST` com chave de idempotência | Sim | A API respeita a chave; resposta original devolvida |
| `POST` sem chave | **Não**: resultado `Unknown`, reconciliar | O compilador recusa a chamada com retry |

| Item | Conteúdo |
|---|---|
| Compilador verifica | Operação `irreversible` com retry exige parâmetro `IdempotencyKey`; todos os casos de resultado tratados (`Unknown` incluso); `Deadline` propagado (não timeout por chamada) |
| Runtime executa | Repetição com *backoff* e jitter até o prazo; corta ao esgotar |
| Sistema externo garante | Respeito à chave por um TTL conhecido; consulta por chave para reconciliação |
| Risco que permanece | API que ignora a chave; chave expirada antes da repetição; relógios; tratamento de erro parcial no corpo da resposta |

### 8.8 Processamento de mensagens com possibilidade de duplicação

**Insegura:**

```c
Message m = broker_receive();
apply_business(m);
broker_ack(m);
```

**Vulnerabilidade:** queda entre `apply_business` e `broker_ack` causa reentrega e **efeito duplicado**; invertendo a
ordem (ack antes), a queda **perde** a mensagem.

**Djinn** (typestate impede aplicar sem reivindicar a mensagem):

```djinn
async void handle(Db mut db, Broker mut broker, Message<Unclaimed> m) throws(Retry)
    effects(db, net)
{
    atomic strategy database(isolation = read_committed) {
        Message<Claimed> claimed = try await db.claim(m);
        try await apply_business(db, claimed);
    } after_commit {
        await broker.ack(claimed);
    }
}
```

`db.claim` executa `INSERT ... ON CONFLICT DO NOTHING` sobre `inbox(message_id)` com restrição de unicidade, e devolve
erro `AlreadyProcessed` se já existe (a mensagem repetida só recebe o ack).

| Item | Conteúdo |
|---|---|
| Compilador verifica | `apply_business` só aceita `Message<Claimed>`; o `ack` (efeito `net`) fica em `after_commit`, fora da região; efeitos dentro da região ⊆ `db` |
| Runtime executa | Transação com a inserção no inbox e o efeito de negócio juntos; ack depois do commit |
| Sistema externo garante | Restrição de unicidade do banco; broker reentrega pelo menos uma vez |
| Risco que permanece | Tabela de inbox cresce (TTL); mensagem venenosa precisa de limite e fila morta; chave de mensagem instável entre produtores; ordem entre mensagens não é garantida; "exatamente uma vez" é do processamento, **não** da entrega |

### 8.9 Operações com hardware

**Insegura:**

```c
#define UART_CTRL (*(volatile uint32_t*)0x40001000)
UART_CTRL |= ENABLE;
send_byte(b);
```

**Vulnerabilidade:** *read-modify-write* não atômico se uma interrupção altera o mesmo registrador; enviar antes de
configurar a velocidade; duas partes do código achando que possuem o periférico.

**Djinn:**

```djinn
struct Uart<S> { ... }

Uart<Disabled> take_uart();
Uart<Configured> configure(Uart<Disabled> u, UartConfig c);
Uart<Enabled> enable(Uart<Configured> u);
void send(Uart<Enabled> mut u, u8 b);
```

| Item | Conteúdo |
|---|---|
| Compilador verifica | Ordem `take → configure → enable → send` (typestate); posse única (tipo move-only, §4.2); registradores acessados com `[Volatile]` **[existe]**; efeitos de rotinas de interrupção limitados (sem alocação nem bloqueio) |
| Runtime executa | `take_uart` marca a posse (uma vez); seção crítica desabilita interrupções em torno de RMW compartilhado; perfil `none` (sem runtime de garantias) |
| Sistema externo garante | Semântica dos registradores, ordenação do barramento, comportamento do dispositivo |
| Risco que permanece | DMA e memória compartilhada com o dispositivo; barreiras de memória (hoje só existe `__djinn_atomic_add`); *errata* do chip; tempo real; o compilador não vê o hardware |

### 8.10 Operações que podem falhar parcialmente

**Insegura:**

```c
reserve_stock(order);
charge_card(order);
create_shipment(order);
```

**Vulnerabilidade:** falha em `charge_card` deixa o estoque reservado para sempre; falha em `create_shipment` depois da
cobrança deixa o cliente pago e sem entrega; nenhuma etapa sabe desfazer as anteriores.

**Djinn** (pivô e compensação, §7.8):

```djinn
async void fulfill(Order o) throws(OutOfStock, Declined, Stuck)
    effects(db, net, irreversible)
{
    Reservation r = try await reserve_stock(o);
    Charge c = try await charge_card(o, IdempotencyKey.for_order(o.id));
    r.confirm();
    try await create_shipment(o, IdempotencyKey.for_order(o.id)) retry until done;
}
```

`Reservation` é uma guarda de compensação: se a função sair por erro antes de `confirm()`, a compensação
(`release_stock`) é executada.

| Item | Conteúdo |
|---|---|
| Compilador verifica | Um pivô (`charge_card`) por fluxo; nenhum passo compensável depois dele; passos após o pivô são idempotentes e usam chave; a compensação é idempotente |
| Runtime executa | Compensação ao sair por erro; retry com *backoff* dos passos repetíveis; estado persistido para continuar após queda |
| Sistema externo garante | Cada serviço respeita a chave de idempotência e permite a compensação |
| Risco que permanece | **Falha da compensação** (`Stuck`) exige operador ou retry em segundo plano; observabilidade entre serviços; cliente vê estados intermediários (sem isolamento); compensação semântica (devolver dinheiro não é desfazer) |

---

## 9. Responsabilidades do compilador e do runtime

### 9.1 O que o compilador analisa

| Análise | Fase | Entrada | Saída |
|---|---|---|---|
| Cláusulas `require`/`ensure`/`invariant`/`old` | Parser e checker | Assinaturas e corpos | Cláusulas tipadas em `FunctionInfo` |
| Fatos afins e intervalos | Verificador | Corpos e argumentos constantes dos chamadores | `Proved` ou elisão de `check` |
| Inferência de effects | Verificador, depois do checker | Grafo de chamadas | Conjunto de effects por função |
| Claims `reads`/`writes`/`effects` | Verificador | Declarado × inferido | Erro se divergem (§4.4) |
| Regiões `atomic` | Verificador | Write-set, `suspends`, `irreversible` | Plano de snapshot, erro de estratégia incompatível |
| Typestate e `[Transitions]` | Checker e verificador | Tipos genéricos, tabela | Erro de protocolo |
| Ordem (`ordering`) | Verificador | Chaves declaradas por função | Ciclos |
| Retry-safety | Verificador | Effects do corpo | Autoriza ou recusa `retry allowed` |
| Providers | Checker | `[Guarantees]` × especificação | Erro de garantia ausente |
| Ownership, borrow, `throws`/`try` | Checker **[existe]** | Código | Já implementado |

### 9.2 O que precisa ser provado, checado em execução ou delegado

| Provado (estático) | Checado/imposto em execução | Delegado |
|---|---|---|
| Fatos afins em cláusulas, inclusão de conjuntos de effects, ciclos de `ordering`, protocolo de typestate, tabela de transições | Cláusulas `check` não elididas, rollback do write-set, aquisição ordenada, limite de retry, sondas dos providers | Atomicidade, isolamento e durabilidade do banco; `rename` atômico; idempotência do serviço externo |

### 9.3 O que o runtime controla

| Responsabilidade | Mecanismo | Perfil |
|---|---|---|
| Violação de contrato | `__djinn_contract_violation(site)`: imprime cláusula, valores e local; encerra (ou chama handler) | `none` e acima |
| Snapshot de write-set `TRIVIAL` | Gerado **inline** em *stack slots*, sem chamada ao runtime | `core` |
| Log de undo para tamanhos dinâmicos | Arena de undo por task | `core` |
| Lock assíncrono pertencente à task, com ordem | Primitivas novas em `runtime/scheduler.c` (hoje só há `__djinn_mutex_*` de thread) | `full` |
| Retry limitado com backoff | Biblioteca do `std` | `core` |
| Providers | Bibliotecas em Djinn sobre `extern "C"` | `full` |

O que **não** vai para o runtime: provas, inferência, escolha de estratégia por heurística.

### 9.4 Providers e adapters por dentro

```text
 código do usuário
        │ chama
 Provider (struct em Djinn, com [Guarantees] e [Effects])
        │ usa
 Adapter fino (extern "C" ou chamada de SO), efeito unknown, sem garantia por si só
        │ fala com
 Sistema externo (SO, banco, rede, dispositivo)
```

- O provider é onde a garantia é **declarada** e onde se implementa o protocolo (handshake, traduções de erro,
  `Unknown`, idempotência).
- O adapter é deliberadamente "burro": só marshalling.
- O kit de conformance fica em `libs/testing` e roda contra o sistema real em CI; o relatório de obrigações imprime
  "provider X versão Y, conformance Z".

### 9.5 Drivers, bibliotecas externas e `unsafe`

Resumido na §6.6. Regra operacional: **código fora do alcance do verificador é uma fronteira de confiança**, e o
relatório a mostra (lista de `extern`s sem `[Effects]`, de `unsafe` em regiões e de `assume`).

### 9.6 Diagnósticos legíveis por máquina

Cada diagnóstico tem código estável, evidência e **lista fechada de resoluções**, para que um agente possa corrigir
sem criatividade. Exemplo:

```text
CONTRACT_RETRY_UNSAFE_EFFECT    (código a atribuir)

A região `submit` permite retry (retry allowed), mas contém um efeito irreversível.

  efeito detectado:  irreversible (net)
  origem:            psp.send(...)  em pix.djinn:42:9

Resoluções possíveis:
  1. mover a chamada para after_commit
  2. declarar a operação idempotente e passar uma IdempotencyKey
  3. trocar para retry disabled
  4. fornecer uma compensação
```

Numeração: `djinnc/src/support/source/diagnostic_code.djinn` já usa 9xxx para erros de `throws`. Os números `95xx` do
compilador C++ antigo pertenciam a outro registro e **não devem ser reutilizados**; propõe-se uma faixa nova, a
confirmar (Apêndice B).

---

## 10. Comparação com tecnologias existentes

Legenda: **tem** = existe como recurso da linguagem ou ferramenta oficial; **externo** = existe como ferramenta ou
biblioteca separada.

| Tecnologia | O que já existe | O que Djinn aproveitaria | Lacuna que permanece |
|---|---|---|---|
| **Rust** | Ownership e borrow; `Send`/`Sync` impedem data races em código seguro; RAII; `#[must_use]`; typestate por convenção; capabilities em `cap-std` (externo); verificadores externos (Prusti, Creusot, Kani, Verus) | Modelo de ownership já presente em `djinnc`; typestate por move | Sem contratos, effects nem transações na linguagem; `Send`/`Sync` não cobrem deadlock nem *business race* |
| **C++** | RAII, `std::scoped_lock` (evita deadlock ao adquirir vários mutexes), `std::atomic`; contratos `pre`/`post` do C++26 (P2900) com semânticas de avaliação (ignorar, observar, impor); Transactional Memory TS (experimental) | Modelos de avaliação de contrato como inspiração para os `mode` | Contratos não são provados; sem ownership checado; sem sistema de effects |
| **Ada/SPARK** | `Pre`/`Post`, `Type_Invariant`, análise de fluxo (`Global`/`Depends`), prova por GNATprove (Why3 e SMT), perfil Ravenscar para concorrência analisável, ownership para ponteiros | Prova de ausência de erros em subconjunto; **reads/writes como `Global`** | Subconjunto restrito; custo de adoção alto; sem transações nem sistemas externos |
| **Pony** | *Reference capabilities* (`iso`, `val`, `ref`, `box`, `tag`); atores; ausência de data race por construção | Referência para a v2 de data-race-freedom | Mudança profunda de modelo de programação; sem noção de recurso externo |
| **Haskell** | STM (`TVar`, `retry`, `orElse`); `IO` não pode ocorrer dentro de `atomically` (por tipo); pureza como efeito (mônadas); LinearTypes; Liquid Haskell (externo) | **Proibir efeito externo dentro de região retentável** (mesma ideia, via effects); retry compositável | Efeitos por mônadas pesam na adoção; sem sistema de providers |
| **Java** | `synchronized`, `java.util.concurrent`; `@Transactional` do Spring/JTA com propagação (`REQUIRED`, `REQUIRES_NEW`, `NESTED`); checked exceptions como efeito parcial; JML/Checker Framework (externo) | Semântica de propagação (`join` como padrão) | Transação por anotação não verifica retry-safety nem efeitos |
| **C#** | `lock`, `async/await`, `TransactionScope` (transação ambiente que pode escalar para distribuída); nullable refs; Code Contracts foi descontinuado | Lição: transação ambiente implícita esconde custo (escalonamento para MSDTC) | Sem verificação estática de contratos nem de retry |
| **Lean** | Teoria de tipos dependentes; prova de propriedades arbitrárias; Lean 4 é linguagem de programação | Nada diretamente; mostra o teto da verificação | Custo de provas manuais, fora do alcance de uso geral |
| **Dafny** | `requires`/`ensures`/`invariant`, **`reads`/`modifies`** (frames), estado fantasma, verificação via Boogie/Z3, compila para vários alvos | Quadro de `reads`/`writes` e fantasma: **a ideia de `reads/writes` não é nova** | Sem effects externos, transações, providers |
| **F\*** | Tipos dependentes com **sistema de effects** extensível (`Tot`, `ST`, `Div`, definidos pelo usuário), SMT, extração para C (HACL\*) | Efeitos verificados; prova modular | Curva de aprendizado alta; não é de uso geral |
| **Verus** | Verificação de Rust com SMT (Z3); código de prova separado do executável; permissões fantasmas lineares para concorrência | Modelo de modos (`spec`/`proof`/`exec`) e prova de concorrência como v2 | Depende de Rust; sem transações |
| **Capability security** | Capacidades de objeto (E, Joe-E), Capsicum (FreeBSD), seL4, WASI (diretórios pré-abertos), Fuchsia (handles) | **Sem autoridade ambiente**: diretório como capability | Exige redesenho de APIs; legado usa paths |
| **Sistemas transacionais** | ACID/MVCC em SGBDs; STM; JTA/XA (2PC); sagas (Garcia-Molina e Salem, 1987); padrões outbox/inbox; durable execution (Temporal); TLA+ para projeto | Pivô/compensação, outbox/inbox, idempotência como biblioteca | Nenhuma linguagem verifica o protocolo de ponta a ponta |

### 10.1 O que realmente é novo (sem inventar diferenciais)

Quase tudo individualmente existe:

- *frames* `reads`/`writes` (Dafny, SPARK `Global`);
- contratos com modos de avaliação (C++26, SPARK, Eiffel);
- sistemas de effects verificados (F\*, Koka, Unison);
- rollback de região (STM em Haskell/Clojure, `scope_guard` em C++, savepoints de banco);
- proibir I/O dentro de região retentável (Haskell, por tipo);
- capabilities e handles sem autoridade ambiente (Capsicum, WASI, Pony);
- sagas, outbox e inbox (padrões de arquitetura, sem suporte de linguagem);
- diagnósticos com correções aplicáveis por máquina (Rust `help:` e `cargo fix`).

O que **talvez** valha como combinação, sem ter sido validado contra toda a literatura:

1. **Proveniência obrigatória** em cada garantia (`proved`/`enforced`/`checked`/`delegated`/`best_effort`) em um
   relatório único, com `delegated` só aceito quando um provider declarado (nome e versão) sustenta. Verificadores
   existentes marcam suposições (`assume` em Dafny, `external_body` em Verus, `axiom` em Lean), mas não classificam
   *quem* as sustenta nem as casam com uma declaração verificável de provider.
2. **Retry-safety e ordem do irreversível** (pivô) calculadas pelo mesmo sistema de effects que o resto, sobre
   erros-como-valor, em linguagem de uso geral com FFI para C.
3. **Integração com `throws`**: rollback automático acionado pelas saídas de erro que a linguagem já tem.

O diferencial realista é de **escopo e coesão**, não de ideia: um sistema pequeno, em camadas, que não promete o que
não pode sustentar. Se essa coesão não se mostrar na prática (§12.6), não há diferencial.

---

## 11. Limitações e riscos

### 11.1 Riscos técnicos

| Risco | Impacto | Mitigação |
|---|---|---|
| Complexidade do compilador | O verificador, a inferência de effects e o typestate entram numa base que se compila a si mesma | Fases incrementais (§12); verificador isolado em `semantic/verify/`; desligável por flag; **fixpoint** (`stage2 == stage3`) como teste de regressão |
| O compilador não pode usar a feature até o bootstrap | `djinnc/SUBSET.md:55` lista `require`/`ensure` como não suportados no código-fonte do compilador | Só usar contratos no código do compilador depois que o estágio anterior os suportar |
| Complexidade do runtime | Locks de task, undo log, providers | Perfis `none`/`core`/`full`; o essencial (trap, snapshots) é inline |
| Overhead de execução | Checks, snapshots, locks | Elisão por prova; custo proporcional ao write-set; relatório de custo por região |
| Dificuldade de provar | SMT geral é imprevisível | Fragmento afim próprio; `unknown` vira `check`, nunca falso positivo silencioso |
| Explosão de estados | Model checking de sistema inteiro | Só tabelas de transição isoladas; o resto, ferramenta externa |
| Falsos positivos | Avisos heurísticos (leitura-`await`-escrita, check-then-act em identificadores) incomodam | Avisos, não erros; `[Suppress(motivo)]` auditado e contado |
| Falsos negativos | Aliasing, `unsafe`, FFI escapam | Relatório lista os pontos cegos; nunca afirmar "sem data race" |
| `.djlib` | Effects inferidos somem da interface; **não há lista de dependências nem checagem de versão** (`djinnc/LIBRARY.md`) | Effects explícitos em API pública; auditoria na compilação da biblioteca; hash/versão de provider no manifest quando houver dependências |
| Compatibilidade com C e C++ | Não há ABI de contrato nem de effects | Cláusulas só no lado Djinn; `extern` = `unknown` |
| Compatibilidade com bibliotecas existentes | Quase todas são `unknown` | Wrappers com `[Effects]`; migração gradual |
| Depuração | Rollback e elisão escondem execução | Erro com a região e os campos restaurados; modo `--contracts=check-all` que desliga a elisão |
| Adoção | Muitas cláusulas desanimam | Tudo opcional; inferência; defaults seguros; começar pelo que dá retorno sem escrever nada (rollback, effects) |
| Programação de baixo nível | Regiões e checks não cabem em ISR/boot | Perfil `none`; `[NoContracts]` por função com justificativa |
| Sistemas embarcados | Sem heap, sem scheduler | `none`; snapshots só em stack; sem providers dinâmicos |
| Async em `djinnc` | Retomada em outra thread no futuro quebra locks de thread e TLS | Locks e contexto pertencentes à task desde o início (§7.12) |

### 11.2 Riscos de segurança introduzidos pela própria arquitetura

| Risco | Cenário | Mitigação |
|---|---|---|
| **Falsa sensação de segurança** | "Compilou, logo é seguro", ignorando que `delegated` é confiança | Relatório separa categorias; `best_effort` nunca é contado; premissas impressas |
| Abuso de `assume`/`ignore` | Silenciar o verificador para "fazer compilar" | Justificativa obrigatória, contagem no relatório, política de CI que limita o número |
| Provider que mente | Pacote declara `serializable` sem sustentar | Conformance em CI, sonda em execução, versão no relatório |
| Cadeia de suprimentos | Uma `.djlib` maliciosa traz declarações de effects falsas | Hash do manifest e verificação de dependências (hoje inexistentes) antes de confiar em claims de biblioteca |
| Verificação como vetor de DoS | Código de entrada patológico faz o verificador explodir | Orçamento de passos e tempo (a versão antiga já usava orçamento no ponto fixo); estouro vira `unknown` |
| Trap como DoS | Entrada que dispara `require` derruba o serviço | `require` é para bugs do chamador; entrada externa deve ser validada com `throws`, que é valor |
| Verificação em tempo de uso | Um `check` de estado externo ainda sofre TOCTOU | Predicado guardado na operação, nunca uma checagem separada |
| Crescimento de memória do undo log | Região com write-set dinâmico grande | Limite configurável; erro ao estourar |
| Vazamento por diagnóstico | Mensagens de contrato imprimem valores sensíveis | Valores não são impressos por padrão em build de release |
| Chave de idempotência | Colisão ou reuso permite repetir ou suprimir operação de outro usuário | Chave derivada da operação lógica, com escopo por tenant, e erro `KeyConflict` |
| Outbox/inbox | Mensagens sensíveis persistidas | Criptografia e retenção definidas pelo provider |
| Locks esquecidos após trap | Processo continua com lock retido | Locks pertencem à task e são liberados na saída por erro; trap encerra o processo |

---

## 12. Roadmap de implementação

Escalas qualitativas (**Baixa**, **Média**, **Alta**, **Muito alta**). São estimativas relativas para ordenar o
trabalho, **não prazos**. "Desempenho" é o impacto no código gerado por quem usa o recurso.

### 12.1 Premissas

- Tudo em `djinnc`. Nada no compilador C++.
- Cada recurso respeita o `AGENTS.md`: testes em `tests/conformance/src/suites/`, scripts em `tests/djinnc/` quando há
  `djinn.proj` ou opções de linha de comando, verificação do fixpoint e da suíte completa antes de PR, e página no
  submódulo `docs` em commit próprio com o ponteiro atualizado.
- Cada recurso é checado contra o sistema de bibliotecas (`djinnc/LIBRARY.md`), com caso em
  `tests/conformance/src/suites/library.djinn` quando cruza a fronteira `.djlib`.

### 12.2 MVP: contratos de valor com trap, effects e relatório

| # | Recurso | Complexidade | Benefício | Dependências | Manutenção | Desempenho |
|---|---|---|---|---|---|---|
| 1 | Decidir nome ("spec") e fechar a sintaxe das cláusulas | Baixa | Alto (destrava tudo) | Este documento | Baixa | Nenhum |
| 2 | Parser aceita `require`/`ensure`/`invariant`/`old`; cláusulas em `FunctionInfo` (hoje: "contracts are not supported yet") | Baixa | Médio | 1 | Baixa | Nenhum |
| 3 | Modo `check` com trap `__djinn_contract_violation`; `old()` em `TRIVIAL`; **inclui funções async** | Média | Alto | 2, runtime C | Média | Um teste por cláusula não elidida |
| 4 | Diagnósticos estruturados com resoluções | Média | Alto (agentes) | `support/source/diagnostics.djinn` | Média | Nenhum |
| 5 | Inferência de effects por ponto fixo; `extern` = `unknown`; `[Effects]` | Média/Alta | Alto | Grafo de chamadas, `FunctionInfo` | Média | Nenhum (compilação) |
| 6 | Verification IR (`Obligation`) e `--obligations` | Média | Alto | 3, 5 | Média | Nenhum |
| 7 | Elisão por fatos afins e constantes dos chamadores | Média | Médio | 6; `ConstEval` **[existe]** | Média | Reduz checks |

### 12.3 Primeira versão utilizável: atomicidade em memória e recursos tipados

| # | Recurso | Complexidade | Benefício | Dependências | Manutenção | Desempenho |
|---|---|---|---|---|---|---|
| 8 | Claims `reads`/`writes`/`effects` auditadas contra inferência | Média | Alto | 5 | Média | Nenhum |
| 9 | Região `atomic` com rollback automático (`TRIVIAL`, *stack slots*) | Média | **Muito alto** | 5, 8, caminhos de saída de erro **[existem]** | Média | Proporcional ao write-set |
| 10 | Effect `suspends` e `strategy cooperative` | Baixa/Média | Alto | 5, 9 | Baixa | Zero |
| 11 | `after_commit` | Baixa | Médio | 9 | Baixa | Nenhum |
| 12 | Tipos *move-only* e padrões de typestate | Média | Alto | Mudança em `Ownership.derive` | Média | Zero |
| 13 | `Handle<R>`/`Dir` no `std` (API relativa a diretório, `open_nofollow`) | Média/Alta | Alto (TOCTOU) | 12; runtime de fs | Média | Zero |
| 14 | `Restorable` e rollback de `VALUE` | Média | Médio | 9; reflexão **[existe]** | Média | Definido pelo tipo |
| 15 | `[Transitions]` e verificação da tabela | Média | Médio | 12 | Baixa | Zero |
| 16 | Captura de erro de `extern` (Apêndice A), **independente** das demais | Média | Alto (interop) | Atributo compilador-conhecido; runtime C | Baixa | Uma chamada de runtime por `extern` anotado |

### 12.4 Recursos avançados

| # | Recurso | Complexidade | Benefício | Dependências | Manutenção | Desempenho |
|---|---|---|---|---|---|---|
| 17 | Providers (`[Guarantees]`) e kit de conformance | Alta | Alto | 5, 6, `libs/testing` | Alta | Zero no compilador; custo do handshake |
| 18 | `strategy lock`: lock assíncrono da task, aquisição ordenada, `ordering` | Alta | Médio (cresce com o pool) | 9, runtime de scheduler | Alta | Média |
| 19 | `Versioned<T>` e `retry allowed` | Média | Alto (externo) | 5, 17 | Média | Baixo |
| 20 | Provider `database` (primeiro alvo: SQLite ou PostgreSQL) | Alta | Alto | 17, 19 | Alta | Do banco |
| 21 | `Sql` seguro (constante + parâmetros), update guardado | Média | Alto (segurança) | 20; `constexpr` **[existe]** | Média | Zero |
| 22 | Pivô, compensação e guardas (extensão de `Disposable`) | Média/Alta | Médio | 12, 5; decisão sobre dispose assíncrono | Média | Baixo |
| 23 | Outbox/inbox no `std` | Média | Alto | 20 | Média | Baixo |
| 24 | Idempotência (`IdempotencyKey`) e regra do compilador | Média | Alto | 5, 19 | Baixa | Nenhum |

### 12.5 Experimental e a evitar

**Experimental** (depois de validar o resto): backend SMT (Z3/cvc5) opcional sobre o fragmento afim; STM por
`tvar<T>`; capabilities no tipo para ausência de data race entre threads (documento v2); exportação para TLA+; geração
de testes baseados em propriedades a partir das cláusulas; tipos refinados; `interrupt_off` para sistemas embarcados.

**Evitar no início:**

| Item | Motivo |
|---|---|
| Transações distribuídas / 2PC | Complexidade enorme, garantias dependem de terceiros |
| Polimorfismo de effects | Custo alto em tipos e erros; o ponto fixo pessimista basta |
| Escada completa de isolamento SQL | `snapshot` e `serializable` cobrem o uso real |
| "Compilador escolhe a estratégia" para sistemas externos | Só é sustentável em memória (§7.17) |
| Palavra-chave `uow` e `state` | Cláusulas e genéricos bastam na v1 |
| Runtime obrigatório | Inviabiliza embarcados (§3.5) |
| Exceções reais e unwinding | `djinnc` é erro-como-valor |
| Código do compilador usando contratos antes do bootstrap | Quebra o fixpoint |

### 12.6 Como validar que a coesão compensa

1. **Piloto de ponta a ponta** com o exemplo bancário (§8.1) em memória, antes de qualquer provider; os cenários dos
   `demos/bank-*` do branch antigo viram casos de conformance.
2. **Métricas:** fração de obrigações `proved`/elididas; custo em tempo de compilação, medido compilando o próprio
   `djinnc`; custo de execução do rollback; taxa de falsos positivos dos avisos heurísticos em código real (`std`,
   `djinnc`).
3. **Critério de parada:** se as cláusulas não forem usadas voluntariamente nem o rollback automático reduzir bugs em
   código real, não avançar para providers.

---

## 13. Recomendações finais

1. **Começar pelo que não depende de ninguém:** cláusulas `check` com trap (itens 2–3), inferência de effects (5) e
   rollback automático em memória (9). Isso já elimina uma classe real de bugs (estado parcial depois de `try`) e
   gera o relatório de obrigações.
2. **Resolver três pré-requisitos de linguagem antes de escrever o verificador:** (a) o nome ("spec" × "contract"),
   (b) o mecanismo de tipo *move-only* sem recurso (`Ownership.derive` hoje copia structs triviais),
   (c) como `after_commit` recebe blocos sem closures.
3. **Nunca atribuir ao compilador o que depende do SO ou de serviço.** Toda garantia externa é `delegated`, nomeia o
   provider e é testada por conformance e sonda em execução.
4. **Tratar `Unknown` como cidadão de primeira classe** em qualquer API de rede ou banco. É a diferença entre
   dinheiro perdido e dinheiro recuperável.
5. **Manter o motor transacional incremental:** memória, depois `cooperative`, depois providers. Não prometer STM,
   2PC nem escolha automática de estratégia externa.
6. **Capturar erro de `extern` (issue #55) como feature independente**, de baixo risco e alto valor de interop, que
   também serve de base para escrever adapters. Não é parte do sistema de contratos e pode ficar de fora.
7. **Medir antes de ampliar** (§12.6) e **recusar o escopo** que não se mostrar útil.
8. **Registrar este documento como substituto** de `VERIFICATION-SPEC.md` e `VERIFICATION-IDEAS.md` do branch
   antigo, que nunca foram para `master`.

---

## Apêndice A — Issue #55: captura de erro em `extern "C"`

**Natureza:** ideia de segurança e de interop, **independente do sistema de contratos** e passível de ficar de fora.
Esta seção é análise de viabilidade escrita; nada foi implementado.

### A.1 Veredito

**Viável, risco baixo.** O motivo é que `djinnc` já tem o mecanismo certo: uma função `throws` devolve por valor o
record `{ i32 tag, [N x i64] payload }`, consumido por `try`, relançamento e `switch` sobre a chamada. Um `extern`
anotado só precisa *se comportar como* uma função `throws(E)`: o wrapper é gerado no ponto da chamada e produz esse
record. Não é preciso construir `result<T, E>` à parte, nem alterar `try`.

### A.2 Estratégias do issue

| Estratégia | Viabilidade na v1 | Observação |
|---|---|---|
| `errno` | Alta | Lê o erro logo após a chamada; zera `errno` antes (funções como `strtol` não o limpam em sucesso) |
| `return_code` | Alta | O próprio retorno é o código; `T` vira `void` na assinatura vista pelo chamador |
| `null` | Alta | Ponteiro nulo indica falha |
| `last_error` | Média | `GetLastError` no Windows; exige acessor no runtime |
| `out_parameter` | Média | O compilador aloca a struct e retira o parâmetro da assinatura visível: `NOT_SUPPORTED_YET` na v1 |
| `exception` | **Inviável hoje** | `djinnc` não emite `invoke`/`landingpad` (`code_generator_errors.djinn` declara "no unwinding") |
| `none` | Existe | Comportamento atual |

### A.3 Sintaxe recomendada

`djinnc` escreve atributos como `[Nome(campo = expr)]`, **não** `@nome(...)` como no issue. O tipo de erro visível
é explícito na assinatura, pelo `throws` existente:

```djinn
extern "C" {
    [NativeError(detect = return < 0, capture = errno)]
    i32 remove(i8* path) throws(OsError);

    [NativeError(detect = return == null, capture = errno)]
    FILE* fopen(i8* path, i8* mode) throws(OsError);

    [NativeError(detect = return != 0, capture = return_code)]
    i32 some_status_call() throws(CurlError);
}
```

### A.4 Respostas às perguntas em aberto do issue

| Pergunta | Recomendação |
|---|---|
| Tipo visto pelo chamador: `result<T, E>`? | O record de `throws` (mesma forma de um `result` sem nicho); `.to_result()` opcional no `std`. `E`: `OsError { code }` com `message()` para `errno`; enum do usuário para `return_code` |
| Atributo ou bloco `extern`? | Atributo sobre a declaração, já dentro de `extern "C" { ... }` |
| `detect` × `when` | Unificar em `detect`, **expressão** tipada como `bool` (não string). O pseudo-local `return` representa o valor devolvido (consistente com `ensure(return ...)`) |
| `when` constexpr ou string? | Expressão do verificador de tipos; só `return` e constantes na v1 |
| Parâmetro de saída | Adiado; ver acima |
| Valor de sucesso em `return_code`/`out_parameter` | `T` vira `void` quando o retorno é o próprio status; preservado em `errno` e `null` |
| `last_error` e `exception` | `last_error` entra; `exception` fica para quando existir unwinding |
| `errno` e assincronia | Async é opt-in e só há suspensão em `await`, `coro.suspend` e inicial/final; **nada** se intercala entre a chamada `extern` e a leitura imediata. O perigo real é código emitido entre os dois (drops): a leitura vem primeiro |
| Relação com `unsafe` | O checker só chama `require_unsafe` em deref, indexação e aritmética de ponteiro bruto, conversão inteiro→ponteiro e cast de ponteiro (`type_checker_access.djinn`, `type_checker_operators.djinn`, `type_checker_unsafe.djinn`): **chamar uma função `extern "C"` agora exige `unsafe`** (E3052, `is_native_extern`): função externa é `unsafe` por padrão, independentemente da assinatura. Funções vindas de `.djlib` não contam como `extern` nativo. Quando estiver, um `extern` anotado cuja assinatura não usa ponteiros continua chamável em código seguro, e `[NativeError]` não altera isso. Quem adotar o wrapper não esconde `unsafe`: a insegurança que sobra é a dos ponteiros |
| Anotação `@ffi` | Desnecessária: `extern "C"` já diz o ABI. Não criar atributo sem efeito distinto |
| Composição com `throws`/`try` | Direta: **é** o `throws` |
| Migração do `libc.djinn` | Primeiros candidatos em `std/sys/io.djinn`: `fopen`, `open`, `close`, `read`, `write`, `lseek`, `remove`, `rename`. Casos especiais: `fread`/`fwrite` sinalizam falha por contagem curta e `fclose`/`fflush` por `EOF`. `malloc` com `null` só se os chamadores aceitarem `try`; `__djinn_malloc` deve continuar infalível |

### A.5 Pontos de integração (para uma implementação futura)

Todos em `djinnc/src/`, salvo indicação:

1. `ast/attributes/attributes.djinn`: registrar `NativeError` como atributo do compilador, alvo `EXTERN_FUNCTION`.
   O caminho genérico de `semantic/checker/type_checker_attributes.djinn` (linhas ~15-49) checa o payload com escopo
   de namespace e exige constante de compilação ("attribute argument is not a compile-time constant"), então
   `return` não funciona nele: o atributo precisa de checker próprio, que vincula o pseudo-local `return`.
2. `parser/parser_expressions.djinn`: aceitar `return` como expressão apenas dentro desse argumento (o mesmo nó
   serve a `ensure(return ...)` depois).
3. `semantic/symbols/function_info.djinn`: campos `error_capture` e `error_detect` (cache no *bind*, pois
   `Attributes.of` é varredura linear). `semantic/analyzer/semantic_analyzer_functions.djinn` (`build_function` e
   `resolve_throws`) preenche os campos.
4. `codegen/code_generator_functions.djinn:19-26`: o protótipo nativo de `extern` mantém o retorno cru; proteger
   com `!info.is_extern` onde `has_throws` altera o retorno.
5. `codegen/code_generator_calls.djinn` (por volta de 172-181): depois de `LLVMBuildCall2`, ler `errno` ou
   `GetLastError`, avaliar `detect`, montar o record com `build_record` (`code_generator_errors.djinn`) e entregar a
   `finish_throwing_call` (`code_generator_error_propagation.djinn`).
6. `runtime/djinn_runtime.h`/`.c`: `__djinn_errno_get`, `__djinn_errno_set`, `__djinn_last_error`, `noinline` e **sem**
   atributo `const` (a função do glibc `__errno_location` é `const` e o endereço TLS poderia ser reutilizado entre
   retomadas de coroutine).
7. `support/source/diagnostic_code.djinn`: atributo em não-`extern`, `capture` desconhecido, `detect` não booleano,
   `return_code` sem retorno inteiro, `extern` anotado sem `throws`.
8. `semantic/symbols/symbol_table.djinn` (equivalência de redeclaração): estratégias diferentes são divergência.
9. `std`: `OsError` com `message()` (`strerror` / `FormatMessage`).

**Fronteira `.djlib`:** nenhuma serialização nova. A interface mantém as declarações `extern` e seus atributos
verbatim, e o wrapper é gerado no ponto da chamada, no consumidor. O checker do atributo precisa rodar também sobre
fontes de cabeçalho.

### A.6 O que uma implementação exigiria (AGENTS.md)

- Suíte `tests/conformance/src/suites/ffi_errors.djinn`: `remove` de arquivo inexistente devolve `ENOENT` (2) via
  `try` e `switch`; `fopen` na estratégia `null`; caminho de sucesso; `emits_ir` mostrando a leitura de `errno` logo
  depois da chamada; um caso de diagnóstico por código novo; chamada sem `try` reaproveita o erro existente de
  `check_throwing_call`.
- Caso em `tests/conformance/src/suites/library.djinn` com um `extern` anotado consumido de uma `.djlib`.
- `djinnc/SUBSET.md` (Atributos e Erros) e `docs/content/docs/advanced/extern.mdx` no submódulo `docs`, em commit
  próprio mais o ponteiro atualizado.

### A.7 Relação com o restante deste documento

Não é contrato: é um **adaptador de falha nativa**. Ele ajuda a camada de providers (§9.4) porque converte falha
silenciosa em erro tipado, mas o resto da proposta não depende dele.

---

## Apêndice B — Diagnósticos propostos

A faixa numérica de verificação ainda precisa ser escolhida contra `diagnostic_code.djinn`. Os nomes abaixo são
simbólicos; a coluna da direita mapeia os códigos do compilador C++ antigo para facilitar a portabilidade dos casos de
teste.

| Nome simbólico | Significado | Código antigo (C++) |
|---|---|---|
| `CONTRACT_CALL_VIOLATES_REQUIRE` | Um chamador viola provadamente uma `require` | E-CONTRACT-007 |
| `CONTRACT_CLAIM_MISMATCH` | `reads`/`writes`/`effects` declarados divergem do inferido | E-CONTRACT-011 |
| `CONTRACT_RETRY_UNSAFE_EFFECT` | `retry allowed` com efeito irreversível na janela | E-CONTRACT-042 |
| `CONTRACT_ORDER_CYCLE` | Duas funções ordenam a mesma chave em sentidos opostos | E-CONTRACT-043 |
| `CONTRACT_INVARIANT_BROKEN` | Um método quebra o invariante em algum caminho de retorno | E-CONTRACT-044 |
| `CONTRACT_STRATEGY_IMPURE` | Chamada impura antes do commit numa estratégia que não a admite | E-CONTRACT-045 |
| `CONTRACT_UNPROVABLE` | Cláusula `prove` que o verificador não consegue provar | E-CONTRACT-046 |
| `ATOMIC_UNPROTECTED_WRITE` | Escrita em caminho atômico fora da proteção da estratégia | E-CONTRACT-053 |
| `REGION_SUSPENDS` | Região `cooperative` alcança `await` ou `coro.suspend` | novo |
| `WRITE_SET_OPAQUE` | Região contém escrita por ponteiro bruto/`unsafe` não declarada | novo |
| `WRITE_SET_DISPOSABLE` | Tipo `DISPOSABLE` no write-set | novo |
| `EFFECT_UNDECLARED_PUBLIC` | API pública de biblioteca sem effects declarados | novo |
| `PROVIDER_GUARANTEE_MISSING` | A especificação exige garantia que o provider não declara | novo |
| `PIVOT_ORDER` | Mais de um pivô, ou passo compensável depois do pivô | novo |
| `UNKNOWN_UNHANDLED` | Resultado `Unknown` sem tratamento ou sem reconciliação | novo |
| `TRANSITION_INVALID` | Transição fora da tabela `[Transitions]` | novo |
| `ASSUME_NO_JUSTIFICATION` | `assume` sem motivo | novo |
| `RACE_CHECK_AWAIT_ACT` (aviso) | Leitura, `await`, escrita do mesmo caminho sem região | novo |
| `TOCTOU_PATH_API` (aviso) | Uso de API por path onde há API por handle | novo |

Os códigos antigos 9509, 9512, 9513, 9515, 9516 e 9517 (`commit` duplicado, `uow` desconhecida ou vazia, rollback
não coberto, `ContractViolation` não capturada, cobertura de `throws` em membros) **deixam de existir** porque as
construções que os geravam foram descartadas (§7.2).

---

## Apêndice C — Decisões tomadas e perguntas em aberto

### C.1 Decisões deste documento (e o que revisam da especificação antiga)

| # | Decisão | Revisa |
|---|---|---|
| 1 | `check` é o modo padrão; o verificador elide o que prova | "Ghost por padrão" (decisão 1 da spec antiga) |
| 2 | Violação de cláusula é **trap**; só vira valor se a função declara `throws(ContractViolation)` | Decisão 21 (capturar `ContractViolation` em membros de uow) |
| 3 | `uow` e `state` não entram na v1; `atomic` + cláusulas + genéricos | Decisão 7 |
| 4 | `commit`/`rollback` explícitos e `before_commit` descartados; rollback automático | Decisão 19 |
| 5 | `catch` como sufixo descartado | Decisão 17 |
| 6 | `lock(...) { }` vira estratégia `lock` mais API | Decisão 20 |
| 7 | Primeira estratégia de concorrência é `cooperative` | novo |
| 8 | Typestate por genéricos e move; tabela de transições por atributo | novo |
| 9 | Cinco categorias de garantia, com proveniência | novo |
| 10 | `delegated` só com provider declarado e testado | novo |
| 11 | Sem polimorfismo de effects | Confirma a spec antiga |
| 12 | `retry: disabled` por padrão | Confirma a decisão 11 |
| 13 | Propagação padrão `join` | Confirma a decisão 13 |
| 14 | #55 é feature independente | novo |

### C.2 Perguntas em aberto

- **Nome:** "spec", "contract" ou outro, dada a colisão com interfaces.
- **Move-only:** atributo `[MoveOnly]`, `Disposable` sem recurso, ou outra regra em `Ownership.derive`?
- **`Restorable`:** contrato exato (`snapshot`/`restore`), custo e interação com `Disposable`.
- **`after_commit` sem closures:** bloco com sintaxe própria (proposto) ou adiar até existirem blocos como argumento.
- **Compensação como `Disposable`:** `dispose` hoje não é assíncrono nem falha; estender ou criar guarda própria?
- **Providers:** sintaxe da declaração (`[Guarantees]` em struct) e como o kit de conformance é publicado.
- **Faixa de diagnósticos** e **saída JSON** (`--diagnostics=json` não existe hoje).
- **Premissa do scheduler:** quando o pool de threads passar a executar coroutines, o que o compilador faz com as
  obrigações `cooperative` já emitidas.
- **Effects explícitos:** quão estrito exigir em API pública (todo ou só funções com efeito).
- **Savepoints:** interação de `propagation: savepoint` com falha após `before_commit`.
- **Região atravessando `await` e threads** (§7.12).
- **Mapeamento entidade-tabela** na estratégia `database` e quem é dono do esquema.
- **`external_io` por chamada ou por função** na classificação de effects.
- **UOW distribuída, sagas, compensação** como biblioteca ou como documento próprio posterior.
- **Capabilities no tipo** (ausência de data race entre threads): documento v2.

---

## Apêndice D — O que foi absorvido do branch `feature/exceptions`

O branch `origin/feature/exceptions` (último commit `8149215`) implementa, **em C++**, `require`/`ensure` com modos,
`invariant`, `old()`, as seções semânticas (`reads`, `writes`, `access`, `atomic`, `isolation`, `ordering`, `retry`,
`effects`, `strategy`, `propagation`), `uow` com membros e `commit`/`rollback`, `lock(...) { }` e `try/catch/finally`
com exceções reais em MSVC. Tudo isso é **referência de semântica**, não código a portar.

| Aspecto | Estado no branch | Uso aqui |
|---|---|---|
| Verificador | Aritmética linear inteira própria (fatos, intervalos, ponto fixo interprocedural com orçamento); **interface SMT sem backend** | A ideia do fragmento afim e do orçamento; o SMT é só um plano |
| Inferência de effects | Tabela embutida de funções da libc e ponto fixo | Base para §4.4; em `djinnc` a tabela vira `[Effects]` no `std` |
| Rollback | Cópias rasas de struct por *alloca* e restauração na ordem inversa | Mesma ideia (§7.3), mas automática e com `Ownership` |
| Locks | Mutex recursivo por thread, tabela global por endereço (O(n), sem remoção) | Descartado (§7.5) |
| Motor de transação | **Inexistente**: nenhum begin/commit/abort, undo log, retry ou isolamento em runtime; `isolation`, `propagation`, `strategy: database` são só vocabulário | Mostra que o motor precisa ser projetado, não portado |
| Exceções | Funclets MSVC (`invoke`, `catchpad`), só Windows | Não se aplica: `djinnc` não tem unwinding |
| Testes | 38 cenários em `tests/verification/phase3.cpp` mais `phase2`, `interproc`, `scaffolding`; demos `bank-valid`, `bank-invalid`, `bank-uow`, `bank-uow-invalid` | Portar os **cenários** como casos de `tests/conformance/src/suites/` |

**Problemas do branch a não repetir:**

- contratos eram ignorados em funções async (auditoria da própria `VERIFICATION-IDEAS.md`, §5.1): em `djinnc`, cláusulas
  valem em funções async desde o primeiro dia;
- blocos de fase só eram emitidos na saída por queda (um `return` explícito parece pulá-los; inferido pela leitura do
  código, não testado);
- códigos de diagnóstico declarados e nunca emitidos (9508, 9510, 9511);
- documentação e implementação em branches separados, com dois arquivos de especificação que nunca chegaram a `master`.

**Destino dos documentos antigos:** `VERIFICATION-SPEC.md` e `VERIFICATION-IDEAS.md` ficam no branch como histórico;
este arquivo é a referência de `master`.
