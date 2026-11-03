//
// Native debug info (opt-in, -g): DICompileUnit, DISubprogram, DILocation per
// statement/expression and DILocalVariable for locals and parameters.
//

#include "Generator.h"

#include "llvm/BinaryFormat/Dwarf.h"
#include "llvm/IR/DIBuilder.h"
#include "llvm/IR/DebugInfoMetadata.h"

void Generator::init_debug_info()
{
    if (!debugInfo || diBuilder) return;

    diBuilder = std::make_unique<llvm::DIBuilder>(*module);
    auto* file = debug_file(moduleName.empty() ? "djinn_module" : moduleName);
    diUnit = diBuilder->createCompileUnit(llvm::dwarf::DW_LANG_C99, file, "djinn", false, "", 0);

    module->addModuleFlag(llvm::Module::Warning, "Debug Info Version", llvm::DEBUG_METADATA_VERSION);
#ifdef _WIN32
    module->addModuleFlag(llvm::Module::Warning, "CodeView", 1);
#else
    module->addModuleFlag(llvm::Module::Warning, "Dwarf Version", 4);
#endif
}

llvm::DIFile* Generator::debug_file(const std::string& fileId)
{
    if (const auto it = diFiles.find(fileId); it != diFiles.end()) return it->second;
    const std::filesystem::path path(fileId);
    auto* file = diBuilder->createFile(path.filename().string(), path.parent_path().string());
    diFiles.emplace(fileId, file);
    return file;
}

llvm::DIType* Generator::debug_type(const Type& type, llvm::Type* llvmType)
{
    switch (type.kind)
    {
    case TypeKind::INTEGER:
        {
            const unsigned bits = llvmType && llvmType->isIntegerTy() ? llvmType->getIntegerBitWidth() : 32;
            const std::string name = (bits == 1 ? std::string("bool") : (type.sign ? "i" : "u") + std::to_string(bits));
            const unsigned encoding = bits == 1
                                          ? llvm::dwarf::DW_ATE_boolean
                                          : (type.sign ? llvm::dwarf::DW_ATE_signed : llvm::dwarf::DW_ATE_unsigned);
            return diBuilder->createBasicType(name, bits, encoding);
        }
    case TypeKind::F16: return diBuilder->createBasicType("f16", 16, llvm::dwarf::DW_ATE_float);
    case TypeKind::F32: return diBuilder->createBasicType("f32", 32, llvm::dwarf::DW_ATE_float);
    case TypeKind::F64: return diBuilder->createBasicType("f64", 64, llvm::dwarf::DW_ATE_float);
    case TypeKind::F128: return diBuilder->createBasicType("f128", 128, llvm::dwarf::DW_ATE_float);
    case TypeKind::POINTER:
        {
            llvm::DIType* pointee = nullptr;
            if (type.elementType && type.elementType->kind != TypeKind::POINTER &&
                type.elementType->kind != TypeKind::STRUCT && type.elementType->kind != TypeKind::VOID)
                pointee = debug_type(*type.elementType, nullptr);
            return diBuilder->createPointerType(pointee, 64);
        }
    case TypeKind::STRUCT:
        {
            uint64_t bits = 64;
            if (llvmType && llvmType->isSized())
                bits = module->getDataLayout().getTypeAllocSizeInBits(llvmType);
            return diBuilder->createStructType(diUnit, type.structName, nullptr, 0, bits, 0,
                                               llvm::DINode::FlagZero, nullptr, llvm::DINodeArray());
        }
    default:
        return diBuilder->createUnspecifiedType("value");
    }
}

void Generator::debug_begin_function(const std::string& name, const SourceLocation& loc)
{
    if (!diBuilder) return;
    auto* function = builder->GetInsertBlock() ? builder->GetInsertBlock()->getParent() : nullptr;
    if (!function || function->getSubprogram()) return;

    if (loc.line == 0 || loc.fileId.empty())
    {
        diPendingNames[function] = name;
        return;
    }
    create_subprogram(function, name, loc);
}

void Generator::create_subprogram(llvm::Function* function, const std::string& name, const SourceLocation& loc)
{
    auto* file = debug_file(loc.fileId.empty() ? moduleName : loc.fileId);
    auto* subroutine = diBuilder->createSubroutineType(diBuilder->getOrCreateTypeArray({}));
    auto* subprogram = diBuilder->createFunction(file, name, function->getName(), file, loc.line, subroutine,
                                                 loc.line, llvm::DINode::FlagZero,
                                                 llvm::DISubprogram::SPFlagDefinition);
    function->setSubprogram(subprogram);
    builder->SetCurrentDebugLocation(llvm::DILocation::get(*context, loc.line, loc.column, subprogram));
}

