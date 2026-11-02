#include <gtest/gtest.h>
#include "DjinnCompiler.h"

TEST(AddressOf, StructLocalComparesWithItsPointer)
{
    const auto source = R"(
        namespace sample;

        struct Node {
            i32 value;
        }

        i32 main() {
            Node a = { value: 7 };
            Node* p = &a;
            Node* q = &a;
            if (p == q) {
                return p.value;
            }
            return 0;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 7);
}

TEST(AddressOf, IntegerLocalDereferencesToItsValue)
{
    const auto source = R"(
        namespace sample;

        i32 main() {
            i32 x = 5;
            i32* p = &x;
            return *p;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 5);
}
