#include "runtime_internal.h"

djinn_runtime_t djinn_rt;
static djinn_coro_entry_t* coro_table = NULL;
static size_t coro_table_capacity = 0;
static size_t coro_table_count = 0;

#ifdef _WIN32
LPFN_ACCEPTEX djinn_pfn_accept_ex = NULL;
LPFN_CONNECTEX djinn_pfn_connect_ex = NULL;
#endif

#define DJINN_FRAME_GRANULE 64
#define DJINN_FRAME_CLASSES 32
#define DJINN_FRAME_CACHE 64

static void* frame_cache[DJINN_FRAME_CLASSES];
static int frame_cached[DJINN_FRAME_CLASSES];
static int frame_lock = 0;

static void frame_lock_acquire(void)
{
    int expected = 0;
    while (!__atomic_compare_exchange_n(&frame_lock, &expected, 1, 1, __ATOMIC_ACQUIRE, __ATOMIC_RELAXED))
    {
        expected = 0;
    }
}

static void frame_lock_release(void)
{
    __atomic_store_n(&frame_lock, 0, __ATOMIC_RELEASE);
}

static size_t frame_class(size_t size)
{
    return (size + DJINN_FRAME_GRANULE - 1) / DJINN_FRAME_GRANULE;
}

void* __djinn_coro_alloc(size_t size)
{
    const size_t size_class = frame_class(size);
    void* frame = NULL;
    if (size_class > 0 && size_class <= DJINN_FRAME_CLASSES)
    {
        frame_lock_acquire();
        frame = frame_cache[size_class - 1];
        if (frame)
        {
            frame_cache[size_class - 1] = *(void**)frame;
            frame_cached[size_class - 1]--;
        }
        frame_lock_release();
        if (!frame)
        {
            frame = malloc(size_class * DJINN_FRAME_GRANULE);
        }
    }
    else
    {
        frame = malloc(size);
    }
    DJINN_ASSERT(frame, "Out of memory");
    DJINN_TRACE("allocated coroutine frame of %zu bytes at %p", size, frame);
    return frame;
}

void __djinn_coro_free(void* frame, size_t size)
{
    if (!frame) return;
    DJINN_TRACE("released coroutine frame of %zu bytes at %p", size, frame);
    const size_t size_class = frame_class(size);
    if (size_class > 0 && size_class <= DJINN_FRAME_CLASSES)
    {
        frame_lock_acquire();
        if (frame_cached[size_class - 1] < DJINN_FRAME_CACHE)
        {
            *(void**)frame = frame_cache[size_class - 1];
            frame_cache[size_class - 1] = frame;
            frame_cached[size_class - 1]++;
            frame = NULL;
        }
        frame_lock_release();
    }
    free(frame);
}

static void release_frame_cache(void)
{
    frame_lock_acquire();
    for (int i = 0; i < DJINN_FRAME_CLASSES; i++)
    {
        void* frame = frame_cache[i];
        while (frame)
        {
            void* next = *(void**)frame;
            free(frame);
            frame = next;
        }
        frame_cache[i] = NULL;
        frame_cached[i] = 0;
    }
    frame_lock_release();
}

void djinn_init_queue(djinn_task_queue_t* q)
{
    q->items = NULL;
    q->capacity = 0;
    q->head = 0;
    q->count = 0;
#ifdef _WIN32
    InitializeCriticalSection(&q->mutex);
    InitializeConditionVariable(&q->cond);
#else
    pthread_mutex_init(&q->mutex, NULL);
    pthread_cond_init(&q->cond, NULL);
#endif
}

void djinn_destroy_queue(djinn_task_queue_t* q)
{
    free(q->items);
    q->items = NULL;
    q->capacity = 0;
    q->head = 0;
    q->count = 0;
#ifdef _WIN32
    DeleteCriticalSection(&q->mutex);
#else
    pthread_mutex_destroy(&q->mutex);
    pthread_cond_destroy(&q->cond);
#endif
}

static void grow_queue(djinn_task_queue_t* q)
{
    const int capacity = q->capacity ? q->capacity * 2 : 64;
    void** items = (void**)malloc(sizeof(void*) * (size_t)capacity);
    DJINN_ASSERT(items, "Out of memory");
    for (int i = 0; i < q->count; i++)
    {
        items[i] = q->items[(q->head + i) & (q->capacity - 1)];
    }
    free(q->items);
    q->items = items;
    q->capacity = capacity;
    q->head = 0;
}

