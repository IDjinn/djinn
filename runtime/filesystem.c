#include "runtime_internal.h"


#ifdef _WIN32
#include <windows.h>
#else
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

typedef struct
{
    char** paths;
    size_t count;
    size_t capacity;
} djinn_path_list;

static void djinn_path_list_push(djinn_path_list* list, const char* path)
{
    if (list->count == list->capacity)
    {
        list->capacity = list->capacity ? list->capacity * 2 : 64;
        list->paths = realloc(list->paths, list->capacity * sizeof(char*));
    }
    size_t length = strlen(path);
    char* copy = malloc(length + 1);
    memcpy(copy, path, length + 1);
    list->paths[list->count++] = copy;
}

static int djinn_has_extension(const char* name, const char* extension)
{
    size_t name_length = strlen(name);
    size_t extension_length = strlen(extension);
    return name_length >= extension_length && strcmp(name + name_length - extension_length, extension) == 0;
}

static int djinn_compare_paths(const void* left, const void* right)
{
    return strcmp(*(char* const*)left, *(char* const*)right);
}

static int djinn_collect_files(const char* directory, const char* extension, djinn_path_list* list)
{
#ifdef _WIN32
    char pattern[1024];
    snprintf(pattern, sizeof(pattern), "%s/*", directory);
    WIN32_FIND_DATAA entry;
    HANDLE handle = FindFirstFileA(pattern, &entry);
    if (handle == INVALID_HANDLE_VALUE) return 0;
    do
    {
        if (strcmp(entry.cFileName, ".") == 0 || strcmp(entry.cFileName, "..") == 0) continue;
        char path[1024];
        snprintf(path, sizeof(path), "%s/%s", directory, entry.cFileName);
        if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
            djinn_collect_files(path, extension, list);
        else if (djinn_has_extension(entry.cFileName, extension))
            djinn_path_list_push(list, path);
    } while (FindNextFileA(handle, &entry));
    FindClose(handle);
    return 1;
#else
    DIR* handle = opendir(directory);
    if (!handle) return 0;
    struct dirent* entry;
    while ((entry = readdir(handle)) != NULL)
    {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
        char path[1024];
        snprintf(path, sizeof(path), "%s/%s", directory, entry->d_name);
        struct stat info;
        if (stat(path, &info) != 0) continue;
        if (S_ISDIR(info.st_mode))
            djinn_collect_files(path, extension, list);
        else if (djinn_has_extension(entry->d_name, extension))
            djinn_path_list_push(list, path);
    }
    closedir(handle);
    return 1;
#endif
}

char* __djinn_list_files(const char* directory, const char* extension)
{
    djinn_path_list list = {0};
    if (!djinn_collect_files(directory, extension, &list)) return NULL;
    qsort(list.paths, list.count, sizeof(char*), djinn_compare_paths);

    size_t total = 1;
    for (size_t i = 0; i < list.count; i++) total += strlen(list.paths[i]) + 1;
    char* result = malloc(total);
    size_t offset = 0;
    for (size_t i = 0; i < list.count; i++)
    {
        size_t length = strlen(list.paths[i]);
        memcpy(result + offset, list.paths[i], length);
        offset += length;
        result[offset++] = '\n';
        free(list.paths[i]);
    }
    result[offset] = '\0';
    free(list.paths);
    return result;
}

#include "fs_safe.c"

#ifndef _WIN32
#include <fcntl.h>
#include <errno.h>
#if defined(__linux__) && defined(__has_include)
#if __has_include(<linux/io_uring.h>)
#define DJBATCH_URING 1
#include <linux/io_uring.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#endif
#endif
#endif

// Batch file transfers. By default the files are transferred one by one with libc; with use_uring on Linux every
// transfer goes through one private io_uring instead, so the kernel works on many files at once (it pays off with
// high latency storage and large batches). Kernels without io_uring and other platforms always use the libc path.
#define DJBATCH_DEPTH 64
#define DJBATCH_CHUNK 0x7ffff000

