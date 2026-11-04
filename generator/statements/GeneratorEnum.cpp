//
// Created by Claude on 09/01/2026.
//
#include "../Generator.h"

// ============================================================================
// Enum generation from EnumSymbol (binder)
// ============================================================================
void Generator::generate_enum(const EnumSymbol& enum_symbol)
{
    EnumDef def(enum_symbol.name, enum_symbol.isGeneric());

    for (const auto& genParam : enum_symbol.genericParams)
    {
        auto gp = GenericParam(SourceIdentifier(genParam.name, SourceLocation()));
        gp.constraints = genParam.constraints;
        def.genericParams.params.push_back(std::move(gp));
    }

    for (const auto& variant : enum_symbol.variants)
    {
        def.addVariant(variant.name, variant.associatedTypes);
        def.variants.back().tag = variant.tag;
    }

    if (enum_symbol.isGeneric())
    {
        // Generic enums are just registered for later monomorphization
        currentScope->define_enum(enum_symbol.name, std::move(def));
        return;
    }

    // Non-generic enum: create the LLVM type now
    const auto variantCount = enum_symbol.variants.size();
    llvm::Type* tagType;
    if (!enum_symbol.fields.empty())
    {
        tagType = generate_type(enum_symbol.fields.front().type);
    }
    else if (variantCount <= 256)
    {
        tagType = builder->getInt8Ty();
    }
    else if (variantCount <= 65536)
    {
        tagType = builder->getInt16Ty();
    }
    else
    {
        tagType = builder->getInt32Ty();
    }
    def.tagType = tagType;

    size_t maxPayloadSize = 0;
    for (const auto& variant : enum_symbol.variants)
    {
        size_t variantPayloadSize = 0;

        for (const auto& type : variant.associatedTypes)
        {
            if (llvm::Type* llvmType = generate_type(type))
            {
                const auto& dataLayout = module->getDataLayout();
                variantPayloadSize += dataLayout.getTypeAllocSize(llvmType);
            }
        }

        maxPayloadSize = std::max(maxPayloadSize, variantPayloadSize);
    }

    def.maxPayloadSize = maxPayloadSize;
    std::vector<llvm::Type*> enumFields;
    enumFields.push_back(tagType);

    if (maxPayloadSize > 0)
    {
        enumFields.push_back(llvm::ArrayType::get(builder->getInt8Ty(), maxPayloadSize));
    }

    def.llvmType = llvm::StructType::create(*context, enumFields, enum_symbol.name);
    declaredTypes.push_back(def.llvmType);
    build_enum_field_tables(enum_symbol, def);
    currentScope->define_enum(enum_symbol.name, std::move(def));
}

void Generator::build_enum_field_tables(const EnumSymbol& enum_symbol, EnumDef& def)
{
    unsigned maxTag = 0;
    for (const auto& variant : enum_symbol.variants)
    {
        maxTag = std::max(maxTag, variant.tag);
    }
    if (enum_symbol.fields.empty())
    {
        return;
    }
    if (maxTag >= 65536)
    {
        throw CompileError(DiagnosticCode::TYPE_MISMATCH,
                           "enum '" + enum_symbol.name + "' flag values must be below 65536");
    }

    const auto constantOf = [this, &enum_symbol](const Expression& expr, llvm::Type* type) -> llvm::Constant*
    {
        if (const auto* text = dynamic_cast<const StringLiteral*>(&expr); text && type->isPointerTy())
        {
            auto* data = llvm::ConstantDataArray::getString(*context, text->value, true);
            return new llvm::GlobalVariable(*module, data->getType(), true, llvm::GlobalValue::PrivateLinkage, data,
                                            ".enum.str");
        }
        bool negative = false;
        const Expression* number = &expr;
        if (const auto* unary = dynamic_cast<const UnaryExpression*>(number);
            unary && unary->op == TokenType::MINUS)
        {
            negative = true;
            number = unary->operand.get();
        }
        if (const auto* integer = dynamic_cast<const IntegerLiteral*>(number); integer && type->isIntegerTy())
        {
            const long long value = (negative ? -1 : 1) * std::stoll(integer->value, nullptr, 0);
            return llvm::ConstantInt::get(type, static_cast<uint64_t>(value), true);
        }
        throw CompileError(DiagnosticCode::TYPE_MISMATCH,
                           "enum '" + enum_symbol.name + "' constants must be string or integer literals");
    };

    for (size_t fieldIdx = 0; fieldIdx < enum_symbol.fields.size(); ++fieldIdx)
    {
        const auto& field = enum_symbol.fields[fieldIdx];
        llvm::Type* fieldType = generate_type(field.type);
        def.fieldNames.push_back(field.name);
        def.fieldTypes.push_back(fieldType);
        if (fieldIdx == 0)
        {
            def.fieldTables.push_back(nullptr);
            continue;
        }

        std::vector<llvm::Constant*> rows(maxTag + 1, llvm::Constant::getNullValue(fieldType));
        for (const auto& variant : enum_symbol.variants)
        {
            rows[variant.tag] = constantOf(*variant.constants[fieldIdx], fieldType);
        }
        auto* arrayType = llvm::ArrayType::get(fieldType, rows.size());
        def.fieldTables.push_back(new llvm::GlobalVariable(
            *module, arrayType, true, llvm::GlobalValue::PrivateLinkage, llvm::ConstantArray::get(arrayType, rows),
            enum_symbol.name + "." + field.name));
    }
}

