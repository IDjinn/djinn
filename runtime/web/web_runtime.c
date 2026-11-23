// The Djinn runtime for the web target (wasm32-unknown-unknown, freestanding): one translation unit, no libc.
//
// Everything Djinn code and the generated code call is defined here with the signatures Djinn declares (sizes are
// 64-bit, as on the desktop targets), and the few services only the browser has come from imports of the "djinn"
// module, provided by runtime/web/djinn.js. There is one thread; the event loop never blocks: it runs what is ready and
// returns, and the host calls djinn_tick() again when a timer is due or an event arrived.
#include <stdint.h>
#include <stdarg.h>
#include <stddef.h>
#include <string.h>

typedef __SIZE_TYPE__ size_t;

#define DJINN_IMPORT(name) __attribute__((import_module("djinn"), import_name(#name)))
#define DJINN_EXPORT(name) __attribute__((export_name(#name)))

DJINN_IMPORT(console_write) void web_console_write(int32_t fd, const char* data, int32_t length);
DJINN_IMPORT(now_ms) double web_now_ms(void);
DJINN_IMPORT(unix_ms) double web_unix_ms(void);
DJINN_IMPORT(timer_set) void web_timer_set(double milliseconds);
DJINN_IMPORT(panic) void web_panic(const char* message, int32_t length);
DJINN_IMPORT(exit) void web_exit(int32_t code);
DJINN_IMPORT(format_f64) int32_t web_format_f64(double value, int32_t precision, int32_t conversion, char* out, int32_t capacity);
DJINN_IMPORT(parse_f64) double web_parse_f64(const char* text, int32_t length);
DJINN_IMPORT(math1) double web_math1(int32_t op, double x);
DJINN_IMPORT(math2) double web_math2(int32_t op, double a, double b);

// ── Memory ──────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Blocks up to 64 KB come from power-of-two size classes with one free list each; bigger ones are kept in a first-fit
// list of freed blocks. Every block has a 16-byte header (its capacity) so payloads stay 16-byte aligned. Memory only
// grows, as a WebAssembly memory cannot shrink.

extern unsigned char __heap_base;

#define HEADER 16u
#define SMALL_CLASSES 13
#define SMALL_LIMIT (16u << (SMALL_CLASSES - 1))

typedef struct free_block
{
    struct free_block* next;
} free_block_t;

static uintptr_t heap_top;
static uintptr_t heap_end;
static free_block_t* small_free[SMALL_CLASSES];
static free_block_t* large_free;

static int out_of_memory(void);

static uintptr_t grow_heap(size_t bytes)
{
    if (heap_top == 0)
    {
        heap_top = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
        heap_end = (uintptr_t)__builtin_wasm_memory_size(0) * 65536u;
    }
    if (heap_top + bytes > heap_end)
    {
        size_t missing = heap_top + bytes - heap_end;
        size_t pages = (missing + 65535u) / 65536u;
        if (pages < 16)
        {
            pages = 16;
        }
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1)
        {
            out_of_memory();
            return 0;
        }
        heap_end += pages * 65536u;
    }
    uintptr_t block = heap_top;
    heap_top += bytes;
    return block;
}

static int size_class(size_t size)
{
    int index = 0;
    size_t capacity = 16;
    while (capacity < size)
    {
        capacity <<= 1;
        index++;
    }
    return index;
}

static size_t capacity_of(void* pointer)
{
    return *(size_t*)((char*)pointer - HEADER);
}

static void* block_alloc(size_t size)
{
    if (size == 0)
    {
        size = 1;
    }
    if (size <= SMALL_LIMIT)
    {
        int index = size_class(size);
        free_block_t* reused = small_free[index];
        if (reused)
        {
            small_free[index] = reused->next;
            return reused;
        }
        size_t capacity = (size_t)16 << index;
        uintptr_t block = grow_heap(capacity + HEADER);
        *(size_t*)block = capacity;
        return (void*)(block + HEADER);
    }
    size_t capacity = (size + 4095u) & ~(size_t)4095u;
    free_block_t** link = &large_free;
    while (*link)
    {
        free_block_t* candidate = *link;
        if (capacity_of(candidate) >= capacity)
        {
            *link = candidate->next;
            return candidate;
        }
        link = &candidate->next;
    }
    uintptr_t block = grow_heap(capacity + HEADER);
    *(size_t*)block = capacity;
    return (void*)(block + HEADER);
}

static void block_free(void* pointer)
{
    if (!pointer)
    {
        return;
    }
    size_t capacity = capacity_of(pointer);
    free_block_t* block = (free_block_t*)pointer;
    if (capacity <= SMALL_LIMIT)
    {
        int index = size_class(capacity);
        block->next = small_free[index];
        small_free[index] = block;
        return;
    }
    block->next = large_free;
    large_free = block;
}

static void* block_realloc(void* pointer, size_t size)
{
    if (!pointer)
    {
        return block_alloc(size);
    }
    size_t capacity = capacity_of(pointer);
    if (size <= capacity)
    {
        return pointer;
    }
    void* grown = block_alloc(size);
    __builtin_memcpy(grown, pointer, capacity);
    block_free(pointer);
    return grown;
}

void* malloc(uint64_t size) { return block_alloc((size_t)size); }
void* realloc(void* pointer, uint64_t size) { return block_realloc(pointer, (size_t)size); }
void free(void* pointer) { block_free(pointer); }

void* calloc(uint64_t count, uint64_t size)
{
    size_t bytes = (size_t)(count * size);
    void* block = block_alloc(bytes);
    __builtin_memset(block, 0, bytes);
    return block;
}

void* __djinn_alloc(uint64_t size) { return block_alloc((size_t)size); }
void* __djinn_malloc(uint64_t size) { return block_alloc((size_t)size); }
void* __djinn_realloc(void* pointer, uint64_t size) { return block_realloc(pointer, (size_t)size); }
void __djinn_free(void* pointer) { block_free(pointer); }

void* __djinn_alloc_zeroed(uint64_t size)
{
    void* block = block_alloc((size_t)size);
    __builtin_memset(block, 0, (size_t)size);
    return block;
}

// An aligned block keeps the pointer to free in the word before it.
void* __djinn_malloc_aligned(uint64_t size, uint64_t alignment)
{
    if (alignment <= 16)
    {
        return block_alloc((size_t)size);
    }
    char* raw = (char*)block_alloc((size_t)(size + alignment + sizeof(void*)));
    uintptr_t aligned = ((uintptr_t)raw + sizeof(void*) + (uintptr_t)alignment - 1) & ~((uintptr_t)alignment - 1);
    ((void**)aligned)[-1] = raw;
    return (void*)aligned;
}

