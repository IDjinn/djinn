#include <stdint.h>
#include <string.h>

#if defined(__FLT16_MAX__)
typedef _Float16 half_t;
#else
typedef uint16_t half_t;
#endif
/* WebAssembly clang has no __bf16: the helpers take and return its bits there. */
#if !defined(__wasm__) && (defined(__BFLT16_MAX__) || defined(__clang__))
typedef __bf16 brain_t;
#else
typedef uint16_t brain_t;
#endif

static uint16_t half_bits(half_t value) {
    uint16_t bits;
    memcpy(&bits, &value, 2);
    return bits;
}

static half_t bits_half(uint16_t bits) {
    half_t value;
    memcpy(&value, &bits, 2);
    return value;
}

static brain_t bits_brain(uint16_t bits) {
    brain_t value;
    memcpy(&value, &bits, 2);
    return value;
}

/* Software conversions the compiler calls for f16 and bf16 on targets without the hardware instructions. */

static uint32_t float_bits(float value) {
    uint32_t bits;
    memcpy(&bits, &value, 4);
    return bits;
}

static float bits_float(uint32_t bits) {
    float value;
    memcpy(&value, &bits, 4);
    return value;
}

__attribute__((weak)) float __extendhfsf2(half_t value) {
    uint16_t half = half_bits(value);
    uint32_t sign = (uint32_t)(half & 0x8000) << 16;
    uint32_t exponent = (half >> 10) & 0x1F;
    uint32_t mantissa = half & 0x3FF;
    if (exponent == 0x1F) {
        return bits_float(sign | 0x7F800000u | (mantissa << 13) | (mantissa ? 0x400000u : 0));
    }
    if (exponent == 0) {
        if (mantissa == 0) {
            return bits_float(sign);
        }
        int shift = 0;
        while (!(mantissa & 0x400)) {
            mantissa <<= 1;
            shift++;
        }
        mantissa &= 0x3FF;
        return bits_float(sign | ((uint32_t)(113 - shift) << 23) | (mantissa << 13));
    }
    return bits_float(sign | ((exponent + 112) << 23) | (mantissa << 13));
}

/* The double as a float whose lowest bit is set when something was lost, so that rounding it again to 16 bits gives
   what a single rounding would: rounding to nearest twice can take a value just off a halfway point for the point. */
static float odd_float(double value) {
    float narrow = (float)value;
    if ((double)narrow == value || value != value) {
        return narrow;
    }
    uint32_t bits = float_bits(narrow);
    if (!(bits & 1)) {
        double magnitude = value < 0 ? -value : value;
        double rounded = narrow < 0 ? -(double)narrow : (double)narrow;
        /* One step from the rounded float toward the value. */
        bits = rounded > magnitude ? bits - 1 : bits + 1;
    }
    return bits_float(bits);
}

static uint16_t float_to_half_bits(float value) {
    uint32_t bits = float_bits(value);
    uint32_t sign = (bits >> 16) & 0x8000;
    uint32_t magnitude = bits & 0x7FFFFFFFu;
    if (magnitude > 0x7F800000u) {
        return (uint16_t)(sign | 0x7E00);
    }
    if (magnitude >= 0x477FF000u) {
        return (uint16_t)(sign | 0x7C00);
    }
    if (magnitude < 0x33000001u) {
        return (uint16_t)sign;
    }
    uint32_t exponent = magnitude >> 23;
    uint32_t mantissa = (magnitude & 0x7FFFFF) | 0x800000;
    if (exponent < 113) {
        uint32_t shift = 126 - exponent;
        uint32_t result = mantissa >> shift;
        uint32_t rest = mantissa & ((1u << shift) - 1);
        uint32_t halfway = 1u << (shift - 1);
        if (rest > halfway || (rest == halfway && (result & 1))) {
            result++;
        }
        return (uint16_t)(sign | result);
    }
    uint32_t result = ((exponent - 112) << 10) | ((magnitude >> 13) & 0x3FF);
    uint32_t rest = magnitude & 0x1FFF;
    if (rest > 0x1000 || (rest == 0x1000 && (result & 1))) {
        result++;
    }
    return (uint16_t)(sign | result);
}

__attribute__((weak)) half_t __truncsfhf2(float value) {
    return bits_half(float_to_half_bits(value));
}

__attribute__((weak)) half_t __truncdfhf2(double value) {
    return bits_half(float_to_half_bits(odd_float(value)));
}

static uint16_t float_to_brain_bits(float value) {
    uint32_t bits = float_bits(value);
    if ((bits & 0x7FFFFFFFu) > 0x7F800000u) {
        return (uint16_t)((bits >> 16) | 0x40);
    }
    uint32_t rounding = 0x7FFF + ((bits >> 16) & 1);
    return (uint16_t)((bits + rounding) >> 16);
}

__attribute__((weak)) brain_t __truncsfbf2(float value) {
    return bits_brain(float_to_brain_bits(value));
}

__attribute__((weak)) brain_t __truncdfbf2(double value) {
    return bits_brain(float_to_brain_bits(odd_float(value)));
}
