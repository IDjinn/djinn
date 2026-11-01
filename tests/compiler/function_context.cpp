#include <gtest/gtest.h>
#include "TestHelpers.h"

#include "DjinnCompiler.h"

// Function emission is reentrant: instantiating a generic type in the middle of a
// function must not leak that function's contracts, throws flag or scopes into the
// generated methods, and must not corrupt the caller once it returns.

TEST(FunctionContext, GenericMethodInsideLoopOfContractFunction)
{
    const auto source = R"(
        struct Box<T> {
            T value;

            public T get() {
                return this.value;
            }
        }

        i32 sum_boxes(i32 n)
            ensure(return >= 0)
        {
            mut i32 total = 0;
            mut i32 i = 0;
            while (i < n) {
                Box<i32> box = { .value = i };
                total = total + box.get();
                i = i + 1;
                if (i > 100) {
                    break;
                }
            }
            return total;
        }

        i32 main() {
            i32 result = try sum_boxes(4) ?: -1;
            return result;
        }
    )";

    const auto result = DjinnCompiler::run(source, {.generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_TRUE(result.verifiedIr);
    EXPECT_EQ(result.returnCode, 6);
}

TEST(FunctionContext, BreakAndContinueAfterGenericInstantiation)
{
    const auto source = R"(
        struct Box<T> {
            T value;

            public T get() {
                while (true) {
                    break;
                }
                return this.value;
            }
        }

        i32 main() {
            mut i32 total = 0;
            for (mut i32 i = 0; i < 10; i = i + 1) {
                Box<i32> box = { .value = i };
                if (box.get() % 2 == 0) {
                    continue;
                }
                if (i > 6) {
                    break;
                }
                total = total + box.get();
            }
            return total;
        }
    )";

    const auto result = DjinnCompiler::run(source, {.generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_TRUE(result.verifiedIr);
    EXPECT_EQ(result.returnCode, 9);
}

TEST(FunctionContext, MonomorphizedStructVisibleToLaterFunctions)
{
    const auto source = R"(
        struct Box<T> {
            T value;

            public T get() {
                return this.value;
            }
        }

        i32 first() {
            Box<i32> box = { .value = 3 };
            return box.get();
        }

        i32 second() {
            Box<i32> box = { .value = 4 };
            return box.get();
        }

        i32 main() {
            return first() + second();
        }
    )";

    const auto result = DjinnCompiler::run(source, {.generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_TRUE(result.verifiedIr);
    EXPECT_EQ(result.returnCode, 7);
}

TEST(FunctionContext, PointerFieldMethodDispatchThroughAuto)
{
    const auto source = R"(
        struct Node {
            i32 value;

            public i32 get() {
                return this.value;
            }
        }

        struct Holder {
            Node* node;
        }

        i32 main() {
            Node n = { .value = 9 };
            Holder h = { .node = &n };
            auto p = h.node;
            return p.get();
        }
    )";

    const auto result = DjinnCompiler::run(source, {.generateBinary = true, .includeStd = false});
    EXPECT_EQ(result.diagnostics.size(), 0);
    EXPECT_EQ(result.returnCode, 9);
}

TEST(Determinism, SameSourceProducesIdenticalIr)
{
    const auto source = R"(
        struct Alpha { i32 a; }
        struct Beta { i32 b; }
        struct Gamma { i32 c; }

        struct Box<T> {
            T value;

            public T get() {
                return this.value;
            }
        }

        i32 zeta() { return 1; }
        i32 alpha() { return 2; }
        i32 middle() { return 3; }

        i32 main() {
            Alpha x = { .a = zeta() };
            Beta y = { .b = alpha() };
            Gamma z = { .c = middle() };
            Box<i32> box = { .value = x.a + y.b + z.c };
            return box.get();
        }
    )";

    const CompilerOptions options{.optimizationLevel = 0, .includeStd = false};
    const auto first = DjinnCompiler::run(source, options);
    const auto second = DjinnCompiler::run(source, options);

    ASSERT_FALSE(first.ir.empty());
    EXPECT_EQ(first.ir, second.ir);
}
