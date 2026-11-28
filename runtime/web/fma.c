// fma, fmaf, round and roundf: WebAssembly has no instruction for them and the web runtime has no libm. Included by
// web_runtime.c; it uses nothing but <stdint.h>, so it can also be built natively and compared with the processor.

static uint64_t fma_bits(double value)
{
    uint64_t bits;
    __builtin_memcpy(&bits, &value, sizeof bits);
    return bits;
}

static double fma_from_bits(uint64_t bits)
{
    double value;
    __builtin_memcpy(&value, &bits, sizeof value);
    return value;
}

// The 53-bit significand of a finite non-zero double and the exponent that gives value = significand * 2^exponent.
static uint64_t fma_split(uint64_t bits, int* exponent)
{
    uint64_t significand = bits & 0x000FFFFFFFFFFFFFull;
    int biased = (int)(bits >> 52) & 0x7FF;
    if (biased == 0) {
        int up = __builtin_clzll(significand) - 11;
        *exponent = -1074 - up;
        return significand << up;
    }
    *exponent = biased - 1075;
    return significand | 0x0010000000000000ull;
}

// 'value' moved right, with the lowest bit set when anything was shifted out.
static unsigned __int128 fma_sticky_shift(unsigned __int128 value, int shift)
{
    if (shift == 0) {
        return value;
    }
    if (shift >= 128) {
        return value != 0;
    }
    unsigned __int128 lost = value & (((unsigned __int128)1 << shift) - 1);
    return (value >> shift) | (lost != 0);
}

// x * y + z with one rounding, to nearest with ties to even: the exact sum is formed in 128 bits.
static double fma_exact(double x, double y, double z)
{
    if (!__builtin_isfinite(x) || !__builtin_isfinite(y)) {
        return x * y + z;
    }
    if (!__builtin_isfinite(z)) {
        return z + z;
    }
    if (x == 0.0 || y == 0.0) {
        return x * y + z;
    }
    if (z == 0.0) {
        return x * y;
    }

    int x_exponent, y_exponent, z_exponent;
    uint64_t x_significand = fma_split(fma_bits(x), &x_exponent);
    uint64_t y_significand = fma_split(fma_bits(y), &y_exponent);
    uint64_t z_significand = fma_split(fma_bits(z), &z_exponent);

    // Both terms with their leading bit at 124 or 125: the product keeps 20 zero bits below it and z keeps 73, so
    // nothing is lost when their exponents are close enough to cancel.
    unsigned __int128 product = ((unsigned __int128)x_significand * y_significand) << 20;
    int product_exponent = x_exponent + y_exponent - 20;
    unsigned __int128 addend = (unsigned __int128)z_significand << 73;
    int addend_exponent = z_exponent - 73;

    int exponent = product_exponent;
    if (product_exponent >= addend_exponent) {
        addend = fma_sticky_shift(addend, product_exponent - addend_exponent);
    } else {
        product = fma_sticky_shift(product, addend_exponent - product_exponent);
        exponent = addend_exponent;
    }

    uint64_t product_sign = (fma_bits(x) ^ fma_bits(y)) & 0x8000000000000000ull;
    uint64_t addend_sign = fma_bits(z) & 0x8000000000000000ull;
    uint64_t sign = product_sign;
    unsigned __int128 sum;
    if (product_sign == addend_sign) {
        sum = product + addend;
    } else if (product >= addend) {
        sum = product - addend;
    } else {
        sum = addend - product;
        sign = addend_sign;
    }
    if (sum == 0) {
        return 0.0;
    }

    uint64_t high = (uint64_t)(sum >> 64);
    int top = high != 0 ? 127 - __builtin_clzll(high) : 63 - __builtin_clzll((uint64_t)sum);
    // Bits to drop: down to 53 significant ones, or to the lowest bit a subnormal can hold.
    int shift = top - 52;
    if (shift < -1074 - exponent) {
        shift = -1074 - exponent;
    }
    uint64_t rounded;
    if (shift <= 0) {
        rounded = (uint64_t)(sum << -shift);
    } else if (shift >= 128) {
        rounded = 0;
    } else {
        unsigned __int128 half = (unsigned __int128)1 << (shift - 1);
        unsigned __int128 rest = sum & ((half << 1) - 1);
        rounded = (uint64_t)(sum >> shift);
        if (rest > half || (rest == half && (rounded & 1) != 0)) {
            rounded += 1;
        }
    }
    int lowest = exponent + shift;
    if (rounded == 0x0020000000000000ull) {
        rounded >>= 1;
        lowest += 1;
    }
    if (rounded < 0x0010000000000000ull) {
        return fma_from_bits(sign | rounded);
    }
    int biased = lowest + 1075;
    if (biased >= 0x7FF) {
        return fma_from_bits(sign | 0x7FF0000000000000ull);
    }
    return fma_from_bits(sign | ((uint64_t)biased << 52) | (rounded & 0x000FFFFFFFFFFFFFull));
}

// x * y + z for floats: the product is exact in double, and the sum is rounded to odd before the final rounding, which
// then gives the same result as a single one.
static float fma_exact_float(float x, float y, float z)
{
    double product = (double)x * (double)y;
    double addend = (double)z;
    double sum = product + addend;
    if (!__builtin_isfinite(sum)) {
        return (float)sum;
    }
    double virtual_addend = sum - product;
    double error = (product - (sum - virtual_addend)) + (addend - virtual_addend);
    uint64_t bits = fma_bits(sum);
    if (error != 0.0 && (bits & 1) == 0) {
        // One step toward the exact value: away from zero when the error has the sign of the sum.
        if ((error > 0.0) == (sum > 0.0)) {
            bits += 1;
        } else {
            bits -= 1;
        }
        sum = fma_from_bits(bits);
    }
    return (float)sum;
}

// Rounds half away from zero, keeping the sign of a zero result.
static double round_away(double x)
{
    double whole = __builtin_trunc(x);
    if (__builtin_fabs(x - whole) >= 0.5) {
        whole += __builtin_copysign(1.0, x);
    }
    return whole;
}

static float round_away_float(float x)
{
    float whole = __builtin_truncf(x);
    if (__builtin_fabsf(x - whole) >= 0.5f) {
        whole += __builtin_copysignf(1.0f, x);
    }
    return whole;
}