void __djinn_free_aligned(void* pointer)
{
    if (pointer)
    {
        block_free(((void**)pointer)[-1]);
    }
}

void __djinn_closure_drop(void* env)
{
    if (!env)
    {
        return;
    }
    void (*drop)(void*) = *(void (**)(void*))env;
    if (drop)
    {
        drop(env);
    }
    block_free(env);
}

DJINN_EXPORT(djinn_alloc) void* djinn_alloc(int32_t size) { return block_alloc((size_t)size); }
DJINN_EXPORT(djinn_free) void djinn_free(void* pointer) { block_free(pointer); }

// ── Bytes and text ──────────────────────────────────────────────────────────────────────────────────────────────────

#undef memcpy
#undef memmove
#undef memset

void* memcpy(void* destination, const void* source, uint64_t count)
{
    __builtin_memcpy(destination, source, (size_t)count);
    return destination;
}

void* memmove(void* destination, const void* source, uint64_t count)
{
    __builtin_memmove(destination, source, (size_t)count);
    return destination;
}

void* memset(void* destination, int32_t value, uint64_t count)
{
    __builtin_memset(destination, value, (size_t)count);
    return destination;
}

int32_t memcmp(const void* left, const void* right, uint64_t count)
{
    const unsigned char* a = (const unsigned char*)left;
    const unsigned char* b = (const unsigned char*)right;
    for (uint64_t i = 0; i < count; i++)
    {
        if (a[i] != b[i])
        {
            return a[i] < b[i] ? -1 : 1;
        }
    }
    return 0;
}

#define memcpy(d, s, n) __builtin_memcpy((d), (s), (n))
#define memmove(d, s, n) __builtin_memmove((d), (s), (n))
#define memset(d, v, n) __builtin_memset((d), (v), (n))

int32_t strlen(const char* text)
{
    int32_t length = 0;
    while (text[length])
    {
        length++;
    }
    return length;
}

static int is_space(int c) { return c == ' ' || (c >= 9 && c <= 13); }

static int digit_value(int c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'z') return c - 'a' + 10;
    if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
    return 99;
}

uint64_t strtoull(const char* text, char** end, int32_t base)
{
    const char* at = text;
    while (is_space(*at)) at++;
    int negative = 0;
    if (*at == '+' || *at == '-')
    {
        negative = *at == '-';
        at++;
    }
    if ((base == 0 || base == 16) && at[0] == '0' && (at[1] == 'x' || at[1] == 'X') && digit_value(at[2]) < 16)
    {
        at += 2;
        base = 16;
    }
    else if (base == 0 && at[0] == '0')
    {
        base = 8;
    }
    else if (base == 0)
    {
        base = 10;
    }
    const char* digits = at;
    uint64_t value = 0;
    while (digit_value(*at) < base)
    {
        value = value * (uint64_t)base + (uint64_t)digit_value(*at);
        at++;
    }
    if (end)
    {
        *end = (char*)(at == digits ? text : at);
    }
    return negative ? (uint64_t)0 - value : value;
}

int64_t strtoll(const char* text, char** end, int32_t base) { return (int64_t)strtoull(text, end, base); }
int64_t atoll(const char* text) { return strtoll(text, 0, 10); }
int32_t atoi(const char* text) { return (int32_t)strtoll(text, 0, 10); }

// The longest prefix that reads as a number (as strtod would take it), parsed by JavaScript for exact rounding.
double strtod(const char* text, char** end)
{
    const char* at = text;
    while (is_space(*at)) at++;
    const char* start = at;
    if (*at == '+' || *at == '-') at++;
    const char* body = at;
    if ((at[0] == 'i' || at[0] == 'I') && (at[1] == 'n' || at[1] == 'N') && (at[2] == 'f' || at[2] == 'F'))
    {
        at += 3;
        if ((at[0] == 'i' || at[0] == 'I') && (at[1] == 'n' || at[1] == 'N')) at += 5;
    }
    else if ((at[0] == 'n' || at[0] == 'N') && (at[1] == 'a' || at[1] == 'A') && (at[2] == 'n' || at[2] == 'N'))
    {
        at += 3;
    }
    else
    {
        int digits = 0;
        while (*at >= '0' && *at <= '9') { at++; digits++; }
        if (*at == '.')
        {
            at++;
            while (*at >= '0' && *at <= '9') { at++; digits++; }
        }
        if (digits == 0)
        {
            if (end) *end = (char*)text;
            return 0.0;
        }
        if (*at == 'e' || *at == 'E')
        {
            const char* exponent = at + 1;
            if (*exponent == '+' || *exponent == '-') exponent++;
            if (*exponent >= '0' && *exponent <= '9')
            {
                at = exponent;
                while (*at >= '0' && *at <= '9') at++;
            }
        }
    }
    if (at == body)
    {
        if (end) *end = (char*)text;
        return 0.0;
    }
    if (end) *end = (char*)at;
    return web_parse_f64(start, (int32_t)(at - start));
}

float strtof(const char* text, char** end) { return (float)strtod(text, end); }

double ldexp(double value, int exponent)
{
    while (exponent > 0) { value *= 2.0; exponent--; }
    while (exponent < 0) { value *= 0.5; exponent++; }
    return value;
}

float ldexpf(float value, int exponent) { return (float)ldexp(value, exponent); }

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────────────────────────

typedef struct sink
{
    char* buffer;
    size_t capacity;
    size_t length;
} sink_t;

static void put(sink_t* out, char c)
{
    if (out->length + 1 < out->capacity)
    {
        out->buffer[out->length] = c;
    }
    out->length++;
}

static void put_text(sink_t* out, const char* text, size_t length)
{
    for (size_t i = 0; i < length; i++)
    {
        put(out, text[i]);
    }
}

static void pad(sink_t* out, char c, int count)
{
    for (int i = 0; i < count; i++)
    {
        put(out, c);
    }
}

static int format_unsigned(char* digits, uint64_t value, unsigned base, int upper)
{
    const char* table = upper ? "0123456789ABCDEF" : "0123456789abcdef";
    int count = 0;
    do
    {
        digits[count++] = table[value % base];
        value /= base;
    } while (value != 0);
    return count;
}

