# Triagem dos testes gtest

Gerado por `tests/conformance/port_gtests.py` e depois fechado à mão: cada `TEST` foi extraído e executado no djinnc, e a decisão sai do
resultado. Os fontes C++ saíram do repositório (estão em `31b1a47^`), então a tabela agora é mantida à mão. Só entram testes em Djinn.
Os 45 bloqueados dependem de recursos que o djinnc ainda não tem (contratos, tipos non-zero, ponteiros anuláveis, `nint` com sufixos).

| Decisão | Testes | O que significa |
|---|---|---|
| Portar | 459 | Passa no djinnc; está em `tests/conformance/src/suites`, como `[Test]`. |
| Reescrito | 119 | O comportamento importa e o teste foi reescrito à mão (IR, avaliação constante, pilha, vários arquivos); o destino está no motivo. |
| Reescrever | 0 | O comportamento importa, mas o teste ainda precisa de outra forma. |
| Bloqueado | 45 | O djinnc não reproduz o comportamento; falta decidir se implementa ou se o recurso sai. |
| Descartar | 100 | Interno do stage0 ou duplicado. |

## O que bloqueia

| Lacuna | Testes |
|---|---|
| contratos | 20 |
| tipos non-zero | 10 |
| `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável | 7 |
| `nint` não tem `MAX_VALUE` nem sufixos de overflow | 3 |
| ponteiro anulável | 2 |
| `str` não define `get[]` | 1 |
| `impl i32 { static ... }` não é chamável como `i32.clamp(...)`: o djinnc lê `i32` como variável | 1 |
| o djinnc aceita `mut const` sem erro | 1 |

## aggregates

| Teste | Decisão | Motivo |
|---|---|---|
| Destructuring.BasicStructFields | Descartar | desestruturação é proibida no djinnc (`SUBSET.md`, Forbidden) |
| Destructuring.VariablesVisibleInEnclosingScope | Descartar | desestruturação é proibida no djinnc (`SUBSET.md`, Forbidden) |
| Destructuring.SingleField | Descartar | desestruturação é proibida no djinnc (`SUBSET.md`, Forbidden) |
| Destructuring.FromExpression | Descartar | desestruturação é proibida no djinnc (`SUBSET.md`, Forbidden) |
| Destructuring.BareBlockStillIntroducesScope | Portar | erro E3002 |
| Enum.SimpleDefinition | Portar | exit code 0 |
| Enum.VariantConstruction | Portar | exit code 0 |
| Enum.VariantWithPayload | Portar | exit code 0 |
| Enum.MultiplePayloadTypes | Portar | exit code 0 |
| Enum.VariantWithMultipleFields | Portar | exit code 0 |
| Enum.GenericOptional | Portar | exit code 0 |
| Enum.GenericResult | Portar | exit code 0 |
| Enum.GenericWithPointerType | Portar | exit code 0 |
| Enum.GenericWithFloatType | Portar | exit code 0 |
| Enum.GenericMultipleInstantiations | Portar | exit code 0 |
| Enum.PatternMatchBasic | Portar | exit code 69 |
| Enum.PatternMatchEmpty | Portar | exit code -1 |
| Enum.PatternMatchResult | Portar | exit code 42 |
| Enum.PatternMatchResultError | Portar | exit code 7 |
| Enum.PatternMatchWithComputation | Portar | exit code 21 |
| Enum.PatternMatchNoPayload | Portar | exit code 2 |
| Enum.PatternMatchInFunction | Portar | exit code 149 |
| Enum.PatternMatchWildcardArm | Portar | exit code -1 |
| Hash.I32HashIsIdentity | Portar | exit code 42 |
| Hash.U8HashIsIdentity | Portar | exit code 20 |
| Hash.I16HashIsIdentity | Portar | exit code 99 |
| Hash.U16HashIsIdentity | Portar | exit code 150 |
| Hash.I8HashIsIdentity | Portar | exit code 77 |
| Hash.U32HashIsIdentity | Portar | exit code 55 |
| Hash.I64HashProducesNonZero | Portar | exit code diferente de zero |
| Hash.U64HashProducesNonZero | Portar | exit code diferente de zero |
| Hash.128HashProducesNonZero | Portar | exit code diferente de zero |
| Hash.U128HashProducesNonZero | Portar | exit code diferente de zero |
| Hash.HexLiteralHash | Portar | exit code 255 |
| Hash.BinaryLiteralHash | Portar | exit code 42 |
| IndexAccess.BasicRead | Portar | exit code 20 |
| IndexAccess.Write | Portar | exit code 42 |
| IndexAccess.WithMalloc | Portar | exit code 30 |
| IndexAccess.I8Pointer | Portar | exit code 65 |
| Str.LiteralCreatesStrStruct | Portar | exit code 5 |
| Str.EmptyLiteral | Portar | exit code 0 |
| Str.CoercionToI8PtrForPrintf | Portar | exit code 0 |
| Str.DirectLiteralCoercion | Portar | exit code 0 |
| Str.LenField | Portar | exit code 10 |
| Str.IsEmptyMethodTrue | Portar | exit code 1 |
| Str.IsEmptyMethodFalse | Portar | exit code 0 |
| Str.IndexAccess | Bloqueado | `str` não define `get[]` |
| Str.PassAsParameter | Portar | exit code 4 |
| Arr.LiteralCreatesArrStruct | Portar | exit code 3 |
| Arr.IndexRead | Portar | exit code 20 |
| Arr.IndexWrite | Portar | exit code 99 |
| Arr.LenField | Portar | exit code 5 |
| Arr.IsEmptyMethodFalse | Portar | exit code 0 |
| Arr.SumElements | Portar | exit code 100 |
| Arr.WithPrintf | Portar | exit code 15 |
| FixedArray.BasicAllocation | Portar | exit code 42 |
| FixedArray.WriteAndReadMultiple | Portar | exit code 60 |
| FixedArray.WithConstSize | Descartar | `const` local não existe; `constexpr` no tamanho do array é coberto por CompileTime ConstExprUsedInArraySize |
| FixedArray.LoopFill | Portar | exit code 30 |
| FixedArray.LargeBuffer | Portar | exit code 99 |
| String.StructDefinition | Portar | exit code 0 |
| String.IsEmptyMethod | Portar | exit code 1 |
| String.CapacityField | Portar | exit code 16 |
| Struct.Definition | Portar | exit code 0 |
| Struct.BraceInitializerPositional | Portar | exit code 0 |
| Struct.BraceInitializerDesignated | Portar | exit code 0 |
| Struct.FieldAccess | Portar | exit code 42 |
| Struct.FieldAccessSecondField | Portar | exit code 99 |
| Struct.MethodReturnWithBraceInit | Portar | exit code 30 |
| Struct.AutoInferStructType | Portar | exit code 77 |
| Struct.MultipleFieldsPositional | Portar | exit code 6 |
| Struct.FieldAccessInExpression | Portar | exit code 5 |
| Struct.StructAsParameter | Portar | exit code 123 |
| Struct.SimpleBraceInitScalar | Reescrito | `language_rules.djinn` StructRuleTests.a_scalar_cannot_be_built_with_braces |
| Impl.ConstFieldOnPrimitive | Portar | exit code 214 |
| Impl.ConstFieldWithArithmetic | Portar | exit code 36 |
| Impl.MethodOnStruct | Portar | exit code 42 |
| Impl.ConstAndMethodTogether | Portar | exit code 30 |
| Impl.StaticMethodOnPrimitive | Bloqueado | `impl i32 { static ... }` não é chamável como `i32.clamp(...)`: o djinnc lê `i32` como variável |

## arithmetic

| Teste | Decisão | Motivo |
|---|---|---|
| Math.IntegerDivFunction | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Math.IntegerDiv | Portar | exit code 5 |
| Math.IntegerDivWithRemainder | Portar | exit code 3 |
| Math.Sqrt | Portar | exit code 4 |
| Math.SqrtFloat | Portar | exit code 5 |
| Math.Pow | Portar | exit code 8 |
| Math.Floor | Portar | exit code 3 |
| Math.Ceil | Portar | exit code 4 |
| Math.Round | Portar | exit code 4 |
| Math.Fabs | Portar | exit code 42 |
| Math.Fmax | Portar | exit code 20 |
| Math.Fmin | Portar | exit code 5 |
| Math.Cbrt | Portar | exit code 3 |
| Math.Exp | Portar | exit code 7 |
| Math.Log | Portar | exit code 1 |
| Math.Log10 | Portar | exit code 3 |
| Math.Log2 | Portar | exit code 3 |
| Math.Fmod | Portar | exit code 1 |
| Math.Hypot | Portar | exit code 5 |
| Math.Trunc | Portar | exit code 7 |
| Math.Exp2 | Portar | exit code 16 |
| Math.ImportMathSqrt | Portar | exit code 7 |
| Math.ImportMathPow | Portar | exit code 9 |
| Math.ImportMathMultipleFunctions | Portar | exit code 10 |
| Math.ImportMathFloatFunctions | Portar | exit code 6 |
| Math.CombinedMathOperations | Portar | exit code 5 |
| Math.IntegerMultFunction | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Math.IntegerMult | Portar | exit code 6 |
| Numbers.MultipleNumbersDeclaration | Portar | compila sem erros |
| Numbers.CompileTimeOverflowCheck | Descartar | aceitava literais fora da faixa, que agora são erro; coberto por `errors/literal_out_of_range` |
| Overflow.SuffixDeclarationsCompile | Portar | compila sem erros |
| Overflow.WrappedIsPlainAdd | Reescrito | `OverflowIrTests.WrappedIsPlainAdd` |
| Overflow.TrappedEmitsOverflowCheck | Descartar | coberto por `overflow.djinn` OverflowModeTests.trapped_add_panics |
| Overflow.TrappedRuntimeOverflowAborts | Descartar | coberto por `overflow.djinn` OverflowModeTests.trapped_add_panics |
| Overflow.CheckedRequiresThrows | Portar | erro E9003 |
| Overflow.CheckedWithThrowsSetsErrorFlag | Descartar | coberto por `overflow.djinn` OverflowModeTests.checked_overflow_is_caught_by_try |
| Overflow.SaturatingUsesSatIntrinsic | Descartar | coberto por `overflow.djinn` OverflowModeTests.saturating_add_clamps |
| Overflow.SaturatingRuntimeAddClampsToMax | Portar | exit code 2 |
| Overflow.SaturatingLiteralClampsAtCompileTime | Portar | exit code 2 |
| Overflow.TrappedLiteralOutOfRangeIsCompileError | Portar | erro E3051 |
| Overflow.WrappedLiteralOutOfRangeStillCompiles | Portar | compila sem erros |
| Overflow.ConflictingModesAreRejected | Portar | erro E3055 |
| Overflow.PostfixIncrementRespectsMode | Portar | exit code 2 |
| Overflow.FloatTypeSuffixIsRejected | Descartar | `f32w` nem é um tipo no djinnc; o lexer devolve erro de sintaxe |
| Overflow.WrappedLiteralKeepsCStyleValue | Portar | exit code 1294967296 |
| Overflow.HexLiteralSuffixCompiles | Portar | exit code 1 |
| Overflow.HexDigitCIsNotASuffix | Portar | exit code 28 |
| Overflow.BinaryLiteralSuffix | Portar | exit code 10 |
| Overflow.CompoundAssignmentSaturates | Portar | exit code 2 |
| Overflow.CompoundAssignmentTrappedAborts | Descartar | coberto por `overflow.djinn` OverflowModeTests.trapped_compound_assignment_panics |
| Overflow.UnaryNegateSaturatesMinToMax | Portar | exit code 2 |
| Overflow.UnaryNegateTrappedAborts | Descartar | coberto por `overflow.djinn` OverflowModeTests.trapped_negate_minimum_panics |
| Overflow.DivIntMinMinusOneTrappedAborts | Portar | exit code diferente de zero |
| Overflow.SaturatingDivIntMinClampsToMax | Portar | exit code 2 |
| Overflow.SaturatingRemIntMinIsZero | Portar | exit code 5 |
| Overflow.SaturatingSubClampsToMin | Portar | exit code 2 |
| Overflow.SaturatingMulClampsToMax | Portar | exit code 2 |
| Overflow.UnsignedSaturatingSubClampsToZero | Descartar | coberto por `overflow.djinn` OverflowModeTests.saturating_unsigned_clamps_both_ends |
| Overflow.UnsignedTrappedAddAborts | Descartar | coberto por `overflow.djinn` OverflowModeTests.trapped_unsigned_subtract_panics |
| Overflow.ConstexprSaturatingAdd | Portar | exit code 2 |
| Overflow.ConstevalTrappedOverflowIsError | Portar | erro E3051 |
| Overflow.NestedModePropagationSaturates | Portar | exit code 2 |
| Overflow.CheckedOverflowCaughtByTryFallback | Portar | exit code 1 |
| Overflow.CheckedNoOverflowReturnsValue | Portar | exit code 1032 |
| Overflow.ModeIsNotTypeIdentity | Portar | exit code 100 |
| Overflow.StructFieldWithMode | Portar | exit code 42 |
| Math.IntegerSubFunction | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Math.IntegerSub | Portar | exit code 7 |
| Math.IntegerSubNegative | Portar | exit code -7 |
| Math.IntegerSumFunction | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Math.IntegerSum | Portar | exit code 5 |
| Math.IntegerSumWithAnonStructReturn | Descartar | struct anônimo no retorno não existe no djinnc |

## async

| Teste | Decisão | Motivo |
|---|---|---|
| Async.SimpleReturnValue | Portar | exit code 42 |
| Async.WithParameter | Portar | exit code 42 |
| Async.MultipleParameters | Portar | exit code 42 |
| Async.ExpressionComputation | Portar | exit code 21 |
| Async.AsyncMain | Portar | exit code 99 |
| Async.AsyncMainWithComputation | Portar | exit code 25 |
| Async.DiagnosticsForNonWaitableAsync | Portar | erro E3053 |
| Async.MultipleAwaitsSequential | Portar | exit code 30 |
| Async.ThreeAwaitsAccumulate | Portar | exit code 60 |
| Async.ChainedAwait | Portar | exit code 15 |
| Async.DeepChaining | Portar | exit code 13 |
| Async.ChainedAsyncMain | Portar | exit code 35 |
| Async.AwaitResultAsArgument | Portar | exit code 20 |
| Async.AwaitWithLocalComputation | Portar | exit code 33 |
| Async.Yield_BasicYield | Descartar | `yield` não existe no djinnc (`SUBSET.md`) |
| Async.Yield_MultipleYields | Descartar | `yield` não existe no djinnc (`SUBSET.md`) |
| Async.Yield_WithComputation | Descartar | `yield` não existe no djinnc (`SUBSET.md`) |
| Spawn.BasicSpawnParse | Reescrito | `SpawnIrTests.BasicSpawnParse` |
| EventLoop.AsyncMainGeneratesRuntimeCalls | Reescrito | `EventLoopIrTests.AsyncMainGeneratesRuntimeCalls` |
| EventLoop.CoroWrappersGenerated | Reescrito | `EventLoopIrTests.CoroWrappersGenerated` |
| Async.NonAsyncMainStillWorks | Portar | exit code 77 |
| Async.NonAsyncMainWithRuntime | Reescrito | `AsyncIrTests.NonAsyncMainWithRuntime` |
| Spawn.MultipleSpawnsParse | Portar | compila sem erros |
| Spawn.WithYieldParse | Descartar | `yield` não existe no djinnc (`SUBSET.md`) |

## compile_time

| Teste | Decisão | Motivo |
|---|---|---|
| Attributes.ForceInlineGeneratesAlwaysInline | Reescrito | `AttributesIrTests.ForceInlineGeneratesAlwaysInline` |
| Attributes.NoInlineGeneratesNoInline | Reescrito | `AttributesIrTests.NoInlineGeneratesNoInline` |
| Attributes.NoReturnAttribute | Reescrito | `AttributesIrTests.NoReturnAttribute` |
| Attributes.ColdAttribute | Reescrito | `AttributesIrTests.ColdAttribute` |
| Attributes.ParameterizedAttributeParses | Portar | compila sem erros |
| Attributes.NamedParameterAttributeParses | Portar | compila sem erros |
| Attributes.MultipleAttributesOnMethod | Reescrito | `AttributesIrTests.MultipleAttributesOnMethod` |
| Attributes.ImplicitNounwindOnAllFunctions | Reescrito | `AttributesIrTests.ImplicitNounwindOnAllFunctions` |
| Attributes.LlvmEscapeHatch | Reescrito | `AttributesIrTests.LlvmEscapeHatch` |
| Attributes.ErrorOnUnknownAttribute | Portar | erro E8002 |
| Attributes.ErrorOnUnknownStructAttribute | Portar | erro E8002 |
| Attributes.WarningWhenFunctionAttributeOnStruct | Portar | aviso E8001 |
| Attributes.WarningWhenStructAttributeOnMethod | Descartar | `[Align]` vale em função no djinnc (CompileTime AlignOnFunctionSetsFunctionAlignment) |
| Attributes.NoWarningWhenAttributeOnValidTarget | Portar | compila sem erros |
| Attributes.DeprecatedValidOnAnyTarget | Portar | compila sem erros |
| ConstEvalVM.IntegerLiteral | Reescrito | `ConstEvalVMTests.IntegerLiteral` |
| ConstEvalVM.FloatLiteral | Reescrito | `ConstEvalVMTests.FloatLiteral` |
| ConstEvalVM.BooleanLiteral | Reescrito | `ConstEvalVMTests.BooleanLiteral` |
| ConstEvalVM.BooleanFalseLiteral | Reescrito | `ConstEvalVMTests.BooleanFalseLiteral` |
| ConstEvalVM.HexLiteral | Reescrito | `ConstEvalVMTests.HexLiteral` |
| ConstEvalVM.BinaryLiteral | Reescrito | `ConstEvalVMTests.BinaryLiteral` |
| ConstEvalVM.SeparatorLiteral | Reescrito | `ConstEvalVMTests.SeparatorLiteral` |
| ConstEvalVM.TickSeparatorLiteral | Reescrito | `ConstEvalVMTests.TickSeparatorLiteral` |
| ConstEvalVM.NegativeZero | Reescrito | `ConstEvalVMTests.NegativeZero` |
| ConstEvalVM.Addition | Reescrito | `ConstEvalVMTests.Addition` |
| ConstEvalVM.Subtraction | Reescrito | `ConstEvalVMTests.Subtraction` |
| ConstEvalVM.Multiplication | Reescrito | `ConstEvalVMTests.Multiplication` |
| ConstEvalVM.Division | Reescrito | `ConstEvalVMTests.Division` |
| ConstEvalVM.Modulo | Reescrito | `ConstEvalVMTests.Modulo` |
| ConstEvalVM.DivisionByZero | Reescrito | `ConstEvalVMTests.DivisionByZero` |
| ConstEvalVM.ModuloByZero | Reescrito | `ConstEvalVMTests.ModuloByZero` |
| ConstEvalVM.UnaryNegate | Reescrito | `ConstEvalVMTests.UnaryNegate`; só o link: no JIT, `X == -42` com `constexpr i32 X = -42` dá falso (o link dá verdadeiro) |
| ConstEvalVM.DoubleNegate | Reescrito | `ConstEvalVMTests.DoubleNegate` |
| ConstEvalVM.NestedArithmetic | Reescrito | `ConstEvalVMTests.NestedArithmetic` |
| ConstEvalVM.ComplexNestedArithmetic | Reescrito | `ConstEvalVMTests.ComplexNestedArithmetic` |
| ConstEvalVM.LessThan | Reescrito | `ConstEvalVMTests.LessThan` |
| ConstEvalVM.LessThanFalse | Reescrito | `ConstEvalVMTests.LessThanFalse` |
| ConstEvalVM.GreaterThan | Reescrito | `ConstEvalVMTests.GreaterThan` |
| ConstEvalVM.LessEqual | Reescrito | `ConstEvalVMTests.LessEqual` |
| ConstEvalVM.GreaterEqual | Reescrito | `ConstEvalVMTests.GreaterEqual` |
| ConstEvalVM.Equality | Reescrito | `ConstEvalVMTests.Equality` |
| ConstEvalVM.Inequality | Reescrito | `ConstEvalVMTests.Inequality` |
| ConstEvalVM.LogicAnd | Reescrito | `ConstEvalVMTests.LogicAnd` |
| ConstEvalVM.LogicOr | Reescrito | `ConstEvalVMTests.LogicOr` |
| ConstEvalVM.LogicalNot | Reescrito | `ConstEvalVMTests.LogicalNot` |
| ConstEvalVM.LogicalNotFalse | Reescrito | `ConstEvalVMTests.LogicalNotFalse` |
| ConstEvalVM.NamedConstant | Reescrito | `ConstEvalVMTests.NamedConstant` |
| ConstEvalVM.NamedConstantInExpression | Reescrito | `ConstEvalVMTests.NamedConstantInExpression` |
| ConstEvalVM.MultipleNamedConstants | Reescrito | `ConstEvalVMTests.MultipleNamedConstants` |
| ConstEvalVM.UnknownIdentifierReturnsError | Reescrito | `ConstEvalVMTests.UnknownIdentifierReturnsError` |
| ConstEvalVM.MaxIterationsExceeded | Reescrito | `ConstEvalVMTests.MaxIterationsExceeded` |
| ConstEvalVM.StackOverflowProtection | Reescrito | `ConstEvalVMTests.StackOverflowProtection` |
| ConstExpr.SimpleConstExprVariable | Portar | exit code 42 |
| ConstExpr.ConstExprDependingOnLaterDeclaration | Portar | exit code 41 |
| ConstExpr.ConstExprWithArithmetic | Portar | exit code 35 |
| ConstExpr.ConstExprMultiplication | Portar | exit code 192 |
| ConstExpr.ConstExprNegative | Portar | exit code 42 |
| ConstExpr.ConstExprUsedInArraySize | Portar | exit code 99 |
| ConstExpr.ConstFieldUsedInExpression | Portar | exit code 99 |
| ConstExpr.ConstFieldWithArithmetic | Portar | exit code 192 |
| ConstExpr.ConstExprFunctionCompiles | Portar | compila sem erros |
| ConstExpr.ConstExprFunctionResult | Portar | exit code 42 |
| ConstExpr.LocalConstExprVariable | Portar | exit code 42 |
| ConstExpr.LocalConstevalVariable | Portar | exit code 42 |
| ConstExpr.LocalConstExprUsedInExpression | Portar | exit code 30 |
| ConstExpr.LocalConstExprInArraySize | Portar | exit code 77 |
| ConstExpr.GlobalConstevalVariable | Portar | exit code 7 |
| ConstExpr.InvalidConstExprAndAsyncModifier | Portar | erro E2001 |
| CompileTimeIf.TrueBranch | Portar | exit code 42 |
| CompileTimeIf.FalseBranch | Portar | exit code 42 |
| CompileTimeIf.FalseBranchWithElse | Portar | exit code 42 |
| CompileTimeIf.TrueBranchWithElse | Portar | exit code 42 |
| CompileTimeIf.BinaryExpression | Portar | exit code 42 |
| CompileTimeIf.CompoundExpression | Portar | exit code 42 |
| CompileTimeIf.ElseIfChain | Portar | exit code 42 |
| CompileTimeIf.WarningOnConstExprInRuntimeIf | Portar | exit code 42 |
| CompileTimeIf.NoWarningOnRuntimeVariable | Portar | exit code 42 |
| CompileTimeIf.ErrorOnNonConstExprWithoutParens | Portar | erro E3051 |
| CompileTimeIf.LiteralCondition | Portar | exit code 42 |
| CompileTimeIf.DeadCodeEliminated | Portar | exit code 10 |
| CompileTimeIf.ExplicitConstexprKeyword | Portar | exit code 42 |
| CompileTimeIf.ExplicitConstevalKeyword | Portar | exit code 42 |
| CompileTimeIf.ConstevalErrorOnRuntimeExpr | Portar | erro E3051 |
| CompileTimeIf.ExplicitConstexprWithElseIf | Portar | exit code 42 |
| CompileTimeIf.NoWarningOnMixedExpr | Portar | exit code 42 |
| Intrinsic.IntrinsicConstevalVariable | Descartar | variável `[intrinsic] consteval` era do stage0; `Target.is_debug()` a substitui |
| Intrinsic.ConstexprStructFieldAccess | Portar | exit code 42 |
| Intrinsic.ConstexprStructAllFieldsAreConst | Portar | exit code 99 |
| Contracts.RequirePasses | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.RequireViolationThrowsContractViolation | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.EnsurePasses | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.EnsureViolationThrowsContractViolation | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.MultipleClauses | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.RequireBlockForm | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.ContractCallSiteRequiresTry | Bloqueado | contratos (`require`/`ensure`) (o erro atual tem outro motivo) |
| Contracts.ContractViolationPropagatesThroughThrows | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.RequireConstantViolationIsCompileError | Bloqueado | contratos (`require`/`ensure`) (o erro atual tem outro motivo) |
| Contracts.RuntimeArgumentsSkipCompileTimeAnalysis | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.EnforcementRuntimeKeepsOldBehavior | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.EnforcementStrictRequiresTryEverywhere | Bloqueado | contratos (`require`/`ensure`) (o erro atual tem outro motivo) |
| Contracts.EnforcementStrictAcceptsBareTryPropagation | Bloqueado | contratos (`require`/`ensure`) |
| Contracts.EnforcementOffDisablesAllChecks | Bloqueado | contratos (`require`/`ensure`) |
| Intrinsics.SizeofI32 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_primitives |
| Intrinsics.SizeofI64 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_primitives |
| Intrinsics.SizeofI8 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_primitives |
| Intrinsics.SizeofStruct | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_struct |
| Intrinsics.AlignofI32 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.alignof_is_not_an_intrinsic; `alignof` não existe no djinnc |
| Intrinsics.AlignofI64 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.alignof_is_not_an_intrinsic; `alignof` não existe no djinnc |
| Intrinsics.Likely | Portar | exit code 42 |
| Intrinsics.Unlikely | Portar | exit code 99 |
| Intrinsics.Expect | Descartar | `expect` não existe; `likely`/`unlikely` são cobertos por IntrinsicsTests.Likely e Unlikely |
| Intrinsics.SizeofF32 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_primitives |
| Intrinsics.SizeofF64 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_primitives |
| Intrinsics.SizeofGenericStructI32 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_generic_struct_instances |
| Intrinsics.SizeofGenericStructI64 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_generic_struct_instances |
| Intrinsics.SizeofGenericStructPoint | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_generic_struct_instances |
| Intrinsics.TypeofI32 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.typeof_reports_the_kind_of_a_type |
| Intrinsics.TypeofF64 | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.typeof_reports_the_kind_of_a_type |
| Intrinsics.TypeofStruct | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.typeof_reports_the_kind_of_a_type |
| Macro.SimpleExprMacro | Portar | aviso E6001 |
| Macro.MultipleParameters | Portar | exit code 42 |
| Macro.PrecedencePreserved | Portar | exit code 25 |
| Macro.LocalAvoidsDoubleEvaluation | Portar | exit code 1 |
| Macro.WithoutLocalCausesDoubleEvaluation | Portar | aviso E6001 |
| Macro.LocalWithArithmeticExpression | Portar | exit code 49 |
| Macro.MixedLocalAndNonLocal | Portar | exit code 19 |
| Macro.NestedMacroCall | Portar | exit code 25 |
| Macro.WarnOnPossibleSideEffect | Portar | exit code 25 |
| Macro.NoWarnWhenLocalUsed | Portar | exit code 25 |
| Macro.NoWarnWhenSingleUse | Portar | exit code 42 |
| Macro.MacroStoredInProgram | Portar | exit code 10 |
| Macro.MultiRuleByArity | Portar | exit code 25 |
| Macro.AmbiguousRulesError | Portar | erro E6000 |
| Macro.MultiRuleNoMatch | Portar | erro E6000 |
| Macro.LiteralTokenMatching | Portar | exit code 36 |
| Macro.LiteralTokenNoMatch | Portar | erro E6000 |
| Macro.IdentifierFragment | Portar | exit code 42 |
| Macro.LiteralTokenWithMultiRule | Portar | exit code 33 |
| Macro.RuleLevelLocal | Portar | exit code 5 |
| Macro.LogWithLiteralTokenLevels | Portar | exit code 30 |
| Macro.LogLiteralTokenNoMatchLevel | Portar | erro E6000 |
| Macro.LogMultiRuleWithIdentifier | Portar | exit code 3 |
| Macro.LiteralTokenWithIdentifierAndExpression | Portar | exit code 109 |
| Macro.LiteralTokenPatternMatchingComplex | Portar | exit code 78 |
| Macro.LogPatternLikeRust | Portar | exit code 15 |
| Macro.ConditionalCodegenViaLiteralToken | Portar | exit code 50 |
| Macro.LiteralFragment | Portar | exit code 42 |
| Macro.LiteralFragmentRejectsExpression | Portar | erro E6000 |
| Macro.TypeFragment | Portar | exit code 123 |
| Macro.LiteralTokenWithLiteralFragment | Portar | exit code 1130 |
| StaticVar.SimpleImmutable | Portar | exit code 42 |
| StaticVar.Mutable | Portar | exit code 3 |
| StaticVar.MultipleGlobals | Portar | exit code 42 |
| StaticVar.MutableWithFunctions | Portar | exit code 42 |
| StaticVar.UsedInExpressions | Portar | exit code 42 |
| StaticVar.MutableAccumulator | Portar | exit code 42 |
| StaticVar.MutableRequiresUnsafe | Portar | erro E2001 |
| StaticVar.UnsafeRequiresMutable | Portar | erro E2001 |

## compiler

| Teste | Decisão | Motivo |
|---|---|---|
| Binder.AllowsValidCode | Portar | exit code 30 |
| Binder.VariableDeclarationAndUsage | Portar | exit code 42 |
| Binder.FunctionCallWithCorrectArgs | Portar | exit code 6 |
| Binder.NamespaceQualifiedNames | Portar | compila sem erros |
| Binder.NestedNamespaceQualifiedNames | Portar | compila sem erros |
| Binder.FileScopedNamespaceBinding | Portar | compila sem erros |
| Binder.StructFieldAccess | Portar | exit code 15 |
| Binder.MultipleVariables | Portar | exit code 6 |
| BootstrapSubset.PointerParameterFieldReadWrite | Portar | exit code 42 |
| BootstrapSubset.PointerLocalMethodCall | Portar | exit code 2 |
| BootstrapSubset.PointerParameterInMethod | Portar | exit code 10 |
| BootstrapSubset.NullableLinkedListTraversal | Bloqueado | ponteiro anulável (`T*?`) não compara com `null` nem acessa campo no djinnc |
| BootstrapSubset.LogicalOperatorsShortCircuit | Bloqueado | ponteiro anulável (`T*?`) não compara com `null` nem acessa campo no djinnc |
| BootstrapSubset.PointerArrayOfStructPointers | Portar | exit code 6 |
| BootstrapSubset.StructTypesVisibleAcrossFiles | Reescrito | `BootstrapSubsetFilesTests.StructTypesVisibleAcrossFiles`; sem `namespace`: um tipo de namespace de outro arquivo ainda não resolve (E3001) |
| Diagnostics.BasicError | Descartar | testa a formatação do DiagnosticEngine do stage0 |
| Diagnostics.ErrorWithHelp | Descartar | testa a formatação do DiagnosticEngine do stage0 |
| Diagnostics.MultipleErrors | Descartar | testa a formatação do DiagnosticEngine do stage0 |
| Diagnostics.CodeFormatting | Descartar | testa a formatação do DiagnosticEngine do stage0 |
| FunctionContext.GenericMethodInsideLoopOfContractFunction | Bloqueado | contratos (`require`/`ensure`) |
| FunctionContext.BreakAndContinueAfterGenericInstantiation | Portar | exit code 9 |
| FunctionContext.MonomorphizedStructVisibleToLaterFunctions | Portar | exit code 7 |
| FunctionContext.PointerFieldMethodDispatchThroughAuto | Portar | exit code 9 |
| Determinism.SameSourceProducesIdenticalIr | Portar | compila sem erros |
| ManglerType.Integer8Signed | Descartar | testa o mangler do stage0 |
| ManglerType.Integer16Signed | Descartar | testa o mangler do stage0 |
| ManglerType.Integer32Signed | Descartar | testa o mangler do stage0 |
| ManglerType.Integer64Signed | Descartar | testa o mangler do stage0 |
| ManglerType.Integer32Unsigned | Descartar | testa o mangler do stage0 |
| ManglerType.Integer64Unsigned | Descartar | testa o mangler do stage0 |
| ManglerType.Void | Descartar | testa o mangler do stage0 |
| ManglerType.Float32 | Descartar | testa o mangler do stage0 |
| ManglerType.Float64 | Descartar | testa o mangler do stage0 |
| ManglerType.String | Descartar | testa o mangler do stage0 |
| ManglerType.Pointer | Descartar | testa o mangler do stage0 |
| ManglerType.PointerToPointer | Descartar | testa o mangler do stage0 |
| ManglerType.Array | Descartar | testa o mangler do stage0 |
| ManglerType.Struct | Descartar | testa o mangler do stage0 |
| ManglerType.StructShortName | Descartar | testa o mangler do stage0 |
| ManglerFunction.SimpleName | Descartar | testa o mangler do stage0 |
| ManglerFunction.LongerName | Descartar | testa o mangler do stage0 |
| ManglerFunction.SingleCharName | Descartar | testa o mangler do stage0 |
| ManglerFunction.WithIntParam | Descartar | testa o mangler do stage0 |
| ManglerFunction.WithMultipleParams | Descartar | testa o mangler do stage0 |
| ManglerFunction.WithStructParam | Descartar | testa o mangler do stage0 |
| ManglerFunction.WithPointerParam | Descartar | testa o mangler do stage0 |
| ManglerMethod.SimpleMethod | Descartar | testa o mangler do stage0 |
| ManglerMethod.MethodWithParams | Descartar | testa o mangler do stage0 |
| ManglerMethod.MethodWithMultipleParams | Descartar | testa o mangler do stage0 |
| ManglerMethod.GetterMethod | Descartar | testa o mangler do stage0 |
| ManglerGeneric.StructSingleTypeArg | Descartar | testa o mangler do stage0 |
| ManglerGeneric.StructMultipleTypeArgs | Descartar | testa o mangler do stage0 |
| ManglerGeneric.StructWithStructTypeArg | Descartar | testa o mangler do stage0 |
| ManglerGeneric.NestedGeneric | Descartar | testa o mangler do stage0 |
| ManglerGenericMethod.SimpleMethod | Descartar | testa o mangler do stage0 |
| ManglerGenericMethod.MethodNoParams | Descartar | testa o mangler do stage0 |
| ManglerDemangle.SimpleFunction | Descartar | testa o mangler do stage0 |
| ManglerDemangle.LongerFunction | Descartar | testa o mangler do stage0 |
| ManglerDemangle.Method | Descartar | testa o mangler do stage0 |
| ManglerDemangle.NestedMethod | Descartar | testa o mangler do stage0 |
| ManglerDemangle.NonMangled | Descartar | testa o mangler do stage0 |
| ManglerDemangle.GenericStruct | Descartar | testa o mangler do stage0 |
| Object.TypeInfoStructDefinition | Portar | exit code 1 |
| Object.ObjectStructDefinition | Portar | exit code 0 |
| Object.TypeInfoKindInt | Portar | exit code 0 |
| Object.TypeInfoKindFloat | Portar | exit code 1 |
| Object.TypeInfoKindPointer | Reescrito | `language_rules.djinn` BoxedTextTests.a_string_literal_boxes_as_a_pointer; um literal é `i8*`, kind 2 |
| Object.VariadicMethodCompiles | Portar | exit code 0 |
| Object.VariadicEmptyArgs | Portar | exit code 0 |
| Object.VariadicArgsLength | Portar | exit code 3 |
| Object.VariadicWithNormalParams | Portar | exit code 2 |
| Object.VariadicAccessTypeInfo | Portar | exit code 4 |
| Object.SyncPrintIntViaVariadic | Portar | exit code 42 |
| Object.BoxingIRContainsKind | Reescrito | `ObjectIrTests.BoxingIRContainsKind` |
| Object.AutoBoxPrimitiveToObject | Portar | exit code 0 |
| Object.AutoBoxStringToObject | Reescrito | `language_rules.djinn` BoxedTextTests.a_string_literal_boxes_as_a_pointer; um literal é `i8*`, kind 2 |
| Object.AutoBoxStructToObject | Portar | exit code 8 |
| Object.AutoBoxStructToObjectKind | Portar | exit code 3 |
| Object.AutoBoxFloatToObject | Portar | exit code 1 |
| Object.IsExpressionWithAutoBoxedPrimitive | Portar | exit code 1 |
| Object.IsExpressionBindingWithAutoBoxed | Portar | exit code 99 |
| Object.NoWarningOnLiteralBoxing | Portar | compila sem erros |
| Object.WarningOnVariableBoxing | Descartar | o djinnc não avisa ao empacotar em `object` |
| Object.WarningOnStructBoxing | Descartar | o djinnc não avisa ao empacotar em `object` |

## control_flow

| Teste | Decisão | Motivo |
|---|---|---|
| ControlFlow.IfStatementTrueBranch | Portar | exit code 1 |
| ControlFlow.IfStatementFalseBranch | Portar | exit code 0 |
| ControlFlow.IfElseStatementTrueBranch | Portar | exit code 1 |
| ControlFlow.IfElseStatementFalseBranch | Portar | exit code 2 |
| ControlFlow.IfElseIfElseStatement | Portar | exit code 2 |
| ControlFlow.NestedIfStatements | Portar | exit code 1 |
| ControlFlow.IfWithEquality | Portar | exit code 1 |
| ControlFlow.IfWithNotEqual | Portar | exit code 1 |
| ControlFlow.IfWithLogicalAnd | Portar | exit code 1 |
| ControlFlow.IfWithLogicalOr | Portar | exit code 1 |
| ControlFlow.WhileLoopSimple | Portar | exit code 5 |
| ControlFlow.WhileLoopSum | Portar | exit code 15 |
| ControlFlow.WhileLoopWithBreak | Portar | exit code 5 |
| ControlFlow.WhileLoopWithContinue | Portar | exit code 9 |
| ControlFlow.WhileLoopNeverExecutes | Portar | exit code 10 |
| ControlFlow.DoWhileLoopSimple | Portar | exit code 5 |
| ControlFlow.DoWhileExecutesAtLeastOnce | Portar | exit code 11 |
| ControlFlow.DoWhileWithBreak | Portar | exit code 3 |
| ControlFlow.ForLoopSimple | Portar | exit code 5 |
| ControlFlow.ForLoopPostfix | Portar | exit code 5 |
| ControlFlow.ForLoopSum | Portar | exit code 55 |
| ControlFlow.ForLoopWithBreak | Portar | exit code 5 |
| ControlFlow.ForLoopWithContinue | Portar | exit code 9 |
| ControlFlow.ForLoopNested | Portar | exit code 9 |
| ControlFlow.RangeForSimple | Portar | exit code 5 |
| ControlFlow.RangeForSum | Portar | exit code 55 |
| ControlFlow.RangeForWithBreak | Portar | exit code 5 |
| ControlFlow.RangeForWithContinue | Portar | exit code 9 |
| ControlFlow.RangeForNested | Portar | exit code 12 |
| ControlFlow.RangeForAnonymous | Descartar | o `for` de intervalo do djinnc exige a variável; coberto por ControlFlowTests.RangeFor* |
| ControlFlow.RangeForAnonymousNested | Descartar | o `for` de intervalo do djinnc exige a variável; coberto por ControlFlowTests.RangeFor* |
| ControlFlow.RangeForVariableAccess | Portar | exit code 6 |
| ControlFlow.RangeForInclusiveEnd | Portar | exit code 6 |
| ControlFlow.RangeForInclusiveEndSum | Portar | exit code 55 |
| ControlFlow.RangeForBracketClosed | Portar | exit code 5 |
| ControlFlow.RangeForBracketHalfOpen | Portar | exit code 4 |
| ControlFlow.RangeForBracketClosedSum | Portar | exit code 55 |
| ControlFlow.RangeForAnonymousInclusive | Descartar | o `for` de intervalo do djinnc exige a variável; coberto por ControlFlowTests.RangeFor* |
| ControlFlow.RangeForAnonymousBracketClosed | Descartar | o `for` de intervalo do djinnc exige a variável; coberto por ControlFlowTests.RangeFor* |
| ControlFlow.SwitchStatementCase1 | Portar | exit code 10 |
| ControlFlow.SwitchStatementCase2 | Portar | exit code 20 |
| ControlFlow.SwitchStatementDefault | Portar | exit code 0 |
| ControlFlow.SwitchStatementWithBreak | Portar | exit code 10 |
| ControlFlow.SwitchStatementWithoutDefault | Portar | exit code 10 |
| ControlFlow.FibonacciIterative | Portar | exit code 55 |
| ControlFlow.FactorialIterative | Portar | exit code 120 |
| ControlFlow.NestedLoopsWithBreak | Portar | exit code 15 |
| ControlFlow.WhileWithMultipleConditions | Portar | exit code 10 |
| ErrorHandling.ThrowWithTryFallback | Reescrito | `error_handling.djinn` ThrowsTests.throw_with_try_fallback |
| ErrorHandling.TryReturnsValueOnSuccess | Reescrito | `error_handling.djinn` ThrowsTests.try_returns_value_on_success |
| ErrorHandling.BuiltinExceptionAvailableWithoutStd | Reescrito | `error_handling.djinn` ThrowsTests.builtin_errors_are_available_without_std |
| ErrorHandling.RethrowsPropagation | Reescrito | `error_handling.djinn` ThrowsTests.bare_try_rethrows_to_the_caller |
| ErrorHandling.UncheckedThrowingCallInThrowingCallerPropagates | Reescrito | `error_handling.djinn` ThrowsTests.unchecked_throwing_call_in_a_throwing_caller_propagates |
| ErrorHandling.DerivedErrorAcceptedByBaseThrowsClause | Descartar | tipos de erro não têm hierarquia no djinnc (`SUBSET.md`: um erro é qualquer struct listada em `throws`) |
| ErrorHandling.DerivedErrorAcceptedByIntermediateBase | Descartar | tipos de erro não têm hierarquia no djinnc (`SUBSET.md`: um erro é qualquer struct listada em `throws`) |
| ErrorHandling.ErrorAliasChain | Descartar | tipos de erro não têm hierarquia no djinnc (`SUBSET.md`: um erro é qualquer struct listada em `throws`) |
| ErrorHandling.DivisionByZeroThrowsInThrowingFunction | Portar | exit code -3 |
| ErrorHandling.InterpolatedErrorMessage | Descartar | erros do djinnc não carregam mensagem |
| ErrorHandling.ConsoleFormatBuildsString | Portar | exit code 1 |
| ErrorHandling.MissingTryDiagnostic | Reescrito | `errors.djinn` ErrorsTests.error_missing_try |
| ErrorHandling.ThrowOutsideThrowsDiagnostic | Reescrito | `error_handling.djinn` ThrowsTests.throw_outside_a_throwing_function_is_an_error |
| ErrorHandling.ThrowsTypeMismatchDiagnostic | Reescrito | `errors.djinn` ErrorsTests.error_throw_not_listed |
| ErrorHandling.ThrowNonErrorTypeDiagnostic | Descartar | qualquer struct é um tipo de erro no djinnc; não há o que rejeitar |
| ErrorHandling.TryOnNonThrowingDiagnostic | Portar | erro E9004 |
| ErrorHandling.TryWithoutFallbackOutsideThrowsDiagnostic | Reescrito | `error_handling.djinn` ThrowsTests.bare_try_outside_a_throwing_function_is_an_error |
| ErrorHandling.ConstexprCallThatAlwaysThrowsIsCompileError | Descartar | o djinnc não avalia a chamada para diagnosticar; a chamada lança em tempo de execução |
| ErrorHandling.ConstexprCallInsideTryIsSilentAndTakesFallback | Reescrito | `error_handling.djinn` ThrowsTests.a_constexpr_throwing_call_inside_try_takes_the_fallback |
| ErrorHandling.ConstexprCallWithRuntimeArgumentsStaysRuntime | Reescrito | `error_handling.djinn` ThrowsTests.a_constexpr_throwing_call_with_runtime_arguments_stays_runtime |
| ErrorHandling.ConstexprCallThatSucceedsHasNoDiagnostics | Reescrito | `error_handling.djinn` ThrowsTests.a_constexpr_throwing_call_that_succeeds_compiles_clean; achou um defeito: a chamada `constexpr` dobrada em constante deixava o `try` sem chamada (E9004), corrigido em `type_checker_calls.djinn` |
| ErrorHandling.SwitchOnThrowingCallSuccessArm | Reescrito | `error_handling.djinn` ThrowsTests.switch_on_a_throwing_call_takes_the_success_arm |
| ErrorHandling.SwitchOnThrowingCallWildcardSuccess | Reescrito | `error_handling.djinn` ThrowsTests.switch_on_a_throwing_call_accepts_a_wildcard_for_the_success_arm |
| ErrorHandling.SwitchOnThrowingCallSpecificErrorArm | Reescrito | `error_handling.djinn` ThrowsTests.switch_on_a_throwing_call_takes_the_specific_error_arm |
| ErrorHandling.SwitchOnThrowingCallGenericErrorArm | Reescrito | `error_handling.djinn` ThrowsTests.switch_on_a_throwing_call_takes_the_generic_error_arm |
| ErrorHandling.SwitchOnThrowingCallSpecificArmBeforeErrorArm | Reescrito | `error_handling.djinn` ThrowsTests.switch_specific_arm_wins_over_the_generic_error_arm |
| ErrorHandling.SwitchOnThrowingCallDerivedErrorMatchesBaseArm | Descartar | tipos de erro não têm hierarquia no djinnc (`SUBSET.md`: um erro é qualquer struct listada em `throws`) |
| ErrorHandling.SwitchOnThrowingCallNoArmMatchesPropagates | Descartar | o djinnc recusa o `switch` que não cobre todos os erros; coberto por `errors.djinn` ErrorsTests.error_switch_not_exhaustive |
| ErrorHandling.SwitchOnThrowingCallUnhandledAbortsOutsideThrows | Descartar | o djinnc recusa o `switch` que não cobre todos os erros; coberto por `errors.djinn` ErrorsTests.error_switch_not_exhaustive |
| ErrorHandling.SwitchOnConstexprThrowingCallTakesErrorArm | Reescrito | `error_handling.djinn` ThrowsTests.a_constexpr_throwing_call_in_a_switch_takes_the_error_arm e a_constexpr_throwing_call_in_a_switch_takes_the_success_arm |
| ErrorHandling.SwitchArmsTypeMismatchDiagnostic | Reescrito | `error_handling.djinn` ThrowsTests.switch_arms_must_agree_on_the_result_type |
| ErrorHandling.SwitchBlockArmReturnDiagnostic | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| ErrorHandling.SwitchOnThrowingCallBlockArmSuccessContinues | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| ErrorHandling.SwitchBlockArmWithoutDivergenceDiagnostic | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| ErrorHandling.SwitchBlockArmYieldContinuesAfterSwitch | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| ErrorHandling.SwitchBlockArmYieldAfterStatements | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| ErrorHandling.YieldWithValueOutsideSwitchArmDiagnostic | Descartar | braço de `switch` com bloco e `yield` não existe no djinnc; o braço é uma expressão |
| RuntimeErrors.TrappedOverflowReportHasLocationValuesAndTrace | Descartar | o aborto por overflow é coberto por OverflowModeTests.trapped_*; o djinnc não imprime operandos nem tem a chamada mínima do modo release |
| RuntimeErrors.DivisionByZeroReportShowsOperands | Reescrito | `CrashTests.DivisionByZeroReportShowsOperands`; o djinnc não mostra os operandos; confere a causa, o local e a pilha |
| RuntimeErrors.NegateOverflowReport | Descartar | o aborto por overflow é coberto por OverflowModeTests.trapped_*; o djinnc não imprime operandos nem tem a chamada mínima do modo release |
| RuntimeErrors.VariableHistoryShowsLastAssignments | Descartar | o djinnc não rastreia o histórico de variáveis |
| RuntimeErrors.StackTraceShowsIntermediateFrames | Reescrito | `CrashTests.StackTraceShowsIntermediateFrames`; com divisão por zero no lugar de `i32t` |
| RuntimeErrors.ShadowStackCallsAppearInIr | Reescrito | `RuntimeErrorsIrTests.ShadowStackCallsAppearInIr`; com `-g`; o djinnc não emite `__djinn_frame_set_line` nem `__djinn_var_track` |
| RuntimeErrors.NormalRunHasEmptyReport | Descartar | coberto por qualquer teste que roda e sai com o código esperado |
| RuntimeErrors.UncaughtExceptionEscapingMainReportsAndAborts | Reescrito | `error_handling.djinn` ThrowsTests.an_error_escaping_main_is_reported_and_aborts |
| RuntimeErrors.UncaughtExceptionReleaseReportHasNoStackTrace | Reescrito | `error_handling.djinn` ThrowsTests.an_error_escaping_main_is_reported_and_aborts; o relatório do djinnc não tem versão sem pilha |
| RuntimeErrors.ReleaseModeOmitsShadowStackAndVarTracking | Reescrito | `RuntimeErrorsIrTests.ReleaseModeOmitsShadowStackAndVarTracking`; sem `-g`, o IR não leva a pilha de chamadas nem o rastreio de variáveis |
| RuntimeErrors.ReleaseModeTrapUsesMinimalCall | Descartar | o aborto por overflow é coberto por OverflowModeTests.trapped_*; o djinnc não imprime operandos nem tem a chamada mínima do modo release |
| RuntimeErrors.ReleaseModeTrapReportKeepsLocationAndValues | Descartar | o aborto por overflow é coberto por OverflowModeTests.trapped_*; o djinnc não imprime operandos nem tem a chamada mínima do modo release |

## functions

| Teste | Decisão | Motivo |
|---|---|---|
| Constructor.StackBasicFieldAccess | Portar | exit code 10 |
| Constructor.StackSecondField | Portar | exit code 20 |
| Constructor.StackFieldExpression | Portar | exit code 42 |
| Constructor.StackThreeFields | Portar | exit code 6 |
| Constructor.StackPassedToFunction | Portar | exit code 99 |
| Constructor.HeapBasicFieldAccess | Portar | exit code 1 |
| Constructor.HeapSecondField | Portar | exit code 69 |
| Constructor.HeapFieldExpression | Portar | exit code 42 |
| Constructor.HeapThreeFields | Portar | exit code 60 |
| Constructor.HeapFieldAssignment | Portar | exit code 77 |
| Constructor.StackAndHeapSameStruct | Portar | exit code 50 |
| Constructor.GenericStackBasic | Portar | exit code 42 |
| Constructor.GenericStackNoArgs | Portar | exit code 0 |
| Constructor.GenericStackTwoFields | Portar | exit code 42 |
| Constructor.GenericStackMethodCall | Portar | exit code 77 |
| Constructor.GenericStackMethodForwardReference | Portar | exit code 2 |
| Constructor.GenericHeapBasic | Portar | exit code 99 |
| Constructor.GenericHeapMethodCall | Portar | exit code 55 |
| Method.BasicMethodWithBlock | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Method.ExpressionBodyArrow | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Method.MethodWithParameters | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Method.PublicPrivateModifiers | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Method.StaticMethod | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Method.VoidMethodWithBlock | Portar | compila sem erros |
| Method.MixedFieldsAndMethods | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| OperatorOverload.ParseOperatorInInterface | Portar | compila sem erros |
| OperatorOverload.ParseOperatorInImpl | Portar | compila sem erros |
| OperatorOverload.StructAddition | Portar | exit code 10 |
| OperatorOverload.StructEquality | Portar | exit code 1 |
| OperatorOverload.NotEqualDerivedFromEqual | Portar | exit code 42 |
| OperatorOverload.BitwiseOperatorsOnPrimitives | Portar | exit code 40 |
| OperatorOverload.OperatorInStructBody | Portar | exit code 42 |
| OperatorOverload.MultipleOperatorsOnSameStruct | Portar | exit code 99 |

## generics

| Teste | Decisão | Motivo |
|---|---|---|
| GenericConstraints.ParseWhereClauseSingleConstraint | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| GenericConstraints.ParseWhereClauseMultipleConstraintsSameParam | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| GenericConstraints.ParseWhereClauseMultipleParams | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| GenericConstraints.ParseWhereClauseOnEnum | Reescrito | `language_rules.djinn` GenericConstraintRuleTests.a_constrained_union_accepts_an_implementing_struct; o enum com carga virou `union` |
| GenericConstraints.ParseWhereClauseOnInterface | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| GenericConstraints.UndefinedConstraintInterfaceError | Reescrito | `language_rules.djinn` GenericConstraintRuleTests.a_constraint_naming_an_unknown_interface_is_an_error; o erro sai na instanciação |
| GenericConstraints.ConstraintSatisfied | Portar | exit code 0 |
| GenericConstraints.ConstraintViolated | Portar | erro E3050 |
| GenericConstraints.NoConstraintNoValidation | Portar | exit code 0 |
| GenericConstraints.MultipleConstraintsSatisfied | Portar | exit code 0 |
| GenericConstraints.MultipleConstraintsPartiallyViolated | Portar | erro E3050 |
| GenericConstraints.EnumConstraintSatisfied | Reescrito | `language_rules.djinn` GenericConstraintRuleTests.a_constrained_union_accepts_an_implementing_struct; o enum com carga virou `union` |
| GenericConstraints.EnumConstraintViolated | Reescrito | `language_rules.djinn` GenericConstraintRuleTests.a_constrained_union_rejects_a_struct_without_the_interface |
| GenericConstraints.WhereClauseWithImplements | Portar | exit code 1 |
| FullCompilation.StructGeneric | Portar | exit code 0 |
| GenericStruct.TwoParameters | Portar | exit code 0 |
| GenericStruct.ThreeParameters | Portar | exit code 0 |
| GenericStruct.FourParameters | Portar | exit code 0 |
| GenericStruct.MapEntry | Portar | exit code 0 |
| GenericStruct.TwoParametersWithInit | Portar | exit code 0 |
| GenericStruct.TwoParametersFieldAccess | Portar | exit code 42 |
| GenericStruct.TwoParametersSecondFieldAccess | Portar | exit code 99 |
| GenericStruct.MixedTypes | Portar | exit code 50 |
| GenericStruct.PointerTypes | Portar | exit code 0 |
| GenericStruct.MultipleInstantiations | Portar | exit code 0 |
| GenericStruct.NestedGenericStruct | Portar | exit code 0 |
| GenericStruct.FunctionReturningGenericStruct | Portar | exit code 15 |
| GenericStruct.GenericStructAsParameter | Portar | exit code 77 |
| GenericStruct.ThreeParametersFieldSum | Portar | exit code 60 |
| Interface.BasicDefinition | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Interface.SameNameInterfaceDefinition | Descartar | a source não é válida (método sem corpo em struct); não testa regra do djinnc |
| Interface.GenericInterface | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Interface.StructImplementsInterface | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Interface.StructImplementsMultipleInterfaces | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |

## hello_world

| Teste | Decisão | Motivo |
|---|---|---|
| Hello.World | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |

## memory

| Teste | Decisão | Motivo |
|---|---|---|
| Mutable.BasicMutableVariables | Portar | exit code 2 |
| Mutable.InvalidImmutableAssingment | Portar | erro E3042 |
| Ownership.CopyTypesDoNotMove | Portar | exit code 84 |
| Ownership.FloatCopyTypes | Portar | exit code 1 |
| Ownership.PointerCopyTypes | Portar | exit code 20 |
| Ownership.StructMoveSemantics | Portar | exit code 100 |
| Ownership.UseAfterMove | Portar | erro E5001 |
| Ownership.DoubleMoveError | Portar | erro E5001 |
| Ownership.ReinitializeAfterMove | Portar | exit code 30 |
| Ownership.ScopeOwnership | Portar | exit code 10 |
| Ownership.NestedScopeOwnership | Portar | exit code 3 |
| Ownership.FunctionParameterCopyType | Portar | exit code 21 |
| Ownership.IfStatementOwnership | Portar | exit code 10 |
| Ownership.WhileLoopOwnership | Portar | exit code 10 |
| Ownership.ForLoopOwnership | Portar | exit code 10 |

## modules

| Teste | Decisão | Motivo |
|---|---|---|
| Extern.PrintfHelloWorld | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Extern.BlockSyntax | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Extern.MultipleExternBlocks | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Extern.StdImportNoDuplicateExternSymbols | Reescrito | `ExternIrTests.StdImportNoDuplicateExternSymbols` |
| Extern.ExternNotRemovedByOptimizer | Reescrito | `ExternIrTests.ExternNotRemovedByOptimizer` |
| Import.BasicImport | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Import.QualifiedImport | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Import.MultipleImports | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Import.ImportParsesQualifiedName | Portar | compila sem erros; as asserções sobre a AST do stage0 não valem para o djinnc |
| Namespace.BasicDefinition | Portar | exit code 0 |
| Namespace.StructInNamespace | Portar | exit code 0 |
| Namespace.NestedNamespace | Portar | exit code 0 |
| Namespace.MultipleFunctionsInNamespace | Portar | exit code 0 |
| Namespace.StructAndFunctionInNamespace | Portar | exit code 0 |
| Namespace.FileScopedNamespace | Portar | exit code 0 |
| Namespace.FileScopedQualifiedNamespace | Portar | exit code 0 |
| Namespace.NoNamespaceIsGlobal | Portar | exit code 0 |

## strings

| Teste | Decisão | Motivo |
|---|---|---|
| StringInterpolation.SimpleIdentifier | Reescrito | `interpolation.djinn` StringInterpolationTests.simple_identifier |
| StringInterpolation.MultipleArgs | Reescrito | `interpolation.djinn` StringInterpolationTests.multiple_arguments |
| StringInterpolation.MixedWithExplicitPositional | Descartar | só `$"..."` interpola no djinnc; o formato posicional `{0}` do `Console` é coberto por StdTests.console |
| StringInterpolation.NoInterpolationLeavesStringUnchanged | Reescrito | `StringInterpolationIrTests.NoInterpolationLeavesStringUnchanged` |
| StringInterpolation.FieldAccessInsideBraces | Reescrito | `interpolation.djinn` StringInterpolationTests.field_access_inside_braces |
| StringInterpolation.BlockStringTripleQuoted | Descartar | `$"""` não existe; o bloco sem escapes é coberto por StringInterpolationIrTests.BlockStringNoEscapes |
| StringInterpolation.BlockStringNoEscapes | Reescrito | `StringInterpolationIrTests.BlockStringNoEscapes` |
| StringInterpolation.ArithmeticExpressionInsideBraces | Reescrito | `interpolation.djinn` StringInterpolationTests.arithmetic_expression_inside_braces |
| StringInterpolation.FunctionCallExpandsAsArgument | Reescrito | `interpolation.djinn` StringInterpolationTests.function_call_inside_braces |
| StringInterpolation.RepeatedExpressionEvaluatedTwice | Reescrito | `interpolation.djinn` StringInterpolationTests.repeated_expression_is_evaluated_each_time |
| StringInterpolation.EmptyBracesPreserved | Reescrito | `StringInterpolationIrTests.EmptyBracesPreserved` |
| StringInterpolation.NonCallStringLiteralNotInterpolated | Reescrito | `StringInterpolationIrTests.NonCallStringLiteralNotInterpolated` |

## types

| Teste | Decisão | Motivo |
|---|---|---|
| AddressOf.StructLocalComparesWithItsPointer | Portar | exit code 7 |
| AddressOf.IntegerLocalDereferencesToItsValue | Portar | exit code 5 |
| Cast.IntTruncation | Portar | exit code 42 |
| Cast.IntWidening | Portar | exit code 7 |
| Cast.FloatToInt | Portar | exit code 3 |
| Cast.IntToFloat | Portar | exit code 5 |
| Cast.ChainedCast | Portar | exit code 100 |
| Cast.SameTypeCastNoop | Portar | exit code 99 |
| Cast.CastInExpression | Portar | exit code 13 |
| Cast.FloatTruncation | Portar | exit code 2 |
| Cast.PointerCast | Portar | exit code 42 |
| Cast.CastLiteral | Portar | exit code 3 |
| Cast.NegativeFloatToInt | Portar | exit code 9 |
| ConstField.BasicConstFieldStaticAccess | Portar | exit code 100 |
| ConstField.ConstFieldUsedInStaticMethod | Portar | exit code 0 |
| ConstField.ConstFieldWithPublicModifier | Portar | exit code 42 |
| ConstField.ConstFieldDoesNotAffectStructLayout | Portar | exit code 20 |
| ConstField.ConstFieldAccessViaInstance | Reescrito | `language_rules.djinn` StructRuleTests.a_const_field_is_not_reachable_through_an_instance |
| ConstField.ConstFieldNegativeValue | Portar | exit code 9 |
| ConstField.MutAndConstError | Bloqueado | o djinnc aceita `mut const` sem erro |
| ConstField.ConstFieldWithoutInitializerError | Portar | erro E2001 |
| ConstField.MultipleConstFields | Portar | exit code 3 |
| ConstField.ConstFieldWithMixedRegularFields | Portar | exit code 100 |
| IsExpression.ObjectIsI32True | Portar | exit code 1 |
| IsExpression.ObjectIsI32False | Portar | exit code 0 |
| IsExpression.ObjectIsF64 | Portar | exit code 1 |
| IsExpression.ObjectIsStr | Reescrito | `language_rules.djinn` BoxedTextTests.a_str_variable_boxes_as_str |
| IsExpression.NegatedIsExpression | Portar | exit code 1 |
| IsExpression.ErrorOnNonObjectOperand | Portar | erro E3036 |
| IsExpression.MultipleTypeChecks | Reescrito | `language_rules.djinn` BoxedTextTests.variadic_object_arguments_are_told_apart_by_type; um `str` passado em `...args` chega como ponteiro, então o caso `str` não vale |
| IsExpression.IRContainsIsCheck | Reescrito | `IsExpressionIrTests.IRContainsIsCheck`; o IR do djinnc nomeia a comparação `is.match` |
| IsExpression.BindingExtractsI32Value | Portar | exit code 42 |
| IsExpression.BindingNotUsedWhenTypeMismatch | Portar | exit code -1 |
| IsExpression.BindingWithDifferentTypes | Portar | exit code 99 |
| NativeTypes.DeclarationsCompile | Portar | compila sem erros |
| NativeTypes.NintIsPointerSized | Reescrito | `sizeof_typeof.djinn` SizeofTypeofTests.sizeof_nint_is_pointer_sized |
| NativeTypes.NfloatIsF32 | Reescrito | `NativeTypesIrTests.NfloatIsF32` |
| NativeTypes.NdoubleIsF64 | Reescrito | `NativeTypesIrTests.NdoubleIsF64` |
| NativeTypes.NintMixesWithI64 | Portar | compila sem erros |
| NativeTypes.TypeofShowsNativeName | Descartar | `typeof(expressão)` não existe; `typeof(Tipo)` devolve um `TypeInfo*` (SizeofTypeofTests.typeof_reports_the_kind_of_a_type) |
| NativeTypes.NintMaxValueConstant | Bloqueado | `nint` não tem `MAX_VALUE` nem sufixos de overflow (`nints`, `nintt`) no djinnc |
| NativeTypes.NintTakesOverflowSuffixes | Bloqueado | `nint` não tem `MAX_VALUE` nem sufixos de overflow (`nints`, `nintt`) no djinnc |
| NativeTypes.NfloatTypeofShowsNativeName | Descartar | `typeof(expressão)` não existe; `typeof(Tipo)` devolve um `TypeInfo*` (SizeofTypeofTests.typeof_reports_the_kind_of_a_type) |
| NativeTypes.NdoubleTypeofShowsNativeName | Descartar | `typeof(expressão)` não existe; `typeof(Tipo)` devolve um `TypeInfo*` (SizeofTypeofTests.typeof_reports_the_kind_of_a_type) |
| NativeTypes.NintSaturatingArithmetic | Bloqueado | `nint` não tem `MAX_VALUE` nem sufixos de overflow (`nints`, `nintt`) no djinnc |
| NativeTypes.NintNegation | Portar | exit code 5 |
| NativeTypes.NintAsFunctionSignature | Portar | exit code 42 |
| NativeTypes.NfloatNdoubleArithmetic | Portar | compila sem erros |
| NonZero.DeclarationsCompile | Portar | compila sem erros |
| NonZero.SameRepresentationAsBaseType | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RejectsZeroLiteral | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RejectsZeroLiteralVariants | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RejectsImplicitConversionFromPlainType | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.ExplicitCastIsTrusted | Portar | compila sem erros |
| NonZero.RejectsCastOfZeroLiteral | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.ArithmeticResultLosesGuarantee | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RejectsIncrementAndDecrement | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RejectsDeclarationWithoutInitializer | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.CombinesWithOverflowSuffix | Portar | compila sem erros |
| NonZero.RejectsSuffixOnFloatType | Descartar | `f32w` nem é um tipo no djinnc; coberto como Overflow.FloatTypeSuffixIsRejected |
| NonZero.DivisionByNonZeroRuns | Portar | exit code 10 |
| NonZero.DivisionByConstantSkipsZeroCheck | Reescrito | `NonZeroIrTests.DivisionByConstantSkipsZeroCheck`; o IR do djinnc nomeia o teste `div.zero` |
| NonZero.DivisionByUnknownStillChecked | Reescrito | `NonZeroIrTests.DivisionByUnknownStillChecked`; o IR do djinnc nomeia o teste `div.zero` |
| NonZero.DivisionByNonZeroParamSkipsCheckAndChecksEntry | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.RequireNonZeroDedupsEntryCheck | Bloqueado | contratos (`require`/`ensure`) |
| NonZero.RequireProvesParamNonZeroForAssignments | Bloqueado | contratos (`require`/`ensure`) |
| NonZero.CompileTimeViolationForNonZeroParam | Bloqueado | tipos non-zero (`i32n`) |
| NonZero.CompileTimeViolationForRequireStillWorks | Bloqueado | contratos (`require`/`ensure`) (o erro atual tem outro motivo) |
| NonZero.NonZeroParamCallWithNonZeroConstantCompiles | Portar | compila sem erros |
| NonZero.EnsureProvesNonZeroReturn | Bloqueado | contratos (`require`/`ensure`) |
| NonZero.EnsureWorksInAnyDeclarationOrder | Bloqueado | contratos (`require`/`ensure`) |
| NonZero.EntryCheckTrapsAtRuntime | Portar | exit code diferente de zero |
| Nullable.NullLiteralAllowedOnNullableType | Portar | compila sem erros |
| Nullable.NullLiteralForbiddenOnNonNullableStruct | Portar | erro E3053 |
| Nullable.NullLiteralForbiddenOnNonNullablePointer | Portar | erro E3053 |
| Nullable.NullLiteralForbiddenOnInteger | Portar | erro E3053 |
| Nullable.NullableArraySyntax | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.ReassignNullToNullableMutVariable | Portar | compila sem erros |
| Nullable.ReassignNullToNonNullableErrors | Portar | erro E3053 |
| Nullable.NullCoalescingParsesAndCompiles | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.NullCoalescingAssignmentDesugars | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.NullConditionalFieldAccessParses | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.NullForgivingFieldAccessParses | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.CastNonNullableToNullableAllowed | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.CastNullableToNonNullableEmitsWarning | Bloqueado | `?.`, `!.`, `??=` não existem e `??` só vale em ponteiro não anulável |
| Nullable.CastNullableToNullableNoWarning | Portar | compila sem erros |
| Nullable.CastIntegerToPointerNoWarning | Portar | compila sem erros |
| PointerCompat.VoidToTyped | Portar | compila sem erros |
| PointerCompat.TypedToVoid | Portar | compila sem erros |
| PointerCompat.IncompatibleTypes | Descartar | coberto por `errors.djinn` pointer_to_other_pointer_type_variable e _argument |
| PointerCompat.IncompatibleTypesHumanReadableMessage | Portar | compila sem erros |
| PointerCompat.SameType | Portar | compila sem erros |
| PointerField.ComparesWithLocalInsideNamespace | Portar | exit code 1 |
| UnsignedCompare.EqualsConstantAboveI32Max | Reescrito | `language_rules.djinn` UnsignedConstantTests.equality_with_a_constant_above_the_signed_maximum; `const` virou `constexpr` |
| UnsignedCompare.OrderingUsesUnsignedPredicates | Portar | exit code 1 |
| UnsignedCompare.CastWidensWithZeroExtension | Portar | exit code 1 |
| UnsignedCompare.SignedStillOrdersNegatives | Portar | exit code 1 |
