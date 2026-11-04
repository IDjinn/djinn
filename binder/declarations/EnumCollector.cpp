//
// Enum declaration collection
//

#include "../Binder.h"

void Binder::collectEnum(const EnumDeclaration& decl) const
{
    collectEnumWithPrefix(decl, "");
}

void Binder::collectEnumWithPrefix(const EnumDeclaration& decl, const std::string& prefix) const
{
    const std::string qualifiedName = prefix.empty() ? decl.name.token_name : prefix + "::" + decl.name.token_name;
    const auto enumSym = std::make_shared<EnumSymbol>(qualifiedName);

    for (const auto& genParam : decl.genericParams.params)
    {
        enumSym->addGenericParam(genParam.name.token_name, genParam.constraints);
    }

    enumSym->isUnion = decl.isUnion;
    for (const auto& field : decl.fields)
    {
        enumSym->fields.push_back(EnumFieldInfo{field.name.token_name, field.type});
    }
    if (!enumSym->fields.empty() && enumSym->fields.front().type.kind != TypeKind::INTEGER)
    {
        BINDER_ERROR(DiagnosticCode::TYPE_MISMATCH,
                     "the first field of enum '" + qualifiedName + "' defines its flag and must be an integer", decl,
                     decl.name.location);
    }
    if (!enumSym->fields.empty() && decl.isUnion)
    {
        BINDER_ERROR(DiagnosticCode::TYPE_MISMATCH, "a union cannot declare constant fields", decl,
                     decl.name.location);
    }

    for (const auto& variant : decl.values)
    {
        if (enumSym->hasVariant(variant.name.token_name))
        {
            BINDER_ERROR(DiagnosticCode::DUPLICATE_DEFINITION,
                         "enum variant '" + variant.name.token_name + "' is already defined", variant,
                         variant.name.location);
        }
        else
        {
            if (!decl.isUnion && !variant.types.empty())
            {
                BINDER_ERROR(DiagnosticCode::TYPE_MISMATCH,
                             "enum variant '" + variant.name.token_name +
                             "' carries a payload: declare '" + decl.name.token_name + "' as a union",
                             variant, variant.name.location);
            }
            enumSym->addVariant(variant.name.token_name, variant.types);
            if (enumSym->fields.empty())
            {
                continue;
            }
            auto& added = enumSym->variants.back();
            if (!variant.types.empty() || variant.constants.size() != enumSym->fields.size())
            {
                BINDER_ERROR(DiagnosticCode::TYPE_MISMATCH,
                             "enum variant '" + variant.name.token_name + "' must provide " +
                             std::to_string(enumSym->fields.size()) + " constant value(s)",
                             variant, variant.name.location);
            }
            added.constants = variant.constants;

            const Expression* flagExpr = variant.constants.front().get();
            bool negative = false;
            if (const auto* unary = dynamic_cast<const UnaryExpression*>(flagExpr);
                unary && unary->op == TokenType::MINUS)
            {
                negative = true;
                flagExpr = unary->operand.get();
            }
            const auto* flagLiteral = dynamic_cast<const IntegerLiteral*>(flagExpr);
            if (!flagLiteral)
            {
                BINDER_ERROR(DiagnosticCode::TYPE_MISMATCH, "the flag of an enum variant must be an integer literal",
                             variant, variant.name.location);
            }
            const long long flag = (negative ? -1 : 1) * std::stoll(flagLiteral->value, nullptr, 0);
            added.tag = static_cast<unsigned>(flag);
            for (size_t other = 0; other + 1 < enumSym->variants.size(); ++other)
            {
                if (enumSym->variants[other].tag == added.tag)
                {
                    BINDER_ERROR(DiagnosticCode::DUPLICATE_DEFINITION,
                                 "enum variant '" + variant.name.token_name + "' repeats the flag value of '" +
                                 enumSym->variants[other].name + "'",
                                 variant, variant.name.location);
                }
            }
        }
    }

    if (!_global_scope->defineEnum(enumSym))
    {
        BINDER_ERROR(DiagnosticCode::DUPLICATE_DEFINITION, "enum '" + qualifiedName + "' is already defined", decl,
                     decl.name.location);
    }
}