int32_t vsnprintf(char* buffer, uint64_t capacity, const char* format, va_list args)
{
    sink_t out = {buffer, (size_t)capacity, 0};
    for (const char* at = format; *at; at++)
    {
        if (*at != '%')
        {
            put(&out, *at);
            continue;
        }
        at++;
        int left = 0, plus = 0, space = 0, alternate = 0, zero = 0;
        for (;; at++)
        {
            if (*at == '-') left = 1;
            else if (*at == '+') plus = 1;
            else if (*at == ' ') space = 1;
            else if (*at == '#') alternate = 1;
            else if (*at == '0') zero = 1;
            else break;
        }
        int width = 0;
        if (*at == '*')
        {
            width = va_arg(args, int);
            if (width < 0) { left = 1; width = -width; }
            at++;
        }
        else
        {
            while (*at >= '0' && *at <= '9') width = width * 10 + (*at++ - '0');
        }
        int precision = -1;
        if (*at == '.')
        {
            at++;
            precision = 0;
            if (*at == '*')
            {
                precision = va_arg(args, int);
                at++;
            }
            else
            {
                while (*at >= '0' && *at <= '9') precision = precision * 10 + (*at++ - '0');
            }
        }
        int longs = 0;
        while (*at == 'l' || *at == 'h' || *at == 'z' || *at == 'j' || *at == 't' || *at == 'L' || *at == 'q')
        {
            if (*at == 'l' || *at == 'j' || *at == 'q' || *at == 'L') longs++;
            at++;
        }
        char conversion = *at;
        if (conversion == 0)
        {
            break;
        }
        char digits[72];
        const char* prefix = "";
        int count = 0;
        switch (conversion)
        {
        case '%':
            put(&out, '%');
            continue;
        case 'c':
        {
            char c = (char)va_arg(args, int);
            if (!left) pad(&out, ' ', width - 1);
            put(&out, c);
            if (left) pad(&out, ' ', width - 1);
            continue;
        }
        case 's':
        {
            const char* text = va_arg(args, const char*);
            if (!text) text = "(null)";
            int length = 0;
            while (text[length] && (precision < 0 || length < precision)) length++;
            if (!left) pad(&out, ' ', width - length);
            put_text(&out, text, (size_t)length);
            if (left) pad(&out, ' ', width - length);
            continue;
        }
        case 'd':
        case 'i':
        {
            int64_t value = longs >= 2 ? va_arg(args, long long) : (longs == 1 ? (int64_t)va_arg(args, long) : (int64_t)va_arg(args, int));
            uint64_t magnitude = value < 0 ? (uint64_t)0 - (uint64_t)value : (uint64_t)value;
            count = format_unsigned(digits, magnitude, 10, 0);
            prefix = value < 0 ? "-" : (plus ? "+" : (space ? " " : ""));
            break;
        }
        case 'u':
        case 'x':
        case 'X':
        case 'o':
        case 'p':
        {
            uint64_t value;
            if (conversion == 'p')
            {
                value = (uint64_t)(uintptr_t)va_arg(args, void*);
                alternate = 1;
            }
            else
            {
                value = longs >= 2 ? va_arg(args, unsigned long long) : (longs == 1 ? (uint64_t)va_arg(args, unsigned long) : (uint64_t)va_arg(args, unsigned int));
            }
            unsigned base = conversion == 'o' ? 8 : (conversion == 'u' ? 10 : 16);
            count = format_unsigned(digits, value, base, conversion == 'X');
            if (alternate && base == 16 && (value != 0 || conversion == 'p')) prefix = conversion == 'X' ? "0X" : "0x";
            if (alternate && base == 8) prefix = "0";
            break;
        }
        case 'f':
        case 'F':
        case 'e':
        case 'E':
        case 'g':
        case 'G':
        case 'a':
        case 'A':
        {
            double value = va_arg(args, double);
            char text[400];
            int length = web_format_f64(value, precision < 0 ? 6 : precision, (int32_t)(unsigned char)conversion | (alternate << 8), text, (int32_t)sizeof(text));
            const char* sign = "";
            const char* body = text;
            if (text[0] == '-')
            {
                sign = "-";
                body = text + 1;
                length--;
            }
            else if (plus)
            {
                sign = "+";
            }
            else if (space)
            {
                sign = " ";
            }
            int signs = sign[0] ? 1 : 0;
            int finite = body[0] >= '0' && body[0] <= '9';
            int fill = width - length - signs;
            if (!left && !(zero && finite)) pad(&out, ' ', fill);
            put_text(&out, sign, (size_t)signs);
            if (!left && zero && finite) pad(&out, '0', fill);
            put_text(&out, body, (size_t)length);
            if (left) pad(&out, ' ', fill);
            continue;
        }
        default:
            put(&out, '%');
            put(&out, conversion);
            continue;
        }
        int zeros = precision > count ? precision - count : 0;
        if (precision == 0 && count == 1 && digits[0] == '0' && conversion != 'p') count = 0;
        int prefix_length = 0;
        while (prefix[prefix_length]) prefix_length++;
        int total = prefix_length + zeros + count;
        if (!left && !(zero && precision < 0)) pad(&out, ' ', width - total);
        put_text(&out, prefix, (size_t)prefix_length);
        if (!left && zero && precision < 0) pad(&out, '0', width - total);
        pad(&out, '0', zeros);
        for (int i = count - 1; i >= 0; i--) put(&out, digits[i]);
        if (left) pad(&out, ' ', width - total);
    }
    if (out.capacity > 0)
    {
        out.buffer[out.length < out.capacity ? out.length : out.capacity - 1] = 0;
    }
    return (int32_t)out.length;
}

int32_t snprintf(char* buffer, uint64_t capacity, const char* format, ...)
{
    va_list args;
    va_start(args, format);
    int32_t length = vsnprintf(buffer, capacity, format, args);
    va_end(args);
    return length;
}

int32_t sprintf(char* buffer, const char* format, ...)
{
    va_list args;
    va_start(args, format);
    int32_t length = vsnprintf(buffer, (uint64_t)1 << 30, format, args);
    va_end(args);
    return length;
}

static int32_t print_to(int32_t fd, const char* format, va_list args)
{
    char small[512];
    va_list copy;
    va_copy(copy, args);
    int32_t length = vsnprintf(small, sizeof(small), format, args);
    if (length < (int32_t)sizeof(small))
    {
        web_console_write(fd, small, length);
    }
    else
    {
        char* large = (char*)block_alloc((size_t)length + 1);
        vsnprintf(large, (uint64_t)length + 1, format, copy);
        web_console_write(fd, large, length);
        block_free(large);
    }
    va_end(copy);
    return length;
}

int32_t printf(const char* format, ...)
{
    va_list args;
    va_start(args, format);
    int32_t length = print_to(1, format, args);
    va_end(args);
    return length;
}

// FILE* is only ever stdout or stderr on the web: the stream pointer is the descriptor.
int32_t fprintf(void* stream, const char* format, ...)
{
    va_list args;
    va_start(args, format);
    int32_t length = print_to((int32_t)(uintptr_t)stream, format, args);
    va_end(args);
    return length;
}

