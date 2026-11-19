#include "runtime_internal.h"

#include <stdatomic.h>
#ifdef _WIN32
#include <malloc.h>
#elif defined(__APPLE__)
#include <malloc/malloc.h>
#else
#include <malloc.h>
#endif

Logger* logger;

// Allocation statistics (see __djinn_alloc_stats): every block that goes through the allocator below is counted, with
// the size the heap really reserved for it, so a free can take the same number back out. Relaxed atomics: the
// counters are read for display, they order nothing.
static _Atomic uint64_t djinn_stat_allocs;
static _Atomic uint64_t djinn_stat_frees;
static _Atomic uint64_t djinn_stat_total_bytes;
static _Atomic uint64_t djinn_stat_live_bytes;
static _Atomic uint64_t djinn_stat_peak_bytes;

static size_t djinn_usable_size(void* pointer)
{
#ifdef _WIN32
    return _msize(pointer);
#elif defined(__APPLE__)
    return malloc_size(pointer);
#else
    return malloc_usable_size(pointer);
#endif
}

static void djinn_stat_grow(size_t bytes)
{
    uint64_t live = atomic_fetch_add_explicit(&djinn_stat_live_bytes, bytes, memory_order_relaxed) + bytes;
    uint64_t peak = atomic_load_explicit(&djinn_stat_peak_bytes, memory_order_relaxed);
    while (live > peak && !atomic_compare_exchange_weak_explicit(&djinn_stat_peak_bytes, &peak, live, memory_order_relaxed, memory_order_relaxed)) {
    }
}

static void djinn_stat_alloc(void* chunk)
{
    size_t bytes = djinn_usable_size(chunk);
    atomic_fetch_add_explicit(&djinn_stat_allocs, 1, memory_order_relaxed);
    atomic_fetch_add_explicit(&djinn_stat_total_bytes, bytes, memory_order_relaxed);
    djinn_stat_grow(bytes);
}

static void djinn_stat_free(void* pointer)
{
    atomic_fetch_add_explicit(&djinn_stat_frees, 1, memory_order_relaxed);
    atomic_fetch_sub_explicit(&djinn_stat_live_bytes, djinn_usable_size(pointer), memory_order_relaxed);
}

// out[0..4] = blocks allocated, blocks freed, bytes allocated in all, bytes alive now, the most bytes alive at once.
void __djinn_alloc_stats(uint64_t* out)
{
    out[0] = atomic_load_explicit(&djinn_stat_allocs, memory_order_relaxed);
    out[1] = atomic_load_explicit(&djinn_stat_frees, memory_order_relaxed);
    out[2] = atomic_load_explicit(&djinn_stat_total_bytes, memory_order_relaxed);
    out[3] = atomic_load_explicit(&djinn_stat_live_bytes, memory_order_relaxed);
    out[4] = atomic_load_explicit(&djinn_stat_peak_bytes, memory_order_relaxed);
}

int64_t __djinn_unix_timestamp_ms(void)
{
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (int64_t)ts.tv_sec * 1000LL + ts.tv_nsec / 1000000LL;
}

// Like free: a null pointer is accepted and ignored, so code can release optional buffers without a check.
void __djinn_free(void* pointer)
{
    if (pointer == NULL) {
        return;
    }
    DJINN_TRACE("de-allocating heap memory at %p", pointer);
    djinn_stat_free(pointer);
    free(pointer);
}

// A closure environment starts with its drop function: it disposes the captured values, then the block is freed.
void __djinn_closure_drop(void* env)
{
    if (env == NULL) {
        return;
    }
    void (*drop)(void*) = *(void (**)(void*))env;
    if (drop != NULL) {
        drop(env);
    }
    djinn_stat_free(env);
    free(env);
}

DJINN_ATTR_REALLOC
void* __djinn_realloc(void* pointer, size_t new_size)
{
    size_t before = pointer != NULL ? djinn_usable_size(pointer) : 0;
    void* chunk = realloc(pointer, new_size);
    DJINN_ASSERT(chunk, "Out of memory");
    if (pointer == NULL) {
        djinn_stat_alloc(chunk);
    } else {
        size_t after = djinn_usable_size(chunk);
        atomic_fetch_add_explicit(&djinn_stat_total_bytes, after > before ? after - before : 0, memory_order_relaxed);
        if (after >= before) {
            djinn_stat_grow(after - before);
        } else {
            atomic_fetch_sub_explicit(&djinn_stat_live_bytes, before - after, memory_order_relaxed);
        }
    }
    DJINN_TRACE("re-allocated size %zu on heap at %p", new_size, chunk);
    return chunk;
}

DJINN_ATTR_MALLOC
void* __djinn_alloc(size_t size)
{
    DJINN_ASSERT(size > 0, "Size need be greater than zero!");
    void* chunk = malloc(size);
    DJINN_ASSERT(chunk, "Out of memory");
    djinn_stat_alloc(chunk);
    DJINN_TRACE("allocated size %zu on heap at %p", size, chunk);
    return chunk;
}

DJINN_ATTR_MALLOC
void* __djinn_alloc_zeroed(size_t size)
{
    DJINN_ASSERT(size > 0, "Size need be greater than zero!");
    void* chunk = calloc(1, size);
    DJINN_ASSERT(chunk, "Out of memory");
    djinn_stat_alloc(chunk);
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
    djinn_stat_alloc(raw);
    uintptr_t address = ((uintptr_t)raw + sizeof(void*) + alignment - 1) & ~((uintptr_t)alignment - 1);
    ((void**)address)[-1] = raw;
    DJINN_TRACE("allocated size %zu aligned to %zu on heap at %p", size, alignment, (void*)address);
    return (void*)address;
}

void __djinn_free_aligned(void* pointer)
{
    if (!pointer) return;
    DJINN_TRACE("de-allocating aligned heap memory at %p", pointer);
    void* raw = ((void**)pointer)[-1];
    djinn_stat_free(raw);
    free(raw);
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

// Stands in for the coroutine wrappers every program generates, in the JIT that runs procedural macros.
void __djinn_proc_stub(void)
{
}

// A procedural macro entry: tokens in as records, records out in a buffer the macro allocates.
uint64_t __djinn_call_proc(void* address, const char* data, uint64_t length, char** result)
{
    return ((uint64_t (*)(const char*, uint64_t, char**))address)(data, length, result);
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