void Generator::debug_locate(const SourceLocation& loc)
{
    if (!diBuilder || loc.line == 0 || !builder->GetInsertBlock()) return;
    auto* function = builder->GetInsertBlock()->getParent();
    if (!function) return;
    if (!function->getSubprogram())
    {
        const auto pending = diPendingNames.find(function);
        if (pending == diPendingNames.end() || loc.fileId.empty()) return;
        create_subprogram(function, pending->second, loc);
        diPendingNames.erase(pending);
    }
    auto* subprogram = function->getSubprogram();
    builder->SetCurrentDebugLocation(llvm::DILocation::get(*context, loc.line, loc.column, subprogram));
}

void Generator::debug_declare(llvm::Value* slot, const std::string& name, const Type& type,
                              const SourceLocation& loc)
{
    if (!diBuilder || loc.line == 0 || !builder->GetInsertBlock()) return;
    auto* alloca = llvm::dyn_cast_or_null<llvm::AllocaInst>(slot);
    auto* function = builder->GetInsertBlock()->getParent();
    auto* subprogram = function ? function->getSubprogram() : nullptr;
    if (!alloca || !subprogram) return;

    auto* file = debug_file(loc.fileId.empty() ? moduleName : loc.fileId);
    auto* variable = diBuilder->createAutoVariable(subprogram, name, file, loc.line,
                                                   debug_type(type, alloca->getAllocatedType()), true);
    diBuilder->insertDeclare(alloca, variable, diBuilder->createExpression(),
                             llvm::DILocation::get(*context, loc.line, loc.column, subprogram),
                             builder->GetInsertBlock());
}

// Parameters are declared after generation: every parameter is spilled to a
// named alloca in the entry block, so one pass covers functions, methods and
// properties without touching each body generator.
void Generator::finalize_debug_info()
{
    if (!diBuilder) return;

    for (auto& function : *module)
    {
        auto* subprogram = function.getSubprogram();
        if (!subprogram)
        {
            for (auto& block : function)
                for (auto& instruction : block)
                    instruction.setDebugLoc(llvm::DebugLoc());
            continue;
        }

        auto* file = subprogram->getFile();
        const auto fallback = llvm::DILocation::get(*context, subprogram->getLine(), 0, subprogram);

        std::vector<llvm::StoreInst*> spills;
        for (auto& block : function)
        {
            for (auto& instruction : block)
            {
                if (const auto* location = instruction.getDebugLoc().get();
                    !location || location->getScope()->getSubprogram() != subprogram)
                    instruction.setDebugLoc(fallback);
                if (auto* store = llvm::dyn_cast<llvm::StoreInst>(&instruction))
                    if (llvm::isa<llvm::Argument>(store->getValueOperand()) &&
                        llvm::isa<llvm::AllocaInst>(store->getPointerOperand()))
                        spills.push_back(store);
            }
        }

        for (auto* store : spills)
        {
            auto* argument = llvm::cast<llvm::Argument>(store->getValueOperand());
            auto* alloca = llvm::cast<llvm::AllocaInst>(store->getPointerOperand());
            const std::string name = argument->hasName() ? argument->getName().str() : "arg";
            auto* argumentType = argument->getType();
            llvm::DIType* type = nullptr;
            if (argumentType->isIntegerTy())
                type = diBuilder->createBasicType("i" + std::to_string(argumentType->getIntegerBitWidth()),
                                                  argumentType->getIntegerBitWidth(), llvm::dwarf::DW_ATE_signed);
            else if (argumentType->isFloatTy())
                type = diBuilder->createBasicType("f32", 32, llvm::dwarf::DW_ATE_float);
            else if (argumentType->isDoubleTy())
                type = diBuilder->createBasicType("f64", 64, llvm::dwarf::DW_ATE_float);
            else if (argumentType->isPointerTy())
                type = diBuilder->createPointerType(nullptr, 64);
            else
                type = diBuilder->createUnspecifiedType("value");

            auto* variable = diBuilder->createParameterVariable(subprogram, name, argument->getArgNo() + 1, file,
                                                                subprogram->getLine(), type, true);
            diBuilder->insertDeclare(alloca, variable, diBuilder->createExpression(), fallback,
                                     store->getNextNode());
        }
    }

    diBuilder->finalize();
    diBuilder.reset();
}