int32_t puts(const char* text)
{
    web_console_write(1, text, strlen(text));
    web_console_write(1, "\n", 1);
    return 0;
}

int32_t putchar(int32_t c)
{
    char byte = (char)c;
    web_console_write(1, &byte, 1);
    return c;
}

int32_t fputs(const char* text, void* stream)
{
    web_console_write((int32_t)(uintptr_t)stream, text, strlen(text));
    return 0;
}

int32_t fputc(int32_t c, void* stream)
{
    char byte = (char)c;
    web_console_write((int32_t)(uintptr_t)stream, &byte, 1);
    return c;
}

int32_t putc(int32_t c, void* stream) { return fputc(c, stream); }

uint64_t fwrite(const void* data, uint64_t size, uint64_t count, void* stream)
{
    web_console_write((int32_t)(uintptr_t)stream, (const char*)data, (int32_t)(size * count));
    return count;
}

int32_t fflush(void* stream) { (void)stream; return 0; }

int64_t write(int32_t fd, const void* data, uint64_t count)
{
    if (fd != 1 && fd != 2)
    {
        return -1;
    }
    web_console_write(fd, (const char*)data, (int32_t)count);
    return (int64_t)count;
}

int64_t read(int32_t fd, void* data, uint64_t count) { (void)fd; (void)data; (void)count; return 0; }
int32_t close(int32_t fd) { (void)fd; return -1; }
char* getenv(const char* name) { (void)name; return 0; }
int32_t system(const char* command) { (void)command; return -1; }

void abort(void)
{
    web_panic("abort", 5);
    __builtin_trap();
}

void exit(int32_t code)
{
    web_exit(code);
    __builtin_trap();
}

static int out_of_memory(void)
{
    web_panic("out of memory", 13);
    __builtin_trap();
    return 0;
}

// ── Math (from JavaScript's Math, which is correctly rounded where C requires it) ───────────────────────────────────

enum { M_SIN, M_COS, M_TAN, M_ASIN, M_ACOS, M_ATAN, M_SINH, M_COSH, M_TANH, M_ASINH, M_ACOSH, M_ATANH, M_EXP, M_EXP2,
       M_EXPM1, M_LOG, M_LOG10, M_LOG2, M_LOG1P, M_CBRT, M_ERF, M_ERFC, M_TGAMMA, M_LGAMMA };
enum { M_ATAN2, M_POW, M_HYPOT, M_REMAINDER, M_FMOD };

double sin(double x) { return web_math1(M_SIN, x); }
double cos(double x) { return web_math1(M_COS, x); }
double tan(double x) { return web_math1(M_TAN, x); }
double asin(double x) { return web_math1(M_ASIN, x); }
double acos(double x) { return web_math1(M_ACOS, x); }
double atan(double x) { return web_math1(M_ATAN, x); }
double sinh(double x) { return web_math1(M_SINH, x); }
double cosh(double x) { return web_math1(M_COSH, x); }
double tanh(double x) { return web_math1(M_TANH, x); }
double asinh(double x) { return web_math1(M_ASINH, x); }
double acosh(double x) { return web_math1(M_ACOSH, x); }
double atanh(double x) { return web_math1(M_ATANH, x); }
double exp(double x) { return web_math1(M_EXP, x); }
double exp2(double x) { return web_math1(M_EXP2, x); }
double expm1(double x) { return web_math1(M_EXPM1, x); }
double log(double x) { return web_math1(M_LOG, x); }
double log10(double x) { return web_math1(M_LOG10, x); }
double log2(double x) { return web_math1(M_LOG2, x); }
double log1p(double x) { return web_math1(M_LOG1P, x); }
double sqrt(double x) { return __builtin_sqrt(x); }
double cbrt(double x) { return web_math1(M_CBRT, x); }
double erf(double x) { return web_math1(M_ERF, x); }
double erfc(double x) { return web_math1(M_ERFC, x); }
double tgamma(double x) { return web_math1(M_TGAMMA, x); }
double lgamma(double x) { return web_math1(M_LGAMMA, x); }
double atan2(double a, double b) { return web_math2(M_ATAN2, a, b); }
double pow(double a, double b) { return web_math2(M_POW, a, b); }
double hypot(double a, double b) { return web_math2(M_HYPOT, a, b); }
double remainder(double a, double b) { return web_math2(M_REMAINDER, a, b); }
double fmod(double a, double b) { return web_math2(M_FMOD, a, b); }
float sinf(float x) { return (float)sin(x); }
float cosf(float x) { return (float)cos(x); }
float tanf(float x) { return (float)tan(x); }
float expf(float x) { return (float)exp(x); }
float logf(float x) { return (float)log(x); }
float powf(float a, float b) { return (float)pow(a, b); }
float atan2f(float a, float b) { return (float)atan2(a, b); }
float fmodf(float a, float b) { return (float)fmod(a, b); }
float erff(float x) { return (float)erf(x); }
float erfcf(float x) { return (float)erfc(x); }
float tgammaf(float x) { return (float)tgamma(x); }
float lgammaf(float x) { return (float)lgamma(x); }

// ── 128-bit integers ────────────────────────────────────────────────────────────────────────────────────────────────
//
// The WebAssembly backend lowers 128-bit multiplication and shifts to these calls; they work on 64-bit halves so they
// do not call themselves. Division and float conversions come from the shared runtime/int128.c.

typedef union
{
    unsigned __int128 all;
    struct
    {
        uint64_t low;
        uint64_t high;
    } s;
} u128_parts;

unsigned __int128 __ashlti3(unsigned __int128 value, int shift)
{
    u128_parts in = {value}, out;
    if (shift == 0) return value;
    if (shift >= 64)
    {
        out.s.low = 0;
        out.s.high = in.s.low << (shift - 64);
    }
    else
    {
        out.s.low = in.s.low << shift;
        out.s.high = (in.s.high << shift) | (in.s.low >> (64 - shift));
    }
    return out.all;
}

unsigned __int128 __lshrti3(unsigned __int128 value, int shift)
{
    u128_parts in = {value}, out;
    if (shift == 0) return value;
    if (shift >= 64)
    {
        out.s.high = 0;
        out.s.low = in.s.high >> (shift - 64);
    }
    else
    {
        out.s.high = in.s.high >> shift;
        out.s.low = (in.s.low >> shift) | (in.s.high << (64 - shift));
    }
    return out.all;
}