typedef struct
{
    int fd;
    int failed;
    char* buffer;
    int64_t size;
    int64_t done;
} djbatch_item;

#ifdef _WIN32

static void djbatch_sequential(int write, const char** paths, char** buffers, int64_t* lengths, int32_t count)
{
    for (int32_t i = 0; i < count; i++)
    {
        FILE* file = fopen(paths[i], write ? "wb" : "rb");
        if (!file)
        {
            if (!write) buffers[i] = NULL;
            lengths[i] = -1;
            continue;
        }
        if (write)
        {
            size_t written = lengths[i] > 0 ? fwrite(buffers[i], 1, (size_t)lengths[i], file) : 0;
            if ((int64_t)written != lengths[i]) lengths[i] = -1;
            fclose(file);
            continue;
        }
        _fseeki64(file, 0, SEEK_END);
        int64_t size = _ftelli64(file);
        _fseeki64(file, 0, SEEK_SET);
        char* buffer = size >= 0 ? (char*)malloc((size_t)size + 1) : NULL;
        size_t got = buffer ? fread(buffer, 1, (size_t)size, file) : 0;
        fclose(file);
        if (!buffer)
        {
            buffers[i] = NULL;
            lengths[i] = -1;
            continue;
        }
        buffer[got] = 0;
        buffers[i] = buffer;
        lengths[i] = (int64_t)got;
    }
}

int32_t __djinn_files_batch(int32_t write, int32_t use_uring, const char** paths, char** buffers, int64_t* lengths, int32_t count)
{
    (void)use_uring;
    djbatch_sequential(write, paths, buffers, lengths, count);
    return 0;
}

#else

static void djbatch_transfer_sync(djbatch_item* item, int write)
{
    while (!item->failed && item->done < item->size)
    {
        int64_t chunk = item->size - item->done;
        if (chunk > DJBATCH_CHUNK) chunk = DJBATCH_CHUNK;
        ssize_t got = write ? pwrite(item->fd, item->buffer + item->done, (size_t)chunk, (off_t)item->done)
                            : pread(item->fd, item->buffer + item->done, (size_t)chunk, (off_t)item->done);
        if (got < 0 && errno == EINTR) continue;
        if (got < 0 || (write && got == 0)) item->failed = 1;
        else if (got == 0) item->size = item->done;
        else item->done += got;
    }
}

#ifdef DJBATCH_URING

typedef struct
{
    int fd;
    unsigned entries;
    unsigned* sq_head;
    unsigned* sq_tail;
    unsigned* sq_mask;
    unsigned* sq_array;
    struct io_uring_sqe* sqes;
    unsigned* cq_head;
    unsigned* cq_tail;
    unsigned* cq_mask;
    struct io_uring_cqe* cqes;
    void* sq_map;
    size_t sq_size;
    void* cq_map;
    size_t cq_size;
    void* sqes_map;
    size_t sqes_size;
} djbatch_ring;

static void djbatch_ring_close(djbatch_ring* ring)
{
    if (ring->sqes_map) munmap(ring->sqes_map, ring->sqes_size);
    if (ring->cq_map) munmap(ring->cq_map, ring->cq_size);
    if (ring->sq_map) munmap(ring->sq_map, ring->sq_size);
    if (ring->fd >= 0) close(ring->fd);
}