static void* take_task(djinn_task_queue_t* q)
{
    if (q->count == 0) return NULL;
    void* handle = q->items[q->head];
    q->head = (q->head + 1) & (q->capacity - 1);
    q->count--;
    return handle;
}

void djinn_enqueue_task(djinn_task_queue_t* q, void* handle)
{
#ifdef _WIN32
    EnterCriticalSection(&q->mutex);
#else
    pthread_mutex_lock(&q->mutex);
#endif

    if (q->count == q->capacity)
    {
        grow_queue(q);
    }
    q->items[(q->head + q->count) & (q->capacity - 1)] = handle;
    q->count++;

#ifdef _WIN32
    WakeConditionVariable(&q->cond);
    LeaveCriticalSection(&q->mutex);
#else
    pthread_cond_signal(&q->cond);
    pthread_mutex_unlock(&q->mutex);
#endif
}

void* djinn_dequeue_task(djinn_task_queue_t* q)
{
#ifdef _WIN32
    EnterCriticalSection(&q->mutex);
#else
    pthread_mutex_lock(&q->mutex);
#endif

    void* handle = take_task(q);

#ifdef _WIN32
    LeaveCriticalSection(&q->mutex);
#else
    pthread_mutex_unlock(&q->mutex);
#endif

    return handle;
}

void* djinn_dequeue_task_blocking(djinn_task_queue_t* q, volatile int* shutdown)
{
#ifdef _WIN32
    EnterCriticalSection(&q->mutex);
    while (q->count == 0 && !(*shutdown))
    {
        SleepConditionVariableCS(&q->cond, &q->mutex, 100);
    }
#else
    pthread_mutex_lock(&q->mutex);
    while (q->count == 0 && !(*shutdown))
    {
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 100000000; // 100ms
        if (ts.tv_nsec >= 1000000000)
        {
            ts.tv_sec++;
            ts.tv_nsec -= 1000000000;
        }
        pthread_cond_timedwait(&q->cond, &q->mutex, &ts);
    }
#endif

    void* handle = take_task(q);

#ifdef _WIN32
    LeaveCriticalSection(&q->mutex);
#else
    pthread_mutex_unlock(&q->mutex);
#endif

    return handle;
}

static size_t coro_slot(void* handle, size_t capacity)
{
    // Fibonacci hashing of the frame address; the low bits are alignment and carry no entropy.
    return (size_t)((((uint64_t)(uintptr_t)handle >> 4) * 0x9E3779B97F4A7C15ull) >> 32) & (capacity - 1);
}

static djinn_coro_entry_t* find_coro(void* handle)
{
    if (coro_table_count == 0) return NULL;
    const size_t mask = coro_table_capacity - 1;
    for (size_t i = coro_slot(handle, coro_table_capacity);; i = (i + 1) & mask)
    {
        if (coro_table[i].handle == handle) return &coro_table[i];
        if (coro_table[i].handle == NULL) return NULL;
    }
}

static djinn_coro_entry_t* place_coro(void* handle)
{
    const size_t mask = coro_table_capacity - 1;
    size_t i = coro_slot(handle, coro_table_capacity);
    while (coro_table[i].handle != NULL)
    {
        i = (i + 1) & mask;
    }
    coro_table[i].handle = handle;
    coro_table_count++;
    return &coro_table[i];
}

static void grow_coro_table(void)
{
    djinn_coro_entry_t* previous = coro_table;
    const size_t previous_capacity = coro_table_capacity;
    coro_table_capacity = previous_capacity ? previous_capacity * 2 : 64;
    coro_table = (djinn_coro_entry_t*)calloc(coro_table_capacity, sizeof(djinn_coro_entry_t));
    DJINN_ASSERT(coro_table, "Out of memory");
    coro_table_count = 0;
    for (size_t i = 0; i < previous_capacity; i++)
    {
        if (previous[i].handle)
        {
            *place_coro(previous[i].handle) = previous[i];
        }
    }
    free(previous);
}

static djinn_coro_entry_t* insert_coro(void* handle)
{
    djinn_coro_entry_t* found = find_coro(handle);
    if (found) return found;
    if ((coro_table_count + 1) * 2 > coro_table_capacity)
    {
        grow_coro_table();
    }
    return place_coro(handle);
}