__int128 __ashrti3(__int128 value, int shift)
{
    u128_parts in = {(unsigned __int128)value}, out;
    if (shift == 0) return value;
    int64_t high = (int64_t)in.s.high;
    if (shift >= 64)
    {
        out.s.high = (uint64_t)(high >> 63);
        out.s.low = (uint64_t)(high >> (shift - 64));
    }
    else
    {
        out.s.high = (uint64_t)(high >> shift);
        out.s.low = (in.s.low >> shift) | (in.s.high << (64 - shift));
    }
    return (__int128)out.all;
}

static uint64_t multiply_high(uint64_t a, uint64_t b, uint64_t* low)
{
    uint64_t a0 = a & 0xFFFFFFFFu, a1 = a >> 32, b0 = b & 0xFFFFFFFFu, b1 = b >> 32;
    uint64_t p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    uint64_t middle = (p00 >> 32) + (p01 & 0xFFFFFFFFu) + (p10 & 0xFFFFFFFFu);
    *low = (p00 & 0xFFFFFFFFu) | (middle << 32);
    return p11 + (p01 >> 32) + (p10 >> 32) + (middle >> 32);
}

__int128 __multi3(__int128 left, __int128 right)
{
    u128_parts a = {(unsigned __int128)left}, b = {(unsigned __int128)right}, out;
    out.s.high = multiply_high(a.s.low, b.s.low, &out.s.low) + a.s.low * b.s.high + a.s.high * b.s.low;
    return (__int128)out.all;
}

#include "../int128.c"

// ── Reflection and calls ────────────────────────────────────────────────────────────────────────────────────────────

static void** reflected_types;
static int32_t reflected_type_count;
static void** invoke_entries;
static int32_t invoke_count;

void __djinn_reflect_register(void** types, int32_t count)
{
    reflected_types = types;
    reflected_type_count = count;
}

void __djinn_invoke_register(void** entries, int32_t count)
{
    invoke_entries = entries;
    invoke_count = count;
}

void* __djinn_invoke_lookup(void* function)
{
    for (int32_t i = 0; i < invoke_count; i++)
    {
        if (invoke_entries[i * 2] == function) return invoke_entries[i * 2 + 1];
    }
    return 0;
}

void __djinn_invoke_call(void* thunk, void* target, void** args, void* out)
{
    ((void (*)(void*, void**, void*))thunk)(target, args, out);
}

int32_t __djinn_reflected_count(void) { return reflected_type_count; }
void* __djinn_reflected_type(int32_t index) { return reflected_types[index]; }

int __djinn_call_entry(void* address) { return ((int (*)(void))address)(); }
void __djinn_call_method(void* address, void* target) { ((void (*)(void*))address)(target); }
void* __djinn_call_entry_handle(void* address) { return ((void* (*)(void))address)(); }
void* __djinn_call_method_handle(void* address, void* target) { return ((void* (*)(void*))address)(target); }
void __djinn_proc_stub(void) {}

// ── Errors and panics ───────────────────────────────────────────────────────────────────────────────────────────────

typedef struct djinn_error_info
{
    const char* message;
    const char* file;
    const char* line_text;
    uint32_t line;
    uint32_t column;
    uint32_t length;
    uint8_t op;
    uint8_t bits;
    uint8_t is_signed;
    uint8_t has_operands;
    uint64_t left;
    uint64_t right;
    const char* left_var_name;
    const void* left_var_slot;
    const char* right_var_name;
    const void* right_var_slot;
} djinn_error_info_t;

char __djinn_last_error_report[2048];

typedef void (*panic_hook_t)(const char* message, const char* file, uint32_t line);
static void* hooks[1];
static int in_panic_hook;

#define MAX_FRAMES 256
typedef struct
{
    const char* function_name;
    const char* file;
    uint32_t line;
} frame_t;
static frame_t frames[MAX_FRAMES];
static int frame_depth;
static char* error_stack;

static _Noreturn void fail_with_report(void)
{
    int32_t length = strlen(__djinn_last_error_report);
    web_console_write(2, __djinn_last_error_report, length);
    web_panic(__djinn_last_error_report, length);
    __builtin_trap();
}

static void append_stack(char* report, size_t capacity)
{
    size_t length = (size_t)strlen(report);
    for (int i = frame_depth - 1; i >= 0 && length + 1 < capacity; i--)
    {
        length += (size_t)snprintf(report + length, capacity - length, "  at %s (%s:%u)\n", frames[i].function_name,
            frames[i].file, frames[i].line);
    }
}

void __djinn_panic_default_report(const char* message, const char* file, uint32_t line)
{
    snprintf(__djinn_last_error_report, sizeof(__djinn_last_error_report), "panic: %s\n  --> %s:%u\n", message, file, line);
    append_stack(__djinn_last_error_report, sizeof(__djinn_last_error_report));
}

void __djinn_panic(const char* message, const char* file, uint32_t line)
{
    panic_hook_t hook = (panic_hook_t)hooks[0];
    if (hook && !in_panic_hook)
    {
        in_panic_hook = 1;
        hook(message, file, line);
        in_panic_hook = 0;
        snprintf(__djinn_last_error_report, sizeof(__djinn_last_error_report), "panic: %s\n", message);
    }
    else
    {
        __djinn_panic_default_report(message, file, line);
    }
    fail_with_report();
}

int32_t __djinn_errno(void) { return 0; }
void __djinn_errno_clear(void) {}
int32_t __djinn_last_error(void) { return 0; }

void __djinn_contract_observed(const char* message, const char* file, uint32_t line)
{
    char report[512];
    int32_t length = snprintf(report, sizeof(report), "observed: %s\n  --> %s:%u\n", message, file, (unsigned)line);
    if (length > (int32_t)sizeof(report) - 1) length = (int32_t)sizeof(report) - 1;
    web_console_write(2, report, length);
}

void* __djinn_hook_set(int32_t kind, void* handler)
{
    if (kind != 0) return 0;
    void* previous = hooks[0];
    hooks[0] = handler;
    return previous;
}

void* __djinn_hook_take(int32_t kind) { return __djinn_hook_set(kind, 0); }

void __djinn_hook_fire(int32_t kind, const char* message, const char* file, uint32_t line)
{
    (void)kind;
    (void)message;
    (void)file;
    (void)line;
}

