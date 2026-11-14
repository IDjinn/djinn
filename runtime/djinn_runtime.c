#include "runtime_internal.h"
#if !defined(__SIZEOF_INT128__) && defined(_MSC_VER)
#include <intrin.h>
#endif

Logger* logger;

static inline uint64_t djinn_read64(const char* p)
{
    uint64_t value;
    memcpy(&value, p, 8);
    return value;
}

static inline uint64_t djinn_read32(const char* p)
{
    uint32_t value;
    memcpy(&value, p, 4);
    return value;
}

static inline uint64_t djinn_mix(uint64_t a, uint64_t b)
{
#if defined(__SIZEOF_INT128__)
    __uint128_t product = (__uint128_t)a * b;
    return (uint64_t)product ^ (uint64_t)(product >> 64);
#else
    uint64_t high;
    uint64_t low = _umul128(a, b, &high);
    return low ^ high;
#endif
}

uint64_t __djinn_hash_string(const char* data, uint32_t length)
{
    const uint64_t k0 = 0xa0761d6478bd642full;
    const uint64_t k1 = 0xe7037ed1a0b428dbull;
    uint64_t seed = 0x9e3779b97f4a7c15ull ^ length;
    uint32_t remaining = length;
    while (remaining > 16)
    {
        seed = djinn_mix(djinn_read64(data) ^ k0, djinn_read64(data + 8) ^ seed);
        data += 16;
        remaining -= 16;
    }
    uint64_t a = 0;
    uint64_t b = 0;
    if (remaining >= 8)
    {
        a = djinn_read64(data);
        b = djinn_read64(data + remaining - 8);
    }
    else if (remaining >= 4)
    {
        a = djinn_read32(data);
        b = djinn_read32(data + remaining - 4);
    }
    else if (remaining > 0)
    {
        a = ((uint64_t)(uint8_t)data[0] << 16) | ((uint64_t)(uint8_t)data[remaining >> 1] << 8) | (uint8_t)data[remaining - 1];
    }
    return djinn_mix(a ^ k1, b ^ seed);
}

int64_t __djinn_unix_timestamp_ms(void)
{
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (int64_t)ts.tv_sec * 1000LL + ts.tv_nsec / 1000000LL;
}

uint32_t __djinn_compare_strings(
    char* leftData,
    char* rightData,
    size_t leftLen,
    size_t rightLen
)
{
    if (leftLen != rightLen)
        return 0;

    if (leftData == rightData) return 1;

    if (!leftData || !rightData)
        return 0;

    return memcmp(leftData, rightData, leftLen) == 0;
}

DJINN_ATTR_NONNULL_1
void __djinn_free(void* pointer)
{
    DJINN_TRACE("de-allocating heap memory at %p", pointer);
    free(pointer);
}

int32_t __djinn_atomic_add(int32_t* counter, int32_t delta)
{
    return __atomic_fetch_add(counter, delta, __ATOMIC_ACQ_REL);
}

int32_t __djinn_atomic_load_i32(int32_t* target)
{
    return __atomic_load_n(target, __ATOMIC_SEQ_CST);
}

void __djinn_atomic_store_i32(int32_t* target, int32_t value)
{
    __atomic_store_n(target, value, __ATOMIC_SEQ_CST);
}

int32_t __djinn_atomic_exchange_i32(int32_t* target, int32_t value)
{
    return __atomic_exchange_n(target, value, __ATOMIC_SEQ_CST);
}