static int djbatch_ring_open(djbatch_ring* ring, unsigned depth)
{
    memset(ring, 0, sizeof(*ring));
    ring->fd = -1;
    struct io_uring_params params;
    memset(&params, 0, sizeof(params));
    int fd = (int)syscall(__NR_io_uring_setup, depth, &params);
    if (fd < 0) return 0;
    ring->fd = fd;
    ring->sq_size = params.sq_off.array + params.sq_entries * sizeof(unsigned);
    ring->cq_size = params.cq_off.cqes + params.cq_entries * sizeof(struct io_uring_cqe);
    int single = (params.features & IORING_FEAT_SINGLE_MMAP) != 0;
    if (single && ring->cq_size > ring->sq_size) ring->sq_size = ring->cq_size;
    char* sq = (char*)mmap(NULL, ring->sq_size, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, fd, IORING_OFF_SQ_RING);
    if (sq == MAP_FAILED) { ring->sq_map = NULL; djbatch_ring_close(ring); return 0; }
    ring->sq_map = sq;
    char* cq = sq;
    if (!single)
    {
        cq = (char*)mmap(NULL, ring->cq_size, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, fd, IORING_OFF_CQ_RING);
        if (cq == MAP_FAILED) { djbatch_ring_close(ring); return 0; }
        ring->cq_map = cq;
    }
    ring->sqes_size = params.sq_entries * sizeof(struct io_uring_sqe);
    void* sqes = mmap(NULL, ring->sqes_size, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, fd, IORING_OFF_SQES);
    if (sqes == MAP_FAILED) { djbatch_ring_close(ring); return 0; }
    ring->sqes_map = sqes;
    ring->entries = params.sq_entries;
    ring->sq_head = (unsigned*)(sq + params.sq_off.head);
    ring->sq_tail = (unsigned*)(sq + params.sq_off.tail);
    ring->sq_mask = (unsigned*)(sq + params.sq_off.ring_mask);
    ring->sq_array = (unsigned*)(sq + params.sq_off.array);
    ring->sqes = (struct io_uring_sqe*)sqes;
    ring->cq_head = (unsigned*)(cq + params.cq_off.head);
    ring->cq_tail = (unsigned*)(cq + params.cq_off.tail);
    ring->cq_mask = (unsigned*)(cq + params.cq_off.ring_mask);
    ring->cqes = (struct io_uring_cqe*)(cq + params.cq_off.cqes);
    return 1;
}

static void djbatch_ring_queue(djbatch_ring* ring, djbatch_item* item, int32_t index, int write)
{
    unsigned tail = *ring->sq_tail;
    unsigned slot = tail & *ring->sq_mask;
    struct io_uring_sqe* sqe = &ring->sqes[slot];
    int64_t chunk = item->size - item->done;
    if (chunk > DJBATCH_CHUNK) chunk = DJBATCH_CHUNK;
    memset(sqe, 0, sizeof(*sqe));
    sqe->opcode = write ? IORING_OP_WRITE : IORING_OP_READ;
    sqe->fd = item->fd;
    sqe->addr = (uint64_t)(uintptr_t)(item->buffer + item->done);
    sqe->len = (uint32_t)chunk;
    sqe->off = (uint64_t)item->done;
    sqe->user_data = (uint64_t)index;
    ring->sq_array[slot] = slot;
    __atomic_store_n(ring->sq_tail, tail + 1, __ATOMIC_RELEASE);
}

// Returns 0 when the ring broke before every transfer finished; the items keep their progress for the sync path.
static int djbatch_run_ring(djbatch_item* items, int32_t count, int write)
{
    djbatch_ring ring;
    if (!djbatch_ring_open(&ring, DJBATCH_DEPTH)) return 0;
    int32_t next = 0;
    unsigned inflight = 0;
    unsigned queued = 0;
    int ok = 1;
    for (;;)
    {
        while (inflight < ring.entries && next < count)
        {
            djbatch_item* item = &items[next];
            if (!item->failed && item->done < item->size)
            {
                djbatch_ring_queue(&ring, item, next, write);
                inflight++;
                queued++;
            }
            next++;
        }
        while (queued > 0)
        {
            long submitted = syscall(__NR_io_uring_enter, ring.fd, queued, 0, 0, NULL, 0);
            if (submitted < 0 && errno != EINTR && errno != EAGAIN && errno != EBUSY) { ok = 0; break; }
            if (submitted > 0) queued -= (unsigned)submitted;
        }
        if (!ok || inflight == 0) break;
        long waited = syscall(__NR_io_uring_enter, ring.fd, 0, 1, IORING_ENTER_GETEVENTS, NULL, 0);
        if (waited < 0 && errno != EINTR && errno != EAGAIN && errno != EBUSY) { ok = 0; break; }
        unsigned head = *ring.cq_head;
        unsigned tail = __atomic_load_n(ring.cq_tail, __ATOMIC_ACQUIRE);
        while (head != tail)
        {
            struct io_uring_cqe* cqe = &ring.cqes[head & *ring.cq_mask];
            int32_t index = (int32_t)cqe->user_data;
            int32_t res = cqe->res;
            head++;
            djbatch_item* item = &items[index];
            if (res < 0 && res != -EINTR && res != -EAGAIN) item->failed = 1;
            else if (res == 0) { if (write) item->failed = 1; else item->size = item->done; }
            else if (res > 0) item->done += res;
            if (!item->failed && item->done < item->size)
            {
                djbatch_ring_queue(&ring, item, index, write);
                queued++;
            }
            else inflight--;
        }
        __atomic_store_n(ring.cq_head, head, __ATOMIC_RELEASE);
    }
    djbatch_ring_close(&ring);
    return ok;
}