static void report_error(const char* message, const char* file, uint32_t line, uint32_t column, uint8_t op, uint8_t bits,
                         uint8_t is_signed, uint8_t has_operands, uint64_t left, uint64_t right)
{
    char* report = __djinn_last_error_report;
    size_t capacity = sizeof(__djinn_last_error_report);
    int length = snprintf(report, capacity, "error: %s\n  --> %s:%u:%u\n", message, file, line, column);
    if (has_operands && length < (int)capacity)
    {
        uint64_t mask = bits >= 64 ? ~(uint64_t)0 : (((uint64_t)1 << bits) - 1);
        if (is_signed)
        {
            int64_t a = (int64_t)(left << (64 - bits)) >> (64 - bits);
            int64_t b = (int64_t)(right << (64 - bits)) >> (64 - bits);
            length += snprintf(report + length, capacity - (size_t)length, "  note: operands %lld %c %lld (i%u)\n", a, op, b, bits);
        }
        else
        {
            length += snprintf(report + length, capacity - (size_t)length, "  note: operands %llu %c %llu (u%u)\n", left & mask, op,
                right & mask, bits);
        }
    }
    append_stack(report, capacity);
}

void __djinn_runtime_error(const djinn_error_info_t* info)
{
    report_error(info->message, info->file, info->line, info->column, info->op, info->bits, info->is_signed,
        info->has_operands, info->left, info->right);
    fail_with_report();
}

void __djinn_runtime_error_min(const char* message, const char* file, uint32_t line, uint32_t column, uint8_t op,
                               uint8_t bits, uint8_t is_signed, uint8_t has_operands, uint64_t left, uint64_t right)
{
    report_error(message, file, line, column, op, bits, is_signed, has_operands, left, right);
    fail_with_report();
}

void __djinn_runtime_error_message(const char* message)
{
    snprintf(__djinn_last_error_report, sizeof(__djinn_last_error_report), "error: %s\n", message);
    fail_with_report();
}

void __djinn_uncaught_error(int tag, const char* type_name, const char* message, const char* origin_file,
                            uint32_t origin_line, uint32_t origin_column)
{
    (void)tag;
    int length = snprintf(__djinn_last_error_report, sizeof(__djinn_last_error_report), "uncaught error: %s: %s\n  --> %s:%u:%u\n",
        type_name ? type_name : "Error", message ? message : "", origin_file ? origin_file : "?", origin_line, origin_column);
    if (error_stack && length < (int)sizeof(__djinn_last_error_report))
    {
        snprintf(__djinn_last_error_report + length, sizeof(__djinn_last_error_report) - (size_t)length, "%s", error_stack);
    }
    fail_with_report();
}

void __djinn_var_track(const void* slot, const char* name, const char* line_text, uint32_t line)
{
    (void)slot; (void)name; (void)line_text; (void)line;
}

void __djinn_frame_push(const char* function_name, const char* file, uint32_t line)
{
    if (frame_depth < MAX_FRAMES)
    {
        frames[frame_depth].function_name = function_name;
        frames[frame_depth].file = file;
        frames[frame_depth].line = line;
    }
    frame_depth++;
}

void __djinn_frame_pop(void)
{
    if (frame_depth > 0) frame_depth--;
}

void __djinn_frame_set_line(uint32_t line)
{
    if (frame_depth > 0 && frame_depth <= MAX_FRAMES) frames[frame_depth - 1].line = line;
}

void __djinn_capture_error_stack(uint32_t line)
{
    __djinn_frame_set_line(line);
    char text[2048];
    text[0] = 0;
    append_stack(text, sizeof(text));
    block_free(error_stack);
    int32_t length = strlen(text);
    error_stack = (char*)block_alloc((size_t)length + 1);
    __builtin_memcpy(error_stack, text, (size_t)length + 1);
}

const char* __djinn_error_stack_text(void)
{
    const char* text = error_stack ? error_stack : "";
    int32_t length = strlen(text);
    char* copy = (char*)block_alloc((size_t)length + 1);
    __builtin_memcpy(copy, text, (size_t)length + 1);
    return copy;
}

void __djinn_link_debug_support(void) {}

// ── Time ────────────────────────────────────────────────────────────────────────────────────────────────────────────

int64_t __djinn_unix_timestamp_ms(void) { return (int64_t)web_unix_ms(); }
int64_t __djinn_monotonic_ms(void) { return (int64_t)web_now_ms(); }
int64_t __djinn_monotonic_precise_ms(void) { return (int64_t)web_now_ms(); }
int64_t __djinn_now_us(void) { return (int64_t)(web_now_ms() * 1000.0); }

// ── Scheduler ───────────────────────────────────────────────────────────────────────────────────────────────────────
//
// The same model as runtime/scheduler.c with one thread: a ready queue, a table of coroutines that wait (for a timer
// or a child) or have a parent to resume, and timers. djinn_tick() runs what is ready and fires due timers; when
// nothing is left it asks the host for a wake-up at the next deadline.

extern void __djinn_coro_resume(void* handle);
extern int __djinn_coro_done(void* handle);
extern void __djinn_coro_destroy(void* handle);
extern void* __djinn_coro_promise(void* handle, int align);

typedef struct
{
    void** items;
    uint32_t capacity;
    uint32_t head;
    uint32_t count;
} queue_t;

typedef struct
{
    void* handle;
    void* parent;
    int waiting;
} coro_entry_t;

typedef struct timer
{
    void* coro;
    double deadline;
    struct timer* next;
} timer_t_;

static queue_t ready;
static coro_entry_t* coros;
static uint32_t coro_capacity;
static uint32_t coro_count;
static timer_t_* timers;
static void* main_handle;
static int main_has_result;
static int main_finished;

static void enqueue(void* handle)
{
    if (ready.count == ready.capacity)
    {
        uint32_t capacity = ready.capacity ? ready.capacity * 2 : 64;
        void** items = (void**)block_alloc(capacity * sizeof(void*));
        for (uint32_t i = 0; i < ready.count; i++) items[i] = ready.items[(ready.head + i) % ready.capacity];
        block_free(ready.items);
        ready.items = items;
        ready.capacity = capacity;
        ready.head = 0;
    }
    ready.items[(ready.head + ready.count) % ready.capacity] = handle;
    ready.count++;
}

static void* dequeue(void)
{
    if (ready.count == 0) return 0;
    void* handle = ready.items[ready.head];
    ready.head = (ready.head + 1) % ready.capacity;
    ready.count--;
    return handle;
}

static uint32_t coro_slot(void* handle, uint32_t capacity)
{
    return (uint32_t)((((uint64_t)(uintptr_t)handle >> 4) * 0x9E3779B97F4A7C15ull) >> 32) & (capacity - 1);
}

static coro_entry_t* find_coro(void* handle)
{
    if (coro_count == 0) return 0;
    for (uint32_t i = coro_slot(handle, coro_capacity);; i = (i + 1) & (coro_capacity - 1))
    {
        if (coros[i].handle == handle) return &coros[i];
        if (coros[i].handle == 0) return 0;
    }
}

