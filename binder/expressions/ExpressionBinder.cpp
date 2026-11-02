//
// Expression dispatcher - routes to specific binders via visitor pattern
//

#include "../Binder.h"
#include "../visitors/BinderExpressionVisitor.h"

std::shared_ptr<Symbol> Binder::bindExpression(const Expression &expr) {
    djinn::BinderExpressionVisitor visitor(*this);
    expr.accept(visitor);
    auto result = visitor.result();
    if (result && result->type.kind != TypeKind::AUTO)
        _global_scope->expressionTypes.insert_or_assign(&expr, result->type);
    return result;
}