static void release_coro(djinn_coro_entry_t* entry)
{
    if (entry->parent || entry->waiting) return;
    const size_t mask = coro_table_capacity - 1;
    size_t hole = (size_t)(entry - coro_table);
    // Backward-shift deletion: an entry moves into the hole when the hole lies between its home slot and its slot.
    for (size_t i = (hole + 1) & mask; coro_table[i].handle != NULL; i = (i + 1) & mask)
    {
        const size_t home = coro_slot(coro_table[i].handle, coro_table_capacity);
        if (((i - home) & mask) >= ((i - hole) & mask))
        {
            coro_table[hole] = coro_table[i];
            hole = i;
        }
    }
    coro_table[hole].handle = NULL;
    coro_table[hole].parent = NULL;
    coro_table[hole].waiting = 0;
    coro_table_count--;
}

static void release_coro_table(void)
{
    free(coro_table);
    coro_table = NULL;
    coro_table_capacity = 0;
    coro_table_count = 0;
}

void __djinn_mark_waiting(void* handle)
{
    insert_coro(handle)->waiting = 1;
}

int djinn_is_in_waiting_set(void* handle)
{
    const djinn_coro_entry_t* entry = find_coro(handle);
    return entry && entry->waiting;
}

int djinn_is_waiting(void* handle)
{
    djinn_coro_entry_t* entry = find_coro(handle);
    if (!entry || !entry->waiting) return 0;
    entry->waiting = 0;
    release_coro(entry);
    return 1;
}

void djinn_remove_from_waiting(void* handle)
{
    djinn_is_waiting(handle);
}

static void* pop_continuation(void* child)
{
    djinn_coro_entry_t* entry = find_coro(child);
    if (!entry || !entry->parent) return NULL;
    void* parent = entry->parent;
    entry->parent = NULL;
    release_coro(entry);
    return parent;
}

void __djinn_await(void* child_handle, void* parent_handle)
{
    DJINN_ASSERT(child_handle, "child handle is NULL");
    DJINN_ASSERT(parent_handle, "parent handle is NULL");

    insert_coro(child_handle)->parent = parent_handle;
    __djinn_mark_waiting(parent_handle);

    if (!djinn_is_in_waiting_set(child_handle))
    {
        djinn_enqueue_task(&djinn_rt.ready_queue, child_handle);
    }
}


