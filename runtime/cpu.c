// The SIMD extensions of the CPU the program runs on, for std::simd::Cpu: the runtime is built without -march, so
// code picks a [Target("avx2")] path only after asking here. x86 reads cpuid, and xgetbv for the registers the OS
// saves; AArch64 always has NEON. One bit per feature, computed once.
#include <stdint.h>

#if defined(_MSC_VER) && !defined(__clang__)
#include <intrin.h>
#endif

enum
{
    DJINN_CPU_SSE2 = 1 << 0,
    DJINN_CPU_SSE3 = 1 << 1,
    DJINN_CPU_SSSE3 = 1 << 2,
    DJINN_CPU_SSE41 = 1 << 3,
    DJINN_CPU_SSE42 = 1 << 4,
    DJINN_CPU_POPCNT = 1 << 5,
    DJINN_CPU_AVX = 1 << 6,
    DJINN_CPU_AVX2 = 1 << 7,
    DJINN_CPU_FMA = 1 << 8,
    DJINN_CPU_BMI2 = 1 << 9,
    DJINN_CPU_AVX512F = 1 << 10,
    DJINN_CPU_AVX512BW = 1 << 11,
    DJINN_CPU_NEON = 1 << 12,
    DJINN_CPU_KNOWN = 1 << 30,
};

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
static void djinn_cpuid(uint32_t leaf, uint32_t subleaf, uint32_t out[4])
{
#if defined(_MSC_VER) && !defined(__clang__)
    int registers[4];
    __cpuidex(registers, (int)leaf, (int)subleaf);
    for (int i = 0; i < 4; i++)
    {
        out[i] = (uint32_t)registers[i];
    }
#else
    uint32_t a, b, c, d;
    __asm__ volatile("cpuid" : "=a"(a), "=b"(b), "=c"(c), "=d"(d) : "a"(leaf), "c"(subleaf));
    out[0] = a;
    out[1] = b;
    out[2] = c;
    out[3] = d;
#endif
}

static uint64_t djinn_xgetbv(void)
{
#if defined(_MSC_VER) && !defined(__clang__)
    return _xgetbv(0);
#else
    uint32_t low, high;
    __asm__ volatile("xgetbv" : "=a"(low), "=d"(high) : "c"(0));
    return ((uint64_t)high << 32) | low;
#endif
}

static uint32_t djinn_detect_cpu(void)
{
    uint32_t found = DJINN_CPU_KNOWN;
    uint32_t regs[4];
    djinn_cpuid(0, 0, regs);
    uint32_t highest = regs[0];
    djinn_cpuid(1, 0, regs);
    uint32_t ecx = regs[2];
    uint32_t edx = regs[3];
    if (edx & (1u << 26)) found |= DJINN_CPU_SSE2;
    if (ecx & (1u << 0)) found |= DJINN_CPU_SSE3;
    if (ecx & (1u << 9)) found |= DJINN_CPU_SSSE3;
    if (ecx & (1u << 19)) found |= DJINN_CPU_SSE41;
    if (ecx & (1u << 20)) found |= DJINN_CPU_SSE42;
    if (ecx & (1u << 23)) found |= DJINN_CPU_POPCNT;
    int os_saves_avx = 0;
    int os_saves_avx512 = 0;
    if ((ecx & (1u << 27)) && (ecx & (1u << 28)))
    {
        uint64_t saved = djinn_xgetbv();
        os_saves_avx = (saved & 6) == 6;
        os_saves_avx512 = os_saves_avx && (saved & 0xE0) == 0xE0;
    }
    if (os_saves_avx)
    {
        found |= DJINN_CPU_AVX;
        if (ecx & (1u << 12)) found |= DJINN_CPU_FMA;
    }
    if (highest >= 7)
    {
        djinn_cpuid(7, 0, regs);
        uint32_t ebx = regs[1];
        if (os_saves_avx && (ebx & (1u << 5))) found |= DJINN_CPU_AVX2;
        if (ebx & (1u << 8)) found |= DJINN_CPU_BMI2;
        if (os_saves_avx512 && (ebx & (1u << 16))) found |= DJINN_CPU_AVX512F;
        if (os_saves_avx512 && (ebx & (1u << 30))) found |= DJINN_CPU_AVX512BW;
    }
    return found;
}
#elif defined(__aarch64__) || defined(_M_ARM64)
static uint32_t djinn_detect_cpu(void)
{
    return DJINN_CPU_KNOWN | DJINN_CPU_NEON;
}
#else
static uint32_t djinn_detect_cpu(void)
{
    return DJINN_CPU_KNOWN;
}
#endif

static volatile uint32_t djinn_cpu_cache = 0;

uint32_t __djinn_cpu_features(void)
{
    uint32_t known = djinn_cpu_cache;
    if (known == 0)
    {
        known = djinn_detect_cpu();
        djinn_cpu_cache = known;
    }
    return known;
}
