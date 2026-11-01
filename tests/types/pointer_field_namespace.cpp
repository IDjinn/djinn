#include <gtest/gtest.h>
#include "DjinnCompiler.h"

TEST(PointerField, ComparesWithLocalInsideNamespace)
{
    const auto source = R"(
        namespace sample;

        extern "C" {
            void* malloc(u64 size);
        }

        struct Node {
            i32 value;
        }

        struct Holder {
            Node* node;
        }

        i32 main() {
            Node* pointer = (Node*)malloc(sizeof(Node));
            Holder* holder = (Holder*)malloc(sizeof(Holder));
            holder.node = pointer;
            if (holder.node == pointer) {
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