#ifdef _WIN32
DWORD WINAPI djinn_worker_thread(LPVOID arg)
{
#else
    void* djinn_worker_thread(void* arg)
    {

#endif
    djinn_thread_pool_t* pool = (djinn_thread_pool_t*)arg;

    while (!pool->shutdown)
    {
        void* handle = djinn_dequeue_task_blocking(&pool->queue, &pool->shutdown);
        if (!handle) continue;

        if (!__djinn_coro_done(handle))
        {
            __djinn_coro_resume(handle);
            if (!__djinn_coro_done(handle))
            {
                djinn_enqueue_task(&pool->queue, handle);
            }
            else
            {
                __djinn_coro_destroy(handle);
            }
        }
    }

#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

void __djinn_runtime_init(int num_threads)
{
    memset(&djinn_rt, 0, sizeof(djinn_rt));
    logger = logger_get("RUNTIME", 1, LOG_TRACE);
    logger_configure_from_properties(logger, "runtime.properties");
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    // Initialize Winsock
    WSADATA wsadata;
    const int wsa_err = WSAStartup(MAKEWORD(2, 2), &wsadata);
    DJINN_ASSERT(wsa_err == 0, "WSAStartup failed");
#endif

    djinn_init_queue(&djinn_rt.ready_queue);
    djinn_init_queue(&djinn_rt.pool.queue);

    // File I/O mutex
#ifdef _WIN32
    InitializeCriticalSection(&djinn_rt.file_io_mutex);
#else
    pthread_mutex_init(&djinn_rt.file_io_mutex, NULL);
#endif

    // Socket mutex
#ifdef _WIN32
    InitializeCriticalSection(&djinn_rt.socket_mutex);
#else
    pthread_mutex_init(&djinn_rt.socket_mutex, NULL);
#endif

    djinn_rt.running = 1;
    djinn_rt.pool.shutdown = 0;

#ifdef _WIN32
    djinn_rt.iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, NULL, 0, 0);
    DJINN_ASSERT(djinn_rt.iocp != NULL, "CreateIoCompletionPort failed");

    {
        const SOCKET tmp = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (tmp != INVALID_SOCKET)
        {
            DWORD bytes;
            GUID guid_acceptex = WSAID_ACCEPTEX;
            GUID guid_connectex = WSAID_CONNECTEX;
            WSAIoctl(tmp, SIO_GET_EXTENSION_FUNCTION_POINTER,
                     &guid_acceptex, sizeof(guid_acceptex),
                     &djinn_pfn_accept_ex, sizeof(djinn_pfn_accept_ex), &bytes, NULL, NULL);
            WSAIoctl(tmp, SIO_GET_EXTENSION_FUNCTION_POINTER,
                     &guid_connectex, sizeof(guid_connectex),
                     &djinn_pfn_connect_ex, sizeof(djinn_pfn_connect_ex), &bytes, NULL, NULL);
            closesocket(tmp);
        }
        DJINN_ASSERT(djinn_pfn_accept_ex != NULL, "Failed to load AcceptEx");
        DJINN_ASSERT(djinn_pfn_connect_ex != NULL, "Failed to load ConnectEx");
    }
#else
    djinn_rt.epoll_fd = epoll_create1(0);
    DJINN_ASSERT(djinn_rt.epoll_fd >= 0, "epoll_create1 failed");
#endif

    if (num_threads > 0)
    {
        djinn_rt.pool.thread_count = num_threads;
#ifdef _WIN32
        djinn_rt.pool.threads = (HANDLE*)malloc(sizeof(HANDLE) * num_threads);
        for (int i = 0; i < num_threads; i++)
        {
            djinn_rt.pool.threads[i] = CreateThread(NULL, 0, djinn_worker_thread, &djinn_rt.pool, 0, NULL);
        }
#else
        djinn_rt.pool.threads = (pthread_t*)malloc(sizeof(pthread_t) * num_threads);
        for (int i = 0; i < num_threads; i++)
        {
            pthread_create(&djinn_rt.pool.threads[i], NULL, djinn_worker_thread, &djinn_rt.pool);
        }
#endif
    }

#ifdef _WIN32
    djinn_rt.file_io_thread = CreateThread(NULL, 0, djinn_file_io_thread_func, NULL, 0, NULL);
#else
    pthread_create(&djinn_rt.file_io_thread, NULL, djinn_file_io_thread_func, NULL);
#endif

    // ── Create socket poller thread ──
#ifdef _WIN32
    djinn_rt.socket_poller_thread = CreateThread(NULL, 0, djinn_socket_poller_thread_func, NULL, 0, NULL);
#else
    pthread_create(&djinn_rt.socket_poller_thread, NULL, djinn_socket_poller_thread_func, NULL);
#endif

    DJINN_TRACE("runtime initialized (threads=%d, iocp/epoll=active)", num_threads);
}

void __djinn_runtime_shutdown(void)
{
    DJINN_TRACE("runtime shutting down");
    djinn_rt.running = 0;
    djinn_rt.pool.shutdown = 1;

    for (int i = 0; i < djinn_rt.pool.thread_count; i++)
    {
#ifdef _WIN32
        WakeAllConditionVariable(&djinn_rt.pool.queue.cond);
#else
        pthread_cond_broadcast(&djinn_rt.pool.queue.cond);
#endif
    }

    for (int i = 0; i < djinn_rt.pool.thread_count; i++)
    {
#ifdef _WIN32
        WaitForSingleObject(djinn_rt.pool.threads[i], 5000);
        CloseHandle(djinn_rt.pool.threads[i]);
#else
        pthread_join(djinn_rt.pool.threads[i], NULL);
#endif
    }
    free(djinn_rt.pool.threads);
    djinn_rt.pool.threads = NULL;

#ifdef _WIN32
    WaitForSingleObject(djinn_rt.file_io_thread, 5000);
    CloseHandle(djinn_rt.file_io_thread);
#else
    pthread_join(djinn_rt.file_io_thread, NULL);
#endif

#ifdef _WIN32
    PostQueuedCompletionStatus(djinn_rt.iocp, 0, 0, NULL);
    WaitForSingleObject(djinn_rt.socket_poller_thread, 5000);
    CloseHandle(djinn_rt.socket_poller_thread);
    CloseHandle(djinn_rt.iocp);
#else
    pthread_join(djinn_rt.socket_poller_thread, NULL);
    close(djinn_rt.epoll_fd);
#endif

    djinn_destroy_queue(&djinn_rt.ready_queue);
    djinn_destroy_queue(&djinn_rt.pool.queue);
    release_coro_table();
    release_frame_cache();

#ifdef _WIN32
    EnterCriticalSection(&djinn_rt.file_io_mutex);
#else
    pthread_mutex_lock(&djinn_rt.file_io_mutex);
#endif
    djinn_io_request_t* req = djinn_rt.io_pending;
    while (req)
    {
        djinn_io_request_t* next = req->next;
        free(req);
        req = next;
    }
    djinn_rt.io_pending = NULL;
#ifdef _WIN32
    LeaveCriticalSection(&djinn_rt.file_io_mutex);
    DeleteCriticalSection(&djinn_rt.file_io_mutex);
    DeleteCriticalSection(&djinn_rt.socket_mutex);
#else
    pthread_mutex_unlock(&djinn_rt.file_io_mutex);
    pthread_mutex_destroy(&djinn_rt.file_io_mutex);
    pthread_mutex_destroy(&djinn_rt.socket_mutex);
#endif

#ifdef _WIN32
    WSACleanup();
#endif

    DJINN_TRACE("runtime shut down");
    logger_destroy_all();
    logger = NULL;
}

void __djinn_spawn(void* coro_handle)
{
    DJINN_ASSERT(coro_handle, "coro handle is NULL");
    djinn_enqueue_task(&djinn_rt.ready_queue, coro_handle);
}

static void process_completed_coro(void* handle, void* main_handle)
{
    djinn_remove_from_waiting(handle);
    void* parent = pop_continuation(handle);
    if (parent)
    {
        djinn_remove_from_waiting(parent);
        djinn_enqueue_task(&djinn_rt.ready_queue, parent);
    }
    else if (handle != main_handle)
    {
        __djinn_coro_destroy(handle);
    }
}

static void drain_ready_queue(void* main_handle)
{
    void* remaining;
    while ((remaining = djinn_dequeue_task(&djinn_rt.ready_queue)) != NULL)
    {
        if (!__djinn_coro_done(remaining))
        {
            __djinn_coro_resume(remaining);
            if (!__djinn_coro_done(remaining))
            {
                if (!djinn_is_waiting(remaining))
                {
                    djinn_enqueue_task(&djinn_rt.ready_queue, remaining);
                }
                continue;
            }
        }
        process_completed_coro(remaining, main_handle);
    }
}

static void run_event_loop_core(void* main_handle)
{
    DJINN_ASSERT(main_handle, "main handle is NULL");

    if (!djinn_is_in_waiting_set(main_handle))
    {
        djinn_enqueue_task(&djinn_rt.ready_queue, main_handle);
    }

    while (djinn_rt.running)
    {
        void* handle = djinn_dequeue_task(&djinn_rt.ready_queue);
        if (handle)
        {
            if (!__djinn_coro_done(handle))
            {
                __djinn_coro_resume(handle);
                if (!__djinn_coro_done(handle))
                {
                    if (djinn_is_waiting(handle))
                    {
                        // Waiting for I/O or child — do NOT re-enqueue
                    }
                    else
                    {
                        // Cooperative yield — re-enqueue immediately
                        djinn_enqueue_task(&djinn_rt.ready_queue, handle);
                    }
                }
                else
                {
                    process_completed_coro(handle, main_handle);
                }
            }
            else
            {
                process_completed_coro(handle, main_handle);
            }
        }

        if (__djinn_coro_done(main_handle))
        {
            drain_ready_queue(main_handle);
            break;
        }

        if (djinn_rt.ready_queue.count == 0)
        {
#ifdef _WIN32
            Sleep(0);
#else
            sched_yield();
#endif
        }
    }
}

int __djinn_event_loop(void* main_handle)
{
    run_event_loop_core(main_handle);

    void* promise = __djinn_coro_promise(main_handle, 4);
    const int result = *(int*)promise;
    __djinn_coro_destroy(main_handle);
    return result;
}

void __djinn_event_loop_run(void* main_handle)
{
    run_event_loop_core(main_handle);
}
