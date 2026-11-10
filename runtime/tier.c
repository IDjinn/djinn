#include "runtime_internal.h"

extern int __djinn_tier_poll(void) __attribute__((weak));

static djinn_thread_t* tier_thread;
static volatile int tier_stop;

static void tier_loop(void* arg)
{
    (void)arg;
    while (!tier_stop)
    {
        __djinn_thread_sleep(10);
        if (tier_stop || !__djinn_tier_poll || __djinn_tier_poll()) break;
    }
}

void __djinn_tier_start(void)
{
    tier_stop = 0;
    tier_thread = __djinn_thread_create(tier_loop, NULL);
    if (tier_thread && __djinn_thread_start(tier_thread) != 0) tier_thread = NULL;
}

void __djinn_tier_stop(void)
{
    tier_stop = 1;
    if (tier_thread)
    {
        __djinn_thread_join(tier_thread);
        tier_thread = NULL;
    }
}
