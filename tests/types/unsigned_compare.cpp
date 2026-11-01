#include <gtest/gtest.h>
#include "DjinnCompiler.h"

TEST(UnsignedCompare, EqualsConstantAboveI32Max)
{
    const auto source = R"(
        const u32 LIMIT = 4294967295;

        i32 main() {
            u32 value = 4294967295;
            if (value == LIMIT) {
                return 1;
            }
            return 0;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 1);
}

TEST(UnsignedCompare, OrderingUsesUnsignedPredicates)
{
    const auto source = R"(
        i32 main() {
            u32 high = 4000000000;
            u32 low = 5;
            if (high > low) {
                return 1;
            }
            return 0;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 1);
}

TEST(UnsignedCompare, CastWidensWithZeroExtension)
{
    const auto source = R"(
        i32 main() {
            u32 value = 4294967295;
            u64 wide = 4294967295;
            if ((u64)value == wide) {
                return 1;
            }
            return 0;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 1);
}

TEST(UnsignedCompare, SignedStillOrdersNegatives)
{
    const auto source = R"(
        i32 main() {
            i32 negative = -5;
            if (negative < 3) {
                return 1;
            }
            return 0;
        }
    )";

    const auto result = DjinnCompiler::run(
        source, {.optimizationLevel = 0, .generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 1);
}