int32_t __djinn_atomic_cas_i32(int32_t* target, int32_t expected, int32_t desired)
{
    return __atomic_compare_exchange_n(target, &expected, desired, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
}

int64_t __djinn_atomic_load_i64(int64_t* target)
{
    return __atomic_load_n(target, __ATOMIC_SEQ_CST);
}

void __djinn_atomic_store_i64(int64_t* target, int64_t value)
{
    __atomic_store_n(target, value, __ATOMIC_SEQ_CST);
}

int64_t __djinn_atomic_exchange_i64(int64_t* target, int64_t value)
{
    return __atomic_exchange_n(target, value, __ATOMIC_SEQ_CST);
}

int64_t __djinn_atomic_add_i64(int64_t* target, int64_t delta)
{
    return __atomic_fetch_add(target, delta, __ATOMIC_SEQ_CST);
}

int32_t __djinn_atomic_cas_i64(int64_t* target, int64_t expected, int64_t desired)
{
    return __atomic_compare_exchange_n(target, &expected, desired, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
}

DJINN_ATTR_REALLOC
void* __djinn_realloc(void* pointer, size_t new_size)
{
    void* chunk = realloc(pointer, new_size);
    DJINN_ASSERT(chunk, "Out of memory");
    DJINN_TRACE("re-allocated size %zu on heap at %p", new_size, chunk);
    return chunk;
}

DJINN_ATTR_MALLOC
void* __djinn_alloc(size_t size)
{
    DJINN_ASSERT(size > 0, "Size need be greater than zero!");
    void* chunk = malloc(size);
    DJINN_ASSERT(chunk, "Out of memory");
    DJINN_TRACE("allocated size %zu on heap at %p", size, chunk);
    return chunk;
}

DJINN_ATTR_MALLOC
void* __djinn_alloc_zeroed(size_t size)
{
    DJINN_ASSERT(size > 0, "Size need be greater than zero!");
    void* chunk = calloc(1, size);
    DJINN_ASSERT(chunk, "Out of memory");
    DJINN_TRACE("allocated zeroed size %zu on heap at %p", size, chunk);
    return chunk;
}

// Programs and libraries built by an older djinnc still import the zeroing allocator under this name.
DJINN_ATTR_MALLOC
void* __djinn_malloc(size_t size)
{
    return __djinn_alloc_zeroed(size);
}

DJINN_ATTR_MALLOC_ALIGNED
void* __djinn_malloc_aligned(size_t size, size_t alignment)
{
    DJINN_ASSERT(size > 0, "Size need be greater than zero!");
    DJINN_ASSERT(alignment != 0 && (alignment & (alignment - 1)) == 0, "Alignment need be a power of two!");
    if (alignment < sizeof(void*)) alignment = sizeof(void*);
    void* raw = calloc(1, size + alignment + sizeof(void*));
    DJINN_ASSERT(raw, "Out of memory");
    uintptr_t address = ((uintptr_t)raw + sizeof(void*) + alignment - 1) & ~((uintptr_t)alignment - 1);
    ((void**)address)[-1] = raw;
    DJINN_TRACE("allocated size %zu aligned to %zu on heap at %p", size, alignment, (void*)address);
    return (void*)address;
}

void __djinn_free_aligned(void* pointer)
{
    if (!pointer) return;
    DJINN_TRACE("de-allocating aligned heap memory at %p", pointer);
    free(((void**)pointer)[-1]);
}

#ifdef _WIN32
int64_t __djinn_now_us(void)
{
    static int64_t frequency = 0;
    if (frequency == 0)
    {
        LARGE_INTEGER queried;
        QueryPerformanceFrequency(&queried);
        frequency = queried.QuadPart;
    }

    LARGE_INTEGER counter;
    QueryPerformanceCounter(&counter);
    const int64_t seconds = counter.QuadPart / frequency;
    const int64_t remainder = counter.QuadPart % frequency;
    return seconds * 1000000 + remainder * 1000000 / frequency;
}

int __djinn_argc(void)
{
    return __argc;
}

char* __djinn_argv(int index)
{
    if (index < 0 || index >= __argc || !__argv) return NULL;
    return __argv[index];
}
#else
static int djinn_saved_argc = 0;
static char** djinn_saved_argv = NULL;

// glibc and dyld pass (argc, argv, envp) to initializers in .init_array
__attribute__((constructor)) static void djinn_capture_args(int argc, char** argv, char** envp)
{
    (void)envp;
    djinn_saved_argc = argc;
    djinn_saved_argv = argv;
}

int64_t __djinn_now_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

#ifdef __linux__
extern char* program_invocation_name;
#endif

int __djinn_argc(void)
{
#ifdef __linux__
    if (djinn_saved_argc == 0) return 1;
#endif
    return djinn_saved_argc;
}

char* __djinn_argv(int index)
{
#ifdef __linux__
    if (djinn_saved_argc == 0) return index == 0 ? program_invocation_name : NULL;
#endif
    if (index < 0 || index >= djinn_saved_argc || !djinn_saved_argv) return NULL;
    return djinn_saved_argv[index];
}
#endif

int __djinn_jit;

int __djinn_call_entry(void* address)
{
    __djinn_jit = 1;
    return ((int (*)(void))address)();
}

void __djinn_call_method(void* address, void* target)
{
    __djinn_jit = 1;
    ((void (*)(void*))address)(target);
}

void* __djinn_call_entry_handle(void* address)
{
    __djinn_jit = 1;
    return ((void* (*)(void))address)();
}

void* __djinn_call_method_handle(void* address, void* target)
{
    __djinn_jit = 1;
    return ((void* (*)(void*))address)(target);
}

static void** reflected_types;
static int32_t reflected_type_count;

void __djinn_reflect_register(void** types, int32_t count)
{
    reflected_types = types;
    reflected_type_count = count;
}

static void** invoke_entries;
static int32_t invoke_count;

void __djinn_invoke_register(void** entries, int32_t count)
{
    invoke_entries = entries;
    invoke_count = count;
}

void* __djinn_invoke_lookup(void* function)
{
    for (int32_t i = 0; i < invoke_count; i++) {
        if (invoke_entries[i * 2] == function) {
            return invoke_entries[i * 2 + 1];
        }
    }
    return 0;
}

void __djinn_invoke_call(void* thunk, void* target, void** args, void* out)
{
    ((void (*)(void*, void**, void*))thunk)(target, args, out);
}

int32_t __djinn_reflected_count(void)
{
    return reflected_type_count;
}

void* __djinn_reflected_type(int32_t index)
{
    return reflected_types[index];
}

