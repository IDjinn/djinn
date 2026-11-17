#ifndef DJINN_WEB_STRING_H
#define DJINN_WEB_STRING_H
// The web runtime defines memcpy and the others with the signatures Djinn declares (64-bit sizes), so C code here uses
// the builtins, which the WebAssembly backend turns into memory.copy and memory.fill.
#define memcpy(d, s, n) __builtin_memcpy((d), (s), (n))
#define memmove(d, s, n) __builtin_memmove((d), (s), (n))
#define memset(d, v, n) __builtin_memset((d), (v), (n))
#endif