void Generator::resolve_enum_body(const EnumSymbol&)
{
    // For non-generic enums, the body is already resolved in generate_enum
    // This is kept for potential future use with forward declarations
}

// ============================================================================
// Enum generation - Tagged unions
// ============================================================================
//
// For an enum like:
//   enum Result { Ok(i32), Error(string*) }
//
// We generate a struct with:
//   - A tag field (i8/i16/i32 depending on variant count)
//   - A payload array sized to fit the largest variant
//
// LLVM representation:
//   %Result = type { i8, [8 x i8] }  ; tag + max payload size
//
// Each variant gets a unique tag value (0, 1, 2, ...)
// ============================================================================

// void Generator::generate_enum(const EnumDeclaration &enum_declaration, const std::string &prefix) {
//     const std::string qualifiedName = prefix.empty()
//                                           ? enum_declaration.name.token_name
//                                           : prefix + "::" + enum_declaration.name.token_name;
//
//     EnumDef def(qualifiedName, enum_declaration.isGeneric());
//     def.genericParams = enum_declaration.genericParams;
//
//     for (const auto &variant: enum_declaration.values) {
//         def.addVariant(variant.name.token_name, variant.types);
//     }
//
//     if (enum_declaration.isGeneric()) {
//         currentScope->define_enum(qualifiedName, std::move(def));
//         return;
//     }
//
//     const auto variantCount = enum_declaration.values.size();
//     llvm::Type *tagType;
//     if (variantCount <= 256) {
//         tagType = builder->getInt8Ty();
//     } else if (variantCount <= 65536) {
//         tagType = builder->getInt16Ty();
//     } else {
//         tagType = builder->getInt32Ty();
//     }
//     def.tagType = tagType;
//
//     size_t maxPayloadSize = 0;
//     for (const auto &variant: enum_declaration.values) {
//         size_t variantPayloadSize = 0;
//
//         for (const auto &type: variant.types) {
//             if (llvm::Type *llvmType = generate_type(type)) {
//                 const auto &dataLayout = module->getDataLayout();
//                 variantPayloadSize += dataLayout.getTypeAllocSize(llvmType);
//             }
//         }
//
//         maxPayloadSize = std::max(maxPayloadSize, variantPayloadSize);
//     }
//
//     def.maxPayloadSize = maxPayloadSize;
//     std::vector<llvm::Type *> enumFields;
//     enumFields.push_back(tagType);
//
//     if (maxPayloadSize > 0) {
//         enumFields.push_back(llvm::ArrayType::get(builder->getInt8Ty(), maxPayloadSize));
//     }
//
//     def.llvmType = llvm::StructType::create(*context, enumFields, qualifiedName);
//     declaredTypes.push_back(def.llvmType);
//     currentScope->define_enum(qualifiedName, std::move(def));
// }
//
// // ============================================================================
// // Enum construction - Create a value of an enum variant
// // ============================================================================
// //
// // For Result::Ok(42):
// //   1. Allocate space for the enum struct
// //   2. Set the tag to the variant's tag value
// //   3. Store the payload value(s) in the payload area
// //   4. Return the enum value
// // ============================================================================

