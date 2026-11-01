#ifndef DJINN_FUNCTION_CONTEXT_H
#define DJINN_FUNCTION_CONTEXT_H

#include <string>
#include <vector>
#include "llvm/IR/BasicBlock.h"
#include "llvm/IR/Function.h"
#include "llvm/IR/Instructions.h"
#include "llvm/IR/Type.h"
#include "llvm/IR/Value.h"

struct ContractClause;
struct GenericContext;

struct LoopTargets
{
    llvm::BasicBlock* breakBlock = nullptr;
    llvm::BasicBlock* continueBlock = nullptr;
};

struct CoroutineState
{
    bool active = false;
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
    bool active = false;
    llvm::BasicBlock* block = nullptr;
    llvm::AllocaInst* slot = nullptr;
    bool didYield = false;
};

// Everything the generator tracks while emitting the body of one function.
// Function emission is reentrant (generic instantiation can start in the
// middle of another body), so this state is swapped as a unit by
// Generator::FunctionScope instead of being saved field by field.
struct FunctionContext
{
    llvm::Function* function = nullptr;
    std::string structName;
    const GenericContext* generics = nullptr;
    CoroutineState coroutine;
    bool throws = false;
    bool insideTryOperand = false;
    std::vector<const ContractClause*> contracts;
    llvm::AllocaInst* contractReturn = nullptr;
    std::vector<LoopTargets> loops;
    SwitchArmYield armYield;
};

class LoopGuard
{
public:
    LoopGuard(std::vector<LoopTargets>& loops, llvm::BasicBlock* breakBlock,
              llvm::BasicBlock* continueBlock = nullptr)
        : loops_(loops)
    {
        loops_.push_back({breakBlock, continueBlock});
    }

    ~LoopGuard() { loops_.pop_back(); }

    LoopGuard(const LoopGuard&) = delete;
    LoopGuard& operator=(const LoopGuard&) = delete;

private:
    std::vector<LoopTargets>& loops_;
};

template <typename T>
class ValueGuard
{
public:
    ValueGuard(T& slot, T value)
        : slot_(slot), saved_(slot)
    {
        slot_ = value;
    }

    ~ValueGuard() { slot_ = saved_; }

    ValueGuard(const ValueGuard&) = delete;
    ValueGuard& operator=(const ValueGuard&) = delete;

private:
    T& slot_;
    T saved_;
};

#endif //DJINN_FUNCTION_CONTEXT_H