#endif

int32_t __djinn_files_batch(int32_t write, int32_t use_uring, const char** paths, char** buffers, int64_t* lengths, int32_t count)
{
    if (count <= 0) return 0;
    djbatch_item* items = (djbatch_item*)calloc((size_t)count, sizeof(djbatch_item));
    if (!items) return 0;
    for (int32_t i = 0; i < count; i++)
    {
        djbatch_item* item = &items[i];
        item->fd = -1;
        if (write)
        {
            item->fd = open(paths[i], O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0666);
            item->buffer = buffers[i];
            item->size = lengths[i];
            item->failed = item->fd < 0 || lengths[i] < 0;
            continue;
        }
        buffers[i] = NULL;
        item->fd = open(paths[i], O_RDONLY | O_CLOEXEC);
        struct stat info;
        if (item->fd < 0 || fstat(item->fd, &info) != 0 || !S_ISREG(info.st_mode)) item->failed = 1;
        else
        {
            item->size = (int64_t)info.st_size;
            item->buffer = (char*)malloc((size_t)item->size + 1);
            if (!item->buffer) item->failed = 1;
        }
    }

    int used_ring = 0;
#ifdef DJBATCH_URING
    if (use_uring) used_ring = djbatch_run_ring(items, count, write);
#endif
    for (int32_t i = 0; i < count; i++)
    {
        djbatch_item* item = &items[i];
        djbatch_transfer_sync(item, write);
        if (item->fd >= 0) close(item->fd);
        if (write)
        {
            if (item->failed) lengths[i] = -1;
            continue;
        }
        if (item->failed)
        {
            free(item->buffer);
            lengths[i] = -1;
            continue;
        }
        item->buffer[item->done] = 0;
        buffers[i] = item->buffer;
        lengths[i] = item->done;
    }
    free(items);
    return used_ring;
}

#endif

#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

// Directory of the running executable with '/' separators (heap allocated), or NULL when unknown.
char* __djinn_executable_dir(void)
{
    char buffer[4096];
    size_t length = 0;
#ifdef _WIN32
    DWORD written = GetModuleFileNameA(NULL, buffer, (DWORD)sizeof(buffer));
    if (written == 0 || written >= sizeof(buffer)) return NULL;
    length = written;
#elif defined(__APPLE__)
    uint32_t size = (uint32_t)sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) != 0) return NULL;
    length = strlen(buffer);
#else
    ssize_t written = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (written <= 0) return NULL;
    length = (size_t)written;
#endif
    buffer[length] = 0;
    for (size_t i = 0; i < length; i++)
    {
        if (buffer[i] == '\\') buffer[i] = '/';
    }
    while (length > 0 && buffer[length - 1] != '/') length--;
    if (length == 0) return NULL;
    buffer[length - 1] = 0;
    char* copy = malloc(length);
    memcpy(copy, buffer, length);
    return copy;
}

int __djinn_path_exists(const char* path)
{
#ifdef _WIN32
    return GetFileAttributesA(path) != INVALID_FILE_ATTRIBUTES;
#else
    struct stat info;
    return stat(path, &info) == 0;
#endif
}