static coro_entry_t* place_coro(void* handle)
{
    uint32_t i = coro_slot(handle, coro_capacity);
    while (coros[i].handle) i = (i + 1) & (coro_capacity - 1);
    coros[i].handle = handle;
    coro_count++;
    return &coros[i];
}

static coro_entry_t* insert_coro(void* handle)
{
    coro_entry_t* found = find_coro(handle);
    if (found) return found;
    if ((coro_count + 1) * 2 > coro_capacity)
    {
        coro_entry_t* previous = coros;
        uint32_t previous_capacity = coro_capacity;
        coro_capacity = previous_capacity ? previous_capacity * 2 : 64;
        coros = (coro_entry_t*)calloc(coro_capacity, sizeof(coro_entry_t));
        coro_count = 0;
        for (uint32_t i = 0; i < previous_capacity; i++)
        {
            if (previous[i].handle) *place_coro(previous[i].handle) = previous[i];
        }
        block_free(previous);
    }
    return place_coro(handle);
}

static void release_coro(coro_entry_t* entry)
{
    if (entry->parent || entry->waiting) return;
    uint32_t mask = coro_capacity - 1;
    uint32_t hole = (uint32_t)(entry - coros);
    for (uint32_t i = (hole + 1) & mask; coros[i].handle; i = (i + 1) & mask)
    {
        uint32_t home = coro_slot(coros[i].handle, coro_capacity);
        if (((i - home) & mask) >= ((i - hole) & mask))
        {
            coros[hole] = coros[i];
            hole = i;
        }
    }
    coros[hole].handle = 0;
    coros[hole].parent = 0;
    coros[hole].waiting = 0;
    coro_count--;
}

void __djinn_mark_waiting(void* handle) { insert_coro(handle)->waiting = 1; }

static int is_in_waiting_set(void* handle)
{
    coro_entry_t* entry = find_coro(handle);
    return entry && entry->waiting;
}

static int take_waiting(void* handle)
{
    coro_entry_t* entry = find_coro(handle);
    if (!entry || !entry->waiting) return 0;
    entry->waiting = 0;
    release_coro(entry);
    return 1;
}

static void* pop_continuation(void* child)
{
    coro_entry_t* entry = find_coro(child);
    if (!entry || !entry->parent) return 0;
    void* parent = entry->parent;
    entry->parent = 0;
    release_coro(entry);
    return parent;
}

void __djinn_await(void* child, void* parent)
{
    insert_coro(child)->parent = parent;
    __djinn_mark_waiting(parent);
    if (!is_in_waiting_set(child)) enqueue(child);
}

void __djinn_spawn(void* handle) { enqueue(handle); }

void* __djinn_coro_alloc(uint64_t size) { return block_alloc((size_t)size); }
void __djinn_coro_free(void* frame, uint64_t size) { (void)size; block_free(frame); }

int64_t __djinn_async_sleep(int64_t milliseconds, void* coro)
{
    timer_t_* timer = (timer_t_*)block_alloc(sizeof(timer_t_));
    timer->coro = coro;
    timer->deadline = web_now_ms() + (double)(milliseconds > 0 ? milliseconds : 0);
    timer->next = timers;
    timers = timer;
    __djinn_mark_waiting(coro);
    return 0;
}

// Writing to the console completes at once: the coroutine is not marked waiting, so the loop resumes it next.
int64_t __djinn_async_write(int32_t fd, void* buffer, int64_t count, void* coro)
{
    (void)coro;
    web_console_write(fd, (const char*)buffer, (int32_t)count);
    return 0;
}

int64_t __djinn_async_read(int32_t fd, void* buffer, int64_t count, void* coro)
{
    (void)fd; (void)buffer; (void)count; (void)coro;
    return -1;
}

// Moves due timers to the ready queue; returns the delay to the next one, or -1 when none is left.
static double fire_timers(void)
{
    if (!timers) return -1;
    double now = web_now_ms();
    double next = -1;
    timer_t_** link = &timers;
    while (*link)
    {
        timer_t_* timer = *link;
        if (timer->deadline <= now)
        {
            *link = timer->next;
            take_waiting(timer->coro);
            enqueue(timer->coro);
            block_free(timer);
            continue;
        }
        double remaining = timer->deadline - now;
        if (next < 0 || remaining < next) next = remaining;
        link = &timer->next;
    }
    return next;
}

static void finish_coro(void* handle)
{
    take_waiting(handle);
    void* parent = pop_continuation(handle);
    if (parent)
    {
        take_waiting(parent);
        enqueue(parent);
    }
    else if (handle == main_handle)
    {
        main_finished = 1;
    }
    else
    {
        __djinn_coro_destroy(handle);
    }
}

static void run_ready(void)
{
    void* handle;
    while ((handle = dequeue()) != 0)
    {
        if (!__djinn_coro_done(handle))
        {
            __djinn_coro_resume(handle);
            if (!__djinn_coro_done(handle))
            {
                if (!take_waiting(handle)) enqueue(handle);
                continue;
            }
        }
        finish_coro(handle);
    }
}

static void finish_main(void)
{
    if (!main_handle || !main_finished) return;
    int32_t code = 0;
    if (main_has_result) code = *(int32_t*)__djinn_coro_promise(main_handle, 4);
    __djinn_coro_destroy(main_handle);
    main_handle = 0;
    web_exit(code);
}

// Runs until nothing is ready, then asks the host to call back at the next timer.
DJINN_EXPORT(djinn_tick) void djinn_tick(void)
{
    for (;;)
    {
        run_ready();
        double next = fire_timers();
        if (ready.count > 0) continue;
        finish_main();
        if (next >= 0) web_timer_set(next);
        return;
    }
}

// A nested loop (a sync function awaiting) runs until its coroutine finishes; a browser cannot block, so it fails
// when that would mean waiting for a timer.
static void run_until_done(void* handle)
{
    if (!is_in_waiting_set(handle)) enqueue(handle);
    while (!__djinn_coro_done(handle))
    {
        void* next = dequeue();
        if (!next)
        {
            double delay = fire_timers();
            if (ready.count > 0) continue;
            if (delay >= 0) __djinn_runtime_error_message("a synchronous wait on the web cannot block for a timer; make the caller async");
            break;
        }
        if (!__djinn_coro_done(next))
        {
            __djinn_coro_resume(next);
            if (!__djinn_coro_done(next))
            {
                if (!take_waiting(next)) enqueue(next);
                continue;
            }
        }
        if (next != handle) finish_coro(next);
    }
    take_waiting(handle);
}

void __djinn_event_loop_run(void* handle) { run_until_done(handle); }

int __djinn_event_loop(void* handle)
{
    run_until_done(handle);
    int result = *(int*)__djinn_coro_promise(handle, 4);
    __djinn_coro_destroy(handle);
    return result;
}