llvm::Value* Generator::generate_enum_construction(
    const EnumDef& enumDef,
    const EnumVariantDef& variant,
    const std::vector<std::unique_ptr<Expression>>& args
)
{
    const auto enumAlloca = builder->CreateAlloca(enumDef.llvmType, nullptr, "enum_tmp");
    const auto tagPtr = builder->CreateStructGEP(enumDef.llvmType, enumAlloca, 0, "tag_ptr");
    llvm::Value* tagValue = llvm::ConstantInt::get(enumDef.tagType, variant.tag);
    builder->CreateStore(tagValue, tagPtr);

    if (!variant.associatedTypes.empty() && enumDef.maxPayloadSize > 0)
    {
        llvm::Value* payloadPtr = builder->CreateStructGEP(enumDef.llvmType, enumAlloca, 1, "payload_ptr");
        llvm::Value* payloadBytes = builder->CreateBitCast(
            payloadPtr,
            llvm::PointerType::get(builder->getInt8Ty(), 0),
            "payload_bytes"
        );

        size_t offset = 0;
        for (size_t i = 0; i < variant.associatedTypes.size() && i < args.size(); ++i)
        {
            llvm::Value* argValue = generate_expression(*args[i]);
            llvm::Type* argType = argValue->getType();
            llvm::Value* fieldPtr = builder->CreateGEP(
                builder->getInt8Ty(),
                payloadBytes,
                builder->getInt64(offset),
                "field_ptr"
            );

            llvm::Value* typedPtr = builder->CreateBitCast(
                fieldPtr,
                llvm::PointerType::get(argType, 0),
                "typed_ptr"
            );
            builder->CreateStore(argValue, typedPtr);

            const auto& dataLayout = module->getDataLayout();
            offset += dataLayout.getTypeAllocSize(argType);
        }
    }

    return builder->CreateLoad(enumDef.llvmType, enumAlloca, "enum_val");
}

// ============================================================================
// Enum tag extraction - Get the discriminant/tag from an enum value
// ============================================================================
const EnumDef* Generator::enum_of_llvm_type(llvm::Type* type)
{
    if (!type->isStructTy() || !llvm::cast<llvm::StructType>(type)->hasName())
    {
        return nullptr;
    }
    std::string name = type->getStructName().str();
    if (const auto dot = name.rfind('.');
        dot != std::string::npos && dot + 1 < name.size() &&
        name.find_first_not_of("0123456789", dot + 1) == std::string::npos)
    {
        name.erase(dot);
    }
    return currentScope->lookup_enum(name);
}

llvm::Value* Generator::extract_enum_tag(llvm::Value* enumValue, const EnumDef& enumDef)
{
    // Allocate space and store the enum value
    llvm::Value* enumAlloca = builder->CreateAlloca(enumDef.llvmType, nullptr, "enum_alloca");
    builder->CreateStore(enumValue, enumAlloca);

    // GEP to get the tag pointer (field 0)
    llvm::Value* tagPtr = builder->CreateStructGEP(enumDef.llvmType, enumAlloca, 0, "tag_ptr");

    // Load and return the tag
    return builder->CreateLoad(enumDef.tagType, tagPtr, "tag");
}

// ============================================================================
// Enum payload extraction - Get the payload from an enum value for a given variant
// ============================================================================
llvm::Value* Generator::extract_enum_payload(llvm::Value* enumValue, const EnumDef& enumDef, size_t variantIdx)
{
    const auto& variant = enumDef.variants[variantIdx];

    // If no payload, return nullptr
    if (variant.associatedTypes.empty() || enumDef.maxPayloadSize == 0)
    {
        return nullptr;
    }

    // Allocate space and store the enum value
    llvm::Value* enumAlloca = builder->CreateAlloca(enumDef.llvmType, nullptr, "enum_alloca");
    builder->CreateStore(enumValue, enumAlloca);

    // GEP to get the payload pointer (field 1)
    llvm::Value* payloadPtr = builder->CreateStructGEP(enumDef.llvmType, enumAlloca, 1, "payload_ptr");

    // Cast to bytes
    llvm::Value* payloadBytes = builder->CreateBitCast(
        payloadPtr,
        llvm::PointerType::get(builder->getInt8Ty(), 0),
        "payload_bytes"
    );

    // For single-value payloads, extract the first field
    // (For multi-value payloads, this would need to return a struct or multiple values)
    if (variant.associatedTypes.size() == 1)
    {
        llvm::Type* payloadType = generate_type(variant.associatedTypes[0]);
        llvm::Value* typedPtr = builder->CreateBitCast(
            payloadBytes,
            llvm::PointerType::get(payloadType, 0),
            "typed_ptr"
        );
        return builder->CreateLoad(payloadType, typedPtr, "payload_val");
    }

    // For multi-value payloads, we need to build a struct
    // For now, just return the first value
    llvm::Type* firstPayloadType = generate_type(variant.associatedTypes[0]);
    llvm::Value* typedPtr = builder->CreateBitCast(
        payloadBytes,
        llvm::PointerType::get(firstPayloadType, 0),
        "typed_ptr"
    );
    return builder->CreateLoad(firstPayloadType, typedPtr, "payload_val");
}