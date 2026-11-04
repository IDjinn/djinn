//
// Cast Expression - C-style explicit cast: (Type)expr
//

#include "../Generator.h"

llvm::Value* Generator::generate_cast_expression(const CastExpression& expr)
{
    llvm::Value* value = generate_expression(*expr.operand);

    // Explicit cast to object: box the value
    if (expr.targetType.kind == TypeKind::STRUCT &&
        (expr.targetType.structName == "object" || expr.targetType.structName == "std::types::object"))
    {
        llvm::Type* objectLlvmType = generate_type(expr.targetType);
        if (value->getType() != objectLlvmType)
        {
            return box_value(value, get_djinn_type_name(*expr.operand, value));
        }
    }

    if (expr.targetType.kind == TypeKind::STRUCT && value->getType()->isIntegerTy())
    {
        const EnumDef* enumDef = currentScope->lookup_enum(currentScope->resolve_alias(expr.targetType.structName));
        if (enumDef && !enumDef->isGeneric)
        {
            llvm::Value* enumAlloca = builder->CreateAlloca(enumDef->llvmType, nullptr, "enum_from_value");
            builder->CreateStore(llvm::Constant::getNullValue(enumDef->llvmType), enumAlloca);
            llvm::Value* tagPtr = builder->CreateStructGEP(enumDef->llvmType, enumAlloca, 0, "tag_ptr");
            builder->CreateStore(builder->CreateIntCast(value, enumDef->tagType, false), tagPtr);
            return builder->CreateLoad(enumDef->llvmType, enumAlloca, "enum_value");
        }
    }

    llvm::Type* targetType = fn_.generics
                                 ? generate_type_with_context(expr.targetType, fn_.generics)
                                 : generate_type(expr.targetType);

    return cast_value(value, targetType, expr.targetType.sign);
}