// The web entry of an async main: starts it and returns at once; the exit code reaches the host through djinn.exit
// when main finishes (possibly in a later tick). Returns 1 when main already finished.
int __djinn_web_start(void* handle, int has_result)
{
    main_handle = handle;
    main_has_result = has_result;
    main_finished = 0;
    enqueue(handle);
    djinn_tick();
    return main_handle == 0;
}

DJINN_EXPORT(djinn_main_pending) int32_t djinn_main_pending(void) { return main_handle != 0; }

void __djinn_runtime_init(int threads) { (void)threads; }
void __djinn_runtime_shutdown(void) {}

int __djinn_argc(void) { return 0; }
char* __djinn_argv(int index) { (void)index; return 0; }
char* __djinn_executable_dir(void) { return 0; }
int __djinn_path_exists(const char* path) { (void)path; return 0; }
char* __djinn_list_files(const char* directory, const char* extension) { (void)directory; (void)extension; return 0; }

// ── Services the web does not have: they fail as error values ───────────────────────────────────────────────────────

#define FAIL_I64(name, ...) int64_t name(__VA_ARGS__) { return -38; }

FAIL_I64(__djinn_fs_open_root, const char* p, int64_t l, int32_t f)
FAIL_I64(__djinn_fs_open_dir, int64_t d, const char* p, int64_t l, int32_t f)
FAIL_I64(__djinn_fs_open_file, int64_t d, const char* p, int64_t l, int32_t f, int32_t m)
FAIL_I64(__djinn_fs_close, int64_t h)
FAIL_I64(__djinn_fs_close_dir, int64_t h)
FAIL_I64(__djinn_fs_sync_dir, int64_t h)
FAIL_I64(__djinn_fs_read, int64_t h, void* b, int64_t c)
FAIL_I64(__djinn_fs_write, int64_t h, void* b, int64_t c)
FAIL_I64(__djinn_fs_seek, int64_t h, int64_t o, int32_t w)
FAIL_I64(__djinn_fs_truncate, int64_t h, int64_t l)
FAIL_I64(__djinn_fs_sync, int64_t h)
FAIL_I64(__djinn_fs_fstat, int64_t h, int64_t* o)
FAIL_I64(__djinn_fs_stat, int64_t d, const char* p, int64_t l, int32_t f, int64_t* o)
FAIL_I64(__djinn_fs_mkdir, int64_t d, const char* p, int64_t l, int32_t m)
FAIL_I64(__djinn_fs_remove, int64_t d, const char* p, int64_t l, int32_t i)
FAIL_I64(__djinn_fs_rename, int64_t a, const char* b, int64_t c, int64_t d, const char* e, int64_t f, int32_t g)
FAIL_I64(__djinn_fs_list_open, int64_t d)
FAIL_I64(__djinn_fs_list_next, int64_t l, void* c)
FAIL_I64(__djinn_fs_submit, int32_t op, int64_t a0, int64_t a1, int64_t a2, int64_t a3, int64_t a4, int64_t a5, int64_t a6, void* t)
FAIL_I64(__djinn_fs_finish, int64_t r)
FAIL_I64(__djinn_fs_temp_name, const char* a, int64_t b, char* c, int64_t d)
FAIL_I64(__djinn_socket_create, void)
FAIL_I64(__djinn_socket_close, int64_t s)
FAIL_I64(__djinn_socket_bind, int64_t s, const char* a, int32_t p)
FAIL_I64(__djinn_socket_listen, int64_t s, int32_t b)
FAIL_I64(__djinn_async_accept, int64_t s, int64_t* o, void* c)
FAIL_I64(__djinn_async_connect, int64_t s, const char* a, int32_t p, int64_t* o, void* c)
FAIL_I64(__djinn_async_send, int64_t s, void* b, int64_t n, int64_t* o, void* c)
FAIL_I64(__djinn_async_recv, int64_t s, void* b, int64_t n, int64_t* o, void* c)

void __djinn_fs_list_free(int64_t list) { (void)list; }

void* __djinn_process_start(const char* command, const char* input, int32_t length) { (void)command; (void)input; (void)length; return 0; }
int32_t __djinn_process_wait(void* p, int32_t t) { (void)p; (void)t; return -1; }
int32_t __djinn_process_poll(void* p) { (void)p; return -1; }
void __djinn_process_kill(void* p) { (void)p; }
int32_t __djinn_process_exit_code(void* p) { (void)p; return -1; }
int32_t __djinn_process_killed(void* p) { (void)p; return 0; }
const char* __djinn_process_stdout_data(void* p) { (void)p; return ""; }
int32_t __djinn_process_stdout_length(void* p) { (void)p; return 0; }
const char* __djinn_process_stderr_data(void* p) { (void)p; return ""; }
int32_t __djinn_process_stderr_length(void* p) { (void)p; return 0; }
void __djinn_process_free(void* p) { (void)p; }

int32_t __djinn_terminal_width(void) { return 80; }
int32_t __djinn_terminal_height(void) { return 24; }
void __djinn_raw_enable(void) {}
void __djinn_raw_disable(void) {}
int32_t __djinn_read_key(void) { return -1; }
int32_t __djinn_read_line(char* buffer, int32_t capacity) { (void)buffer; (void)capacity; return -1; }
int32_t __djinn_console_open_line(int32_t set) { (void)set; return 0; }
void __djinn_stdio_binary(void) {}
int32_t __djinn_stdin_pending(void) { return 0; }
int32_t __djinn_stdin_read(void* buffer, int32_t capacity) { (void)buffer; (void)capacity; return -1; }
int32_t __djinn_stdout_write(const void* data, int32_t length) { web_console_write(1, (const char*)data, length); return length; }

void* __djinn_thread_create(void (*function)(void*), void* argument) { (void)function; (void)argument; return 0; }
int __djinn_thread_start(void* thread) { (void)thread; return -1; }
void __djinn_thread_join(void* thread) { (void)thread; }
int __djinn_thread_is_alive(void* thread) { (void)thread; return 0; }
void __djinn_thread_sleep(int64_t milliseconds) { (void)milliseconds; }
static int web_mutex;
void* __djinn_mutex_create(void) { return &web_mutex; }
void __djinn_mutex_lock(void* mutex) { (void)mutex; }
void __djinn_mutex_unlock(void* mutex) { (void)mutex; }
int __djinn_mutex_trylock(void* mutex) { (void)mutex; return 1; }
void __djinn_mutex_destroy(void* mutex) { (void)mutex; }

#include "web_logger.c"
#include "web_json.c"
