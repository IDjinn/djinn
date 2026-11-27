// ── Operating system surface of std::sys ──
//
// Included at the end of process.c (it shares struct djinn_process). Conventions:
//   - text arrives as (pointer, length) and is rejected when it holds a NUL, so nothing is silently cut;
//   - text goes out as a NUL-terminated block of __djinn_alloc (the Djinn string frees it) or as a pointer that stays
//     valid for the whole process (arguments, executable path, interned environment names);
//   - a negative result is minus an OsError code (std/sys/os_error.djinn);
//   - every read and write of the environment made from here is serialized by one lock.

#ifdef _WIN32
#include <tlhelp32.h>
#ifndef PSAPI_VERSION
#define PSAPI_VERSION 2
#endif
#include <psapi.h>
#include <wchar.h>
#else
#include <fcntl.h>
#include <pthread.h>
#include <pwd.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#ifdef __APPLE__
#include <TargetConditionals.h>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <sys/sysctl.h>
#endif
#ifdef __linux__
#include <sys/syscall.h>
#endif
#endif

#define DJOS_UNKNOWN 0
#define DJOS_NOT_FOUND 1
#define DJOS_PERMISSION_DENIED 2
#define DJOS_ALREADY_EXISTS 3
#define DJOS_INVALID_ARGUMENT 4
#define DJOS_OUT_OF_MEMORY 5
#define DJOS_BUSY 6
#define DJOS_TOO_MANY_OPEN 7
#define DJOS_BROKEN_PIPE 8
#define DJOS_UNSUPPORTED 9
#define DJOS_TIMED_OUT 10
#define DJOS_BAD_HANDLE 11
#define DJOS_NOT_EXECUTABLE 12
#define DJOS_WOULD_BLOCK 13
#define DJOS_INTERRUPTED 14
#define DJOS_TOO_LONG 15

// An error whose number is 0 would read as success, so Unknown travels as 100.
#define DJOS_FAIL(code) (-(int64_t)((code) == DJOS_UNKNOWN ? 100 : (code)))

#define DJOS_ENV_LIMIT 32760

#ifdef _WIN32
static SRWLOCK djos_lock = SRWLOCK_INIT;
static void djos_acquire(void) { AcquireSRWLockExclusive(&djos_lock); }
static void djos_release(void) { ReleaseSRWLockExclusive(&djos_lock); }

static int64_t djos_last_error(void)
{
    switch (GetLastError())
    {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
    case ERROR_MOD_NOT_FOUND:
    case ERROR_PROC_NOT_FOUND:
    case ERROR_ENVVAR_NOT_FOUND: return DJOS_FAIL(DJOS_NOT_FOUND);
    case ERROR_ACCESS_DENIED:
    case ERROR_PRIVILEGE_NOT_HELD: return DJOS_FAIL(DJOS_PERMISSION_DENIED);
    case ERROR_ALREADY_EXISTS:
    case ERROR_FILE_EXISTS: return DJOS_FAIL(DJOS_ALREADY_EXISTS);
    case ERROR_INVALID_PARAMETER:
    case ERROR_INVALID_NAME:
    case ERROR_INVALID_ADDRESS:
    case ERROR_DIRECTORY:
    case ERROR_NO_UNICODE_TRANSLATION: return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    case ERROR_NOT_ENOUGH_MEMORY:
    case ERROR_OUTOFMEMORY:
    case ERROR_COMMITMENT_LIMIT:
    case ERROR_WORKING_SET_QUOTA: return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    case ERROR_SHARING_VIOLATION:
    case ERROR_BUSY: return DJOS_FAIL(DJOS_BUSY);
    case ERROR_TOO_MANY_OPEN_FILES: return DJOS_FAIL(DJOS_TOO_MANY_OPEN);
    case ERROR_BROKEN_PIPE:
    case ERROR_NO_DATA: return DJOS_FAIL(DJOS_BROKEN_PIPE);
    case ERROR_NOT_SUPPORTED:
    case ERROR_CALL_NOT_IMPLEMENTED: return DJOS_FAIL(DJOS_UNSUPPORTED);
    case ERROR_INVALID_HANDLE: return DJOS_FAIL(DJOS_BAD_HANDLE);
    case ERROR_BAD_EXE_FORMAT:
    case ERROR_EXE_MACHINE_TYPE_MISMATCH: return DJOS_FAIL(DJOS_NOT_EXECUTABLE);
    case ERROR_FILENAME_EXCED_RANGE: return DJOS_FAIL(DJOS_TOO_LONG);
    default: return DJOS_FAIL(DJOS_UNKNOWN);
    }
}
#else
static pthread_mutex_t djos_lock = PTHREAD_MUTEX_INITIALIZER;
static void djos_acquire(void) { pthread_mutex_lock(&djos_lock); }
static void djos_release(void) { pthread_mutex_unlock(&djos_lock); }

static int64_t djos_last_error(void)
{
    switch (errno)
    {
    case ENOENT:
    case ESRCH:
    case ENOTDIR: return DJOS_FAIL(DJOS_NOT_FOUND);
    case EACCES:
    case EPERM:
    case EROFS: return DJOS_FAIL(DJOS_PERMISSION_DENIED);
    case EEXIST: return DJOS_FAIL(DJOS_ALREADY_EXISTS);
    case EINVAL: return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    case ENOMEM: return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    case EBUSY:
    case ETXTBSY: return DJOS_FAIL(DJOS_BUSY);
    case EMFILE:
    case ENFILE: return DJOS_FAIL(DJOS_TOO_MANY_OPEN);
    case EPIPE: return DJOS_FAIL(DJOS_BROKEN_PIPE);
    case ENOSYS: return DJOS_FAIL(DJOS_UNSUPPORTED);
    case EBADF: return DJOS_FAIL(DJOS_BAD_HANDLE);
    case ENOEXEC: return DJOS_FAIL(DJOS_NOT_EXECUTABLE);
    case EAGAIN: return DJOS_FAIL(DJOS_WOULD_BLOCK);
    case EINTR: return DJOS_FAIL(DJOS_INTERRUPTED);
    case ENAMETOOLONG:
    case E2BIG: return DJOS_FAIL(DJOS_TOO_LONG);
    default: return DJOS_FAIL(DJOS_UNKNOWN);
    }
}
#endif

static int djos_is_text(const char* text, int64_t length)
{
    return length >= 0 && length < INT32_MAX && (length == 0 || (text != NULL && memchr(text, 0, (size_t)length) == NULL));
}

static char* djos_heap_copy(const char* text, size_t length)
{
    char* copy = (char*)malloc(length + 1);
    if (copy == NULL) return NULL;
    if (length > 0) memcpy(copy, text, length);
    copy[length] = 0;
    return copy;
}

static int64_t djos_give(const char* text, size_t length, char** out)
{
    char* copy = (char*)__djinn_alloc(length + 1);
    if (length > 0) memcpy(copy, text, length);
    copy[length] = 0;
    *out = copy;
    return (int64_t)length;
}

typedef struct djos_list
{
    int32_t count;
    int32_t capacity;
    char** items;
} djos_list_t;

static int djos_list_push(djos_list_t* list, char* item)
{
    if (item == NULL) return 0;
    if (list->count + 1 >= list->capacity)
    {
        int32_t capacity = list->capacity > 0 ? list->capacity * 2 : 16;
        char** items = (char**)realloc(list->items, (size_t)capacity * sizeof(char*));
        if (items == NULL)
        {
            free(item);
            return 0;
        }
        list->items = items;
        list->capacity = capacity;
    }
    list->items[list->count++] = item;
    list->items[list->count] = NULL;
    return 1;
}

static void djos_list_clear(djos_list_t* list)
{
    for (int32_t i = 0; i < list->count; i++) free(list->items[i]);
    free(list->items);
    list->items = NULL;
    list->count = 0;
    list->capacity = 0;
}

#ifdef _WIN32
static wchar_t* djos_wide(const char* text, int64_t length)
{
    if (!djos_is_text(text, length))
    {
        SetLastError(ERROR_INVALID_PARAMETER);
        return NULL;
    }
    int count = 0;
    if (length > 0)
    {
        count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, NULL, 0);
        if (count == 0) return NULL;
    }
    wchar_t* wide = (wchar_t*)malloc(((size_t)count + 1) * sizeof(wchar_t));
    if (wide == NULL) return NULL;
    if (count > 0) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text, (int)length, wide, count);
    wide[count] = 0;
    return wide;
}

static char* djos_narrow(const wchar_t* wide, int count)
{
    int length = count > 0 ? WideCharToMultiByte(CP_UTF8, 0, wide, count, NULL, 0, NULL, NULL) : 0;
    char* text = (char*)malloc((size_t)length + 1);
    if (text == NULL) return NULL;
    if (length > 0) WideCharToMultiByte(CP_UTF8, 0, wide, count, text, length, NULL, NULL);
    text[length] = 0;
    return text;
}

static int64_t djos_give_wide(const wchar_t* wide, int count, char** out)
{
    char* text = djos_narrow(wide, count);
    if (text == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    int64_t length = djos_give(text, strlen(text), out);
    free(text);
    return length;
}

static void djos_forward_slashes(char* path)
{
    for (; *path; path++)
        if (*path == '\\') *path = '/';
}

static FARPROC djos_system_function(const wchar_t* library, const char* name)
{
    HMODULE module = GetModuleHandleW(library);
    if (module == NULL) module = LoadLibraryExW(library, NULL, LOAD_LIBRARY_SEARCH_SYSTEM32);
    return module != NULL ? GetProcAddress(module, name) : NULL;
}
#endif

// ── Environment ──

static int djos_is_env_name(const char* name, int64_t length)
{
    return length > 0 && length < DJOS_ENV_LIMIT && djos_is_text(name, length) && memchr(name, '=', (size_t)length) == NULL;
}

typedef struct djos_name
{
    struct djos_name* next;
    size_t length;
    char text[];
} djos_name_t;

static djos_name_t* djos_names;

// The same name always gives the same pointer, valid until the process ends. NULL for a name the OS cannot hold.
const char* __djinn_env_intern(const char* name, int64_t length)
{
    if (!djos_is_env_name(name, length)) return NULL;
    djos_acquire();
    djos_name_t* node = djos_names;
    while (node != NULL && (node->length != (size_t)length || memcmp(node->text, name, (size_t)length) != 0))
        node = node->next;
    if (node == NULL)
    {
        node = (djos_name_t*)malloc(sizeof *node + (size_t)length + 1);
        if (node != NULL)
        {
            node->length = (size_t)length;
            memcpy(node->text, name, (size_t)length);
            node->text[length] = 0;
            node->next = djos_names;
            djos_names = node;
        }
    }
    djos_release();
    return node != NULL ? node->text : NULL;
}

int64_t __djinn_env_get(const char* name, int64_t length, char** out)
{
    *out = NULL;
    if (!djos_is_env_name(name, length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    wchar_t* key = djos_wide(name, length);
    if (key == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    int64_t result = 0;
    djos_acquire();
    DWORD needed = GetEnvironmentVariableW(key, NULL, 0);
    if (needed == 0) result = djos_last_error();
    else
    {
        wchar_t* value = (wchar_t*)malloc((size_t)needed * sizeof(wchar_t));
        if (value == NULL) result = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        else
        {
            DWORD count = GetEnvironmentVariableW(key, value, needed);
            result = count < needed ? djos_give_wide(value, (int)count, out) : DJOS_FAIL(DJOS_BUSY);
            free(value);
        }
    }
    djos_release();
    free(key);
    return result;
#else
    char* key = djos_heap_copy(name, (size_t)length);
    if (key == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    djos_acquire();
    const char* value = getenv(key);
    int64_t result = value != NULL ? djos_give(value, strlen(value), out) : DJOS_FAIL(DJOS_NOT_FOUND);
    djos_release();
    free(key);
    return result;
#endif
}

int64_t __djinn_env_set(const char* name, int64_t name_length, const char* value, int64_t value_length, int32_t overwrite)
{
    if (!djos_is_env_name(name, name_length) || !djos_is_text(value, value_length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    wchar_t* key = djos_wide(name, name_length);
    wchar_t* text = djos_wide(value, value_length);
    int64_t result = 0;
    if (key == NULL || text == NULL) result = DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    else if (wcslen(text) >= DJOS_ENV_LIMIT) result = DJOS_FAIL(DJOS_TOO_LONG);
    else
    {
        djos_acquire();
        if (!overwrite && GetEnvironmentVariableW(key, NULL, 0) != 0) result = DJOS_FAIL(DJOS_ALREADY_EXISTS);
        else if (text[0] != 0)
        {
            if (_wputenv_s(key, text) != 0) result = DJOS_FAIL(DJOS_INVALID_ARGUMENT);
        }
        else
        {
            // the C runtime reads an empty value as a removal: only the process block can hold it
            _wputenv_s(key, L"");
            if (!SetEnvironmentVariableW(key, L"")) result = djos_last_error();
        }
        djos_release();
    }
    free(key);
    free(text);
    return result;
#else
    char* key = djos_heap_copy(name, (size_t)name_length);
    char* text = djos_heap_copy(value, (size_t)value_length);
    int64_t result = 0;
    if (key == NULL || text == NULL) result = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    else
    {
        djos_acquire();
        if (!overwrite && getenv(key) != NULL) result = DJOS_FAIL(DJOS_ALREADY_EXISTS);
        else if (setenv(key, text, 1) != 0) result = djos_last_error();
        djos_release();
    }
    free(key);
    free(text);
    return result;
#endif
}

// 1 when the variable was removed, 0 when it did not exist.
int64_t __djinn_env_remove(const char* name, int64_t length)
{
    if (!djos_is_env_name(name, length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    wchar_t* key = djos_wide(name, length);
    if (key == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    djos_acquire();
    SetLastError(0);
    int64_t existed = GetEnvironmentVariableW(key, NULL, 0) != 0;
    if (existed)
    {
        _wputenv_s(key, L"");
        SetEnvironmentVariableW(key, NULL);
    }
    djos_release();
    free(key);
    return existed;
#else
    char* key = djos_heap_copy(name, (size_t)length);
    if (key == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    djos_acquire();
    int64_t existed = getenv(key) != NULL;
    if (existed && unsetenv(key) != 0) existed = djos_last_error();
    djos_release();
    free(key);
    return existed;
#endif
}

// Each item is "name\0value": the '=' that separates them is replaced by the terminator of the name.
static void djos_snapshot_add(djos_list_t* list, char* entry)
{
    if (entry == NULL) return;
    char* equals = strchr(entry, '=');
    if (equals == NULL || equals == entry)
    {
        free(entry);
        return;
    }
    *equals = 0;
    djos_list_push(list, entry);
}

void* __djinn_env_snapshot(void)
{
    djos_list_t* list = (djos_list_t*)calloc(1, sizeof *list);
    if (list == NULL) return NULL;
    djos_acquire();
#ifdef _WIN32
    wchar_t* block = GetEnvironmentStringsW();
    if (block != NULL)
    {
        for (wchar_t* entry = block; *entry != 0; entry += wcslen(entry) + 1)
            if (*entry != L'=') djos_snapshot_add(list, djos_narrow(entry, (int)wcslen(entry)));
        FreeEnvironmentStringsW(block);
    }
#else
    for (char** entry = environ; entry != NULL && *entry != NULL; entry++)
        djos_snapshot_add(list, djos_heap_copy(*entry, strlen(*entry)));
#endif
    djos_release();
    return list;
}

int32_t __djinn_env_snapshot_count(void* snapshot)
{
    return snapshot != NULL ? ((djos_list_t*)snapshot)->count : 0;
}

const char* __djinn_env_snapshot_name(void* snapshot, int32_t index)
{
    djos_list_t* list = (djos_list_t*)snapshot;
    return list != NULL && index >= 0 && index < list->count ? list->items[index] : NULL;
}

const char* __djinn_env_snapshot_value(void* snapshot, int32_t index)
{
    const char* name = __djinn_env_snapshot_name(snapshot, index);
    return name != NULL ? name + strlen(name) + 1 : NULL;
}

void __djinn_env_snapshot_free(void* snapshot)
{
    if (snapshot == NULL) return;
    djos_list_clear((djos_list_t*)snapshot);
    free(snapshot);
}

// ── The current process: arguments, executable, directory, identity and resources ──

static djos_list_t djos_arguments;
static int djos_arguments_loaded;

static void djos_load_arguments(void)
{
    djos_acquire();
    if (!djos_arguments_loaded)
    {
#ifdef _WIN32
        typedef LPWSTR*(WINAPI * split_function)(LPCWSTR, int*);
        split_function split = (split_function)(void*)djos_system_function(L"shell32.dll", "CommandLineToArgvW");
        int count = 0;
        LPWSTR* wide = split != NULL ? split(GetCommandLineW(), &count) : NULL;
        if (wide != NULL)
        {
            for (int i = 0; i < count; i++) djos_list_push(&djos_arguments, djos_narrow(wide[i], (int)wcslen(wide[i])));
            LocalFree(wide);
        }
        else
#endif
        {
            int count = __djinn_argc();
            for (int i = 0; i < count; i++)
            {
                const char* argument = __djinn_argv(i);
                if (argument != NULL) djos_list_push(&djos_arguments, djos_heap_copy(argument, strlen(argument)));
            }
        }
        djos_arguments_loaded = 1;
    }
    djos_release();
}

// Every argument, the program name included, as UTF-8 text that lives as long as the process.
int32_t __djinn_args_count(void)
{
    djos_load_arguments();
    return djos_arguments.count;
}

const char* __djinn_args_item(int32_t index)
{
    djos_load_arguments();
    return index >= 0 && index < djos_arguments.count ? djos_arguments.items[index] : NULL;
}

static char* djos_read_executable_path(void)
{
#ifdef _WIN32
    for (DWORD capacity = MAX_PATH; capacity <= 65536; capacity *= 2)
    {
        wchar_t* wide = (wchar_t*)malloc((size_t)capacity * sizeof(wchar_t));
        if (wide == NULL) return NULL;
        DWORD count = GetModuleFileNameW(NULL, wide, capacity);
        if (count > 0 && count < capacity)
        {
            int skip = wcsncmp(wide, L"\\\\?\\", 4) == 0 ? 4 : 0;
            char* path = djos_narrow(wide + skip, (int)count - skip);
            free(wide);
            if (path != NULL) djos_forward_slashes(path);
            return path;
        }
        free(wide);
        if (count == 0) return NULL;
    }
    return NULL;
#elif defined(__APPLE__)
    uint32_t capacity = 0;
    _NSGetExecutablePath(NULL, &capacity);
    char* path = (char*)malloc((size_t)capacity + 1);
    if (path == NULL || _NSGetExecutablePath(path, &capacity) != 0)
    {
        free(path);
        return NULL;
    }
    char* resolved = realpath(path, NULL);
    if (resolved == NULL) return path;
    free(path);
    return resolved;
#else
    for (size_t capacity = 256; capacity <= 65536; capacity *= 2)
    {
        char* path = (char*)malloc(capacity);
        if (path == NULL) return NULL;
        ssize_t count = readlink("/proc/self/exe", path, capacity);
        if (count > 0 && (size_t)count < capacity)
        {
            path[count] = 0;
            return path;
        }
        free(path);
        if (count < 0) return NULL;
    }
    return NULL;
#endif
}

const char* __djinn_executable_path(void)
{
    static char* cached;
    djos_acquire();
    if (cached == NULL) cached = djos_read_executable_path();
    djos_release();
    return cached;
}

int64_t __djinn_process_id(void)
{
#ifdef _WIN32
    return (int64_t)GetCurrentProcessId();
#else
    return (int64_t)getpid();
#endif
}

int64_t __djinn_parent_process_id(void)
{
#ifdef _WIN32
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32 entry;
    memset(&entry, 0, sizeof entry);
    entry.dwSize = sizeof entry;
    DWORD own = GetCurrentProcessId();
    int64_t parent = 0;
    for (BOOL more = Process32First(snapshot, &entry); more; more = Process32Next(snapshot, &entry))
    {
        if (entry.th32ProcessID == own)
        {
            parent = (int64_t)entry.th32ParentProcessID;
            break;
        }
    }
    CloseHandle(snapshot);
    return parent;
#else
    return (int64_t)getppid();
#endif
}

int64_t __djinn_process_terminate_id(int64_t id, int32_t force)
{
    // 0 and negative ids name process groups on POSIX: they are refused instead of signalling many processes
    if (id <= 0 || id > INT32_MAX) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    (void)force;
    HANDLE process = OpenProcess(PROCESS_TERMINATE, FALSE, (DWORD)id);
    if (process == NULL) return GetLastError() == ERROR_INVALID_PARAMETER ? DJOS_FAIL(DJOS_NOT_FOUND) : djos_last_error();
    int64_t result = TerminateProcess(process, 1) ? 0 : djos_last_error();
    CloseHandle(process);
    return result;
#else
    return kill((pid_t)id, force ? SIGKILL : SIGTERM) == 0 ? 0 : djos_last_error();
#endif
}

int32_t __djinn_process_id_exists(int64_t id)
{
    if (id <= 0 || id > INT32_MAX) return 0;
#ifdef _WIN32
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)id);
    if (process == NULL) return GetLastError() == ERROR_ACCESS_DENIED;
    DWORD code = 0;
    int32_t running = GetExitCodeProcess(process, &code) && code == STILL_ACTIVE;
    CloseHandle(process);
    return running;
#else
    return kill((pid_t)id, 0) == 0 || errno == EPERM;
#endif
}

void __djinn_exit(int32_t code)
{
    fflush(NULL);
    exit(code);
}

void __djinn_abort(void)
{
    fflush(NULL);
    abort();
}

int64_t __djinn_current_directory(char** out)
{
    *out = NULL;
#ifdef _WIN32
    DWORD needed = GetCurrentDirectoryW(0, NULL);
    if (needed == 0) return djos_last_error();
    wchar_t* wide = (wchar_t*)malloc((size_t)needed * sizeof(wchar_t));
    if (wide == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    DWORD count = GetCurrentDirectoryW(needed, wide);
    int64_t result = count > 0 && count < needed ? djos_give_wide(wide, (int)count, out) : DJOS_FAIL(DJOS_BUSY);
    free(wide);
    if (result >= 0) djos_forward_slashes(*out);
    return result;
#else
    for (size_t capacity = 256; capacity <= 65536; capacity *= 2)
    {
        char* path = (char*)malloc(capacity);
        if (path == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        if (getcwd(path, capacity) != NULL)
        {
            int64_t length = djos_give(path, strlen(path), out);
            free(path);
            return length;
        }
        free(path);
        if (errno != ERANGE) return djos_last_error();
    }
    return DJOS_FAIL(DJOS_TOO_LONG);
#endif
}

int64_t __djinn_set_current_directory(const char* path, int64_t length)
{
    if (length <= 0 || !djos_is_text(path, length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    wchar_t* wide = djos_wide(path, length);
    if (wide == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    int64_t result = SetCurrentDirectoryW(wide) ? 0 : djos_last_error();
    free(wide);
    return result;
#else
    char* copy = djos_heap_copy(path, (size_t)length);
    if (copy == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    int64_t result = chdir(copy) == 0 ? 0 : djos_last_error();
    free(copy);
    return result;
#endif
}

int32_t __djinn_process_is_elevated(void)
{
#ifdef _WIN32
    typedef BOOL(WINAPI * open_function)(HANDLE, DWORD, PHANDLE);
    typedef BOOL(WINAPI * query_function)(HANDLE, TOKEN_INFORMATION_CLASS, LPVOID, DWORD, PDWORD);
    open_function open_token = (open_function)(void*)djos_system_function(L"advapi32.dll", "OpenProcessToken");
    query_function query = (query_function)(void*)djos_system_function(L"advapi32.dll", "GetTokenInformation");
    HANDLE token = NULL;
    if (open_token == NULL || query == NULL || !open_token(GetCurrentProcess(), TOKEN_QUERY, &token)) return 0;
    TOKEN_ELEVATION elevation = {0};
    DWORD size = 0;
    int32_t elevated = query(token, TokenElevation, &elevation, sizeof elevation, &size) && elevation.TokenIsElevated != 0;
    CloseHandle(token);
    return elevated;
#else
    return geteuid() == 0;
#endif
}

// out[0] = resident bytes now, out[1] = the most resident bytes at once.
int64_t __djinn_process_memory(int64_t* out)
{
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS counters;
    if (!GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof counters)) return djos_last_error();
    out[0] = (int64_t)counters.WorkingSetSize;
    out[1] = (int64_t)counters.PeakWorkingSetSize;
    return 0;
#else
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0) return djos_last_error();
#ifdef __APPLE__
    struct mach_task_basic_info info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) return DJOS_FAIL(DJOS_UNKNOWN);
    out[0] = (int64_t)info.resident_size;
    out[1] = (int64_t)usage.ru_maxrss;
#else
    FILE* statm = fopen("/proc/self/statm", "r");
    if (statm == NULL) return djos_last_error();
    long long total = 0, resident = 0;
    int read_count = fscanf(statm, "%lld %lld", &total, &resident);
    fclose(statm);
    if (read_count != 2) return DJOS_FAIL(DJOS_UNKNOWN);
    out[0] = (int64_t)resident * (int64_t)sysconf(_SC_PAGESIZE);
    out[1] = (int64_t)usage.ru_maxrss * 1024;
#endif
    if (out[1] < out[0]) out[1] = out[0];
    return 0;
#endif
}

// out[0] = microseconds of CPU in user code, out[1] = in the kernel.
int64_t __djinn_process_cpu_time(int64_t* out)
{
#ifdef _WIN32
    FILETIME created, exited, kernel, user;
    if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) return djos_last_error();
    out[0] = (int64_t)((((uint64_t)user.dwHighDateTime << 32) | user.dwLowDateTime) / 10);
    out[1] = (int64_t)((((uint64_t)kernel.dwHighDateTime << 32) | kernel.dwLowDateTime) / 10);
    return 0;
#else
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0) return djos_last_error();
    out[0] = (int64_t)usage.ru_utime.tv_sec * 1000000 + usage.ru_utime.tv_usec;
    out[1] = (int64_t)usage.ru_stime.tv_sec * 1000000 + usage.ru_stime.tv_usec;
    return 0;
#endif
}

// 0 idle, 1 below normal, 2 normal, 3 above normal, 4 high
int64_t __djinn_process_set_priority(int32_t level)
{
    if (level < 0 || level > 4) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    static const DWORD classes[5] = {IDLE_PRIORITY_CLASS, BELOW_NORMAL_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
                                     ABOVE_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS};
    return SetPriorityClass(GetCurrentProcess(), classes[level]) ? 0 : djos_last_error();
#else
    static const int niceness[5] = {19, 10, 0, -5, -10};
    return setpriority(PRIO_PROCESS, 0, niceness[level]) == 0 ? 0 : djos_last_error();
#endif
}

// ── Handles: a HANDLE on Windows, a file descriptor elsewhere ──

#ifdef _WIN32
static HANDLE djos_handle(int64_t value) { return (HANDLE)(intptr_t)value; }

static HANDLE djos_standard_handle(int32_t stream)
{
    HANDLE handle = GetStdHandle(stream == 0 ? STD_INPUT_HANDLE : stream == 1 ? STD_OUTPUT_HANDLE : STD_ERROR_HANDLE);
    return handle == INVALID_HANDLE_VALUE ? NULL : handle;
}

static int32_t djos_kind_of(HANDLE handle)
{
    DWORD mode = 0;
    switch (GetFileType(handle) & ~FILE_TYPE_REMOTE)
    {
    case FILE_TYPE_DISK:
    {
        BY_HANDLE_FILE_INFORMATION info;
        if (GetFileInformationByHandle(handle, &info) && (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) return 5;
        return 1;
    }
    case FILE_TYPE_CHAR: return GetConsoleMode(handle, &mode) ? 2 : 6;
    case FILE_TYPE_PIPE: return GetNamedPipeInfo(handle, NULL, NULL, NULL, NULL) ? 3 : 4;
    default: return 0;
    }
}
#else
static int32_t djos_kind_of(int descriptor)
{
    struct stat info;
    if (fstat(descriptor, &info) != 0) return 0;
    if (S_ISREG(info.st_mode)) return 1;
    if (S_ISDIR(info.st_mode)) return 5;
    if (S_ISFIFO(info.st_mode)) return 3;
    if (S_ISSOCK(info.st_mode)) return 4;
    if (S_ISCHR(info.st_mode)) return isatty(descriptor) ? 2 : 6;
    return 0;
}
#endif

int64_t __djinn_handle_duplicate(int64_t handle)
{
    if (handle < 0) return DJOS_FAIL(DJOS_BAD_HANDLE);
#ifdef _WIN32
    HANDLE copy = NULL;
    if (!DuplicateHandle(GetCurrentProcess(), djos_handle(handle), GetCurrentProcess(), &copy, 0, FALSE, DUPLICATE_SAME_ACCESS))
        return djos_last_error();
    return (int64_t)(intptr_t)copy;
#else
    int copy = fcntl((int)handle, F_DUPFD_CLOEXEC, 3);
    return copy >= 0 ? copy : djos_last_error();
#endif
}

// A duplicate of a standard stream, so closing the handle never closes the stream of the process.
int64_t __djinn_handle_standard(int32_t stream)
{
    if (stream < 0 || stream > 2) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    HANDLE handle = djos_standard_handle(stream);
    if (handle == NULL) return DJOS_FAIL(DJOS_NOT_FOUND);
    return __djinn_handle_duplicate((int64_t)(intptr_t)handle);
#else
    return __djinn_handle_duplicate(stream);
#endif
}

int32_t __djinn_standard_kind(int32_t stream)
{
    if (stream < 0 || stream > 2) return 0;
#ifdef _WIN32
    HANDLE handle = djos_standard_handle(stream);
    return handle != NULL ? djos_kind_of(handle) : 0;
#else
    return djos_kind_of(stream);
#endif
}

int32_t __djinn_handle_kind(int64_t handle)
{
    if (handle < 0) return 0;
#ifdef _WIN32
    return djos_kind_of(djos_handle(handle));
#else
    return djos_kind_of((int)handle);
#endif
}

int64_t __djinn_handle_close(int64_t handle)
{
    if (handle < 0) return DJOS_FAIL(DJOS_BAD_HANDLE);
#ifdef _WIN32
    return CloseHandle(djos_handle(handle)) ? 0 : djos_last_error();
#else
    return close((int)handle) == 0 ? 0 : djos_last_error();
#endif
}

int64_t __djinn_handle_set_inheritable(int64_t handle, int32_t inheritable)
{
    if (handle < 0) return DJOS_FAIL(DJOS_BAD_HANDLE);
#ifdef _WIN32
    return SetHandleInformation(djos_handle(handle), HANDLE_FLAG_INHERIT, inheritable ? HANDLE_FLAG_INHERIT : 0) ? 0
                                                                                                              : djos_last_error();
#else
    int flags = fcntl((int)handle, F_GETFD);
    if (flags < 0) return djos_last_error();
    flags = inheritable ? flags & ~FD_CLOEXEC : flags | FD_CLOEXEC;
    return fcntl((int)handle, F_SETFD, flags) == 0 ? 0 : djos_last_error();
#endif
}

// Bytes read; 0 at the end of the stream.
int64_t __djinn_handle_read(int64_t handle, void* buffer, int64_t capacity)
{
    if (handle < 0) return DJOS_FAIL(DJOS_BAD_HANDLE);
    if (capacity < 0) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    if (capacity > INT32_MAX) capacity = INT32_MAX;
#ifdef _WIN32
    DWORD count = 0;
    if (!ReadFile(djos_handle(handle), buffer, (DWORD)capacity, &count, NULL))
        return GetLastError() == ERROR_BROKEN_PIPE ? 0 : djos_last_error();
    return (int64_t)count;
#else
    for (;;)
    {
        ssize_t count = read((int)handle, buffer, (size_t)capacity);
        if (count >= 0) return count;
        if (errno != EINTR) return djos_last_error();
    }
#endif
}

// Writes everything or fails. A pipe nobody reads comes back as an error, not as the SIGPIPE that ends the process.
int64_t __djinn_handle_write(int64_t handle, const void* data, int64_t length)
{
    if (handle < 0) return DJOS_FAIL(DJOS_BAD_HANDLE);
    if (length < 0) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    int64_t written = 0;
#ifndef _WIN32
    sigset_t blocked, previous;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGPIPE);
    pthread_sigmask(SIG_BLOCK, &blocked, &previous);
#endif
    int64_t result = 0;
    while (written < length)
    {
        int64_t left = length - written > INT32_MAX ? INT32_MAX : length - written;
#ifdef _WIN32
        DWORD count = 0;
        if (!WriteFile(djos_handle(handle), (const char*)data + written, (DWORD)left, &count, NULL))
        {
            result = djos_last_error();
            break;
        }
#else
        ssize_t count = write((int)handle, (const char*)data + written, (size_t)left);
        if (count < 0)
        {
            if (errno == EINTR) continue;
            result = djos_last_error();
            break;
        }
#endif
        if (count == 0)
        {
            result = DJOS_FAIL(DJOS_BROKEN_PIPE);
            break;
        }
        written += (int64_t)count;
    }
#ifndef _WIN32
    if (!sigismember(&previous, SIGPIPE))
    {
        sigset_t pending;
        sigpending(&pending);
        if (sigismember(&pending, SIGPIPE))
        {
            int taken = 0;
            sigwait(&blocked, &taken);
        }
        pthread_sigmask(SIG_SETMASK, &previous, NULL);
    }
#endif
    return result < 0 ? result : written;
}

#ifndef _WIN32
static int djos_pipe(int ends[2])
{
#ifdef __linux__
    return pipe2(ends, O_CLOEXEC);
#else
    if (pipe(ends) != 0) return -1;
    fcntl(ends[0], F_SETFD, FD_CLOEXEC);
    fcntl(ends[1], F_SETFD, FD_CLOEXEC);
    return 0;
#endif
}
#endif

// out[0] = the reading end, out[1] = the writing end; neither is inherited by child processes.
int64_t __djinn_handle_pipe(int64_t* out)
{
#ifdef _WIN32
    HANDLE reader = NULL, writer = NULL;
    if (!CreatePipe(&reader, &writer, NULL, 0)) return djos_last_error();
    out[0] = (int64_t)(intptr_t)reader;
    out[1] = (int64_t)(intptr_t)writer;
    return 0;
#else
    int ends[2];
    if (djos_pipe(ends) != 0) return djos_last_error();
    out[0] = ends[0];
    out[1] = ends[1];
    return 0;
#endif
}

// ── Modules (shared libraries) ──

int64_t __djinn_module_open(const char* path, int64_t length, void** out)
{
    *out = NULL;
    if (length <= 0 || !djos_is_text(path, length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    wchar_t* wide = djos_wide(path, length);
    if (wide == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    // The working directory and PATH are never searched, so a planted DLL beside the data of a program is not picked up.
    DWORD flags = LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
    if (wcspbrk(wide, L"/\\") != NULL)
    {
        for (wchar_t* at = wide; *at != 0; at++)
            if (*at == L'/') *at = L'\\';
        wchar_t full[4096];
        DWORD count = GetFullPathNameW(wide, 4096, full, NULL);
        free(wide);
        if (count == 0 || count >= 4096) return DJOS_FAIL(DJOS_TOO_LONG);
        wide = _wcsdup(full);
        if (wide == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        flags |= LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR;
    }
    HMODULE module = LoadLibraryExW(wide, NULL, flags);
    int64_t result = module != NULL ? 0 : djos_last_error();
    free(wide);
    *out = (void*)module;
    return result;
#else
    char* copy = djos_heap_copy(path, (size_t)length);
    if (copy == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    *out = dlopen(copy, RTLD_NOW | RTLD_LOCAL);
    int64_t result = 0;
    if (*out == NULL)
    {
        struct stat info;
        int exists = strchr(copy, '/') != NULL && stat(copy, &info) == 0;
        result = DJOS_FAIL(exists ? DJOS_NOT_EXECUTABLE : DJOS_NOT_FOUND);
    }
    free(copy);
    return result;
#endif
}

void* __djinn_module_self(void)
{
#ifdef _WIN32
    HMODULE module = NULL;
    return GetModuleHandleExW(0, NULL, &module) ? (void*)module : NULL;
#else
    return dlopen(NULL, RTLD_NOW);
#endif
}

void* __djinn_module_symbol(void* module, const char* name, int64_t length)
{
    if (module == NULL || length <= 0 || !djos_is_text(name, length)) return NULL;
    char* copy = djos_heap_copy(name, (size_t)length);
    if (copy == NULL) return NULL;
#ifdef _WIN32
    void* address = (void*)GetProcAddress((HMODULE)module, copy);
#else
    void* address = dlsym(module, copy);
#endif
    free(copy);
    return address;
}

void __djinn_module_close(void* module)
{
    if (module == NULL) return;
#ifdef _WIN32
    FreeLibrary((HMODULE)module);
#else
    dlclose(module);
#endif
}

// ── Memory regions: pages taken straight from the operating system ──

int64_t __djinn_memory_page_size(void)
{
#ifdef _WIN32
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    return (int64_t)info.dwPageSize;
#else
    return (int64_t)sysconf(_SC_PAGESIZE);
#endif
}

int64_t __djinn_memory_granularity(void)
{
#ifdef _WIN32
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    return (int64_t)info.dwAllocationGranularity;
#else
    return (int64_t)sysconf(_SC_PAGESIZE);
#endif
}

// 0 no access, 1 read, 2 read and write, 3 read and execute. No protection is writable and executable at once.
static int djos_protection_ok(int32_t protection) { return protection >= 0 && protection <= 3; }

#ifdef _WIN32
static const DWORD djos_protections[4] = {PAGE_NOACCESS, PAGE_READONLY, PAGE_READWRITE, PAGE_EXECUTE_READ};
#else
static const int djos_protections[4] = {PROT_NONE, PROT_READ, PROT_READ | PROT_WRITE, PROT_READ | PROT_EXEC};
#endif

// The length of the mapping (size rounded up to whole pages).
int64_t __djinn_memory_map(int64_t size, int32_t protection, void** out)
{
    *out = NULL;
    int64_t page = __djinn_memory_page_size();
    if (size <= 0 || size > INT64_MAX - page || !djos_protection_ok(protection)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    int64_t length = (size + page - 1) / page * page;
#ifdef _WIN32
    void* base = VirtualAlloc(NULL, (SIZE_T)length, MEM_RESERVE | MEM_COMMIT, djos_protections[protection]);
    if (base == NULL) return djos_last_error();
#else
    void* base = mmap(NULL, (size_t)length, djos_protections[protection], MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (base == MAP_FAILED) return djos_last_error();
#endif
    *out = base;
    return length;
}

int64_t __djinn_memory_protect(void* base, int64_t length, int32_t protection)
{
    if (base == NULL || length <= 0 || !djos_protection_ok(protection)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    DWORD previous = 0;
    if (!VirtualProtect(base, (SIZE_T)length, djos_protections[protection], &previous)) return djos_last_error();
    if (protection == 3) FlushInstructionCache(GetCurrentProcess(), base, (SIZE_T)length);
#else
    if (protection == 3) __builtin___clear_cache((char*)base, (char*)base + length);
    if (mprotect(base, (size_t)length, djos_protections[protection]) != 0) return djos_last_error();
#endif
    return 0;
}

int64_t __djinn_memory_unmap(void* base, int64_t length)
{
    if (base == NULL || length <= 0) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    return VirtualFree(base, 0, MEM_RELEASE) ? 0 : djos_last_error();
#else
    return munmap(base, (size_t)length) == 0 ? 0 : djos_last_error();
#endif
}

int64_t __djinn_memory_set_locked(void* base, int64_t length, int32_t locked)
{
    if (base == NULL || length <= 0) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    BOOL done = locked ? VirtualLock(base, (SIZE_T)length) : VirtualUnlock(base, (SIZE_T)length);
    return done ? 0 : djos_last_error();
#else
    int status = locked ? mlock(base, (size_t)length) : munlock(base, (size_t)length);
    return status == 0 ? 0 : djos_last_error();
#endif
}

// ── Threads ──

int64_t __djinn_thread_current_id(void)
{
#ifdef _WIN32
    return (int64_t)GetCurrentThreadId();
#elif defined(__APPLE__)
    uint64_t id = 0;
    pthread_threadid_np(NULL, &id);
    return (int64_t)id;
#else
    return (int64_t)syscall(SYS_gettid);
#endif
}

void __djinn_os_thread_sleep(int64_t milliseconds)
{
    __djinn_thread_sleep(milliseconds);
}

void __djinn_thread_yield(void)
{
#ifdef _WIN32
    SwitchToThread();
#else
    sched_yield();
#endif
}

// The name debuggers and profilers show. Linux keeps the first 15 bytes.
int64_t __djinn_thread_set_name(const char* name, int64_t length)
{
    if (!djos_is_text(name, length)) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#ifdef _WIN32
    typedef HRESULT(WINAPI * describe_function)(HANDLE, PCWSTR);
    describe_function describe = (describe_function)(void*)djos_system_function(L"kernel32.dll", "SetThreadDescription");
    if (describe == NULL) return DJOS_FAIL(DJOS_UNSUPPORTED);
    wchar_t* wide = djos_wide(name, length);
    if (wide == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    HRESULT status = describe(GetCurrentThread(), wide);
    free(wide);
    return SUCCEEDED(status) ? 0 : DJOS_FAIL(DJOS_UNKNOWN);
#else
    char text[64];
    size_t limit = 15;
#ifdef __APPLE__
    limit = sizeof text - 1;
#endif
    size_t count = (size_t)length < limit ? (size_t)length : limit;
    memcpy(text, name, count);
    text[count] = 0;
#ifdef __APPLE__
    int status = pthread_setname_np(text);
#else
    int status = pthread_setname_np(pthread_self(), text);
#endif
    if (status == 0) return 0;
    errno = status;
    return djos_last_error();
#endif
}

// ── The machine and the user ──

int32_t __djinn_os_kind(void)
{
#ifdef _WIN32
    return 1;
#elif defined(__ANDROID__)
    return 4;
#elif defined(__linux__)
    return 2;
#elif defined(__APPLE__)
#if TARGET_OS_IPHONE
    return 5;
#else
    return 3;
#endif
#else
    return 0;
#endif
}

int32_t __djinn_cpu_architecture(void)
{
#if defined(__x86_64__) || defined(_M_X64)
    return 1;
#elif defined(__aarch64__) || defined(_M_ARM64)
    return 2;
#elif defined(__i386__) || defined(_M_IX86)
    return 3;
#elif defined(__arm__) || defined(_M_ARM)
    return 4;
#elif defined(__riscv) && __riscv_xlen == 64
    return 5;
#else
    return 0;
#endif
}

int32_t __djinn_cpu_count(void)
{
#ifdef _WIN32
    DWORD count = GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
    return count > 0 ? (int32_t)count : 1;
#else
    long count = sysconf(_SC_NPROCESSORS_ONLN);
    return count > 0 ? (int32_t)count : 1;
#endif
}

// Physical memory in bytes (available = 0) or what is free for new allocations (available = 1); 0 when unknown.
int64_t __djinn_system_memory(int32_t available)
{
#ifdef _WIN32
    MEMORYSTATUSEX status;
    status.dwLength = sizeof status;
    if (!GlobalMemoryStatusEx(&status)) return 0;
    return (int64_t)(available ? status.ullAvailPhys : status.ullTotalPhys);
#elif defined(__APPLE__)
    if (available)
    {
        vm_statistics64_data_t statistics;
        mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
        if (host_statistics64(mach_host_self(), HOST_VM_INFO64, (host_info64_t)&statistics, &count) != KERN_SUCCESS) return 0;
        return (int64_t)(statistics.free_count + statistics.inactive_count) * (int64_t)sysconf(_SC_PAGESIZE);
    }
    int64_t total = 0;
    size_t size = sizeof total;
    return sysctlbyname("hw.memsize", &total, &size, NULL, 0) == 0 ? total : 0;
#else
    if (!available) return (int64_t)sysconf(_SC_PHYS_PAGES) * (int64_t)sysconf(_SC_PAGESIZE);
    FILE* meminfo = fopen("/proc/meminfo", "r");
    if (meminfo == NULL) return 0;
    char line[128];
    long long kilobytes = 0;
    while (fgets(line, sizeof line, meminfo) != NULL)
        if (sscanf(line, "MemAvailable: %lld kB", &kilobytes) == 1) break;
    fclose(meminfo);
    return (int64_t)kilobytes * 1024;
#endif
}

// Milliseconds since the machine started; 0 when unknown.
int64_t __djinn_system_uptime_ms(void)
{
#ifdef _WIN32
    return (int64_t)GetTickCount64();
#elif defined(__APPLE__)
    struct timeval booted;
    size_t size = sizeof booted;
    int name[2] = {CTL_KERN, KERN_BOOTTIME};
    if (sysctl(name, 2, &booted, &size, NULL, 0) != 0) return 0;
    return __djinn_unix_timestamp_ms() - ((int64_t)booted.tv_sec * 1000 + booted.tv_usec / 1000);
#else
    struct timespec ts;
    if (clock_gettime(CLOCK_BOOTTIME, &ts) != 0) return 0;
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
#endif
}

// 0 host name, 1 user name, 2 home directory, 3 temporary directory, 4 operating system version
int64_t __djinn_system_text(int32_t which, char** out)
{
    *out = NULL;
#ifdef _WIN32
    wchar_t wide[32768];
    if (which == 0)
    {
        DWORD count = 32768;
        if (!GetComputerNameExW(ComputerNameDnsHostname, wide, &count)) return djos_last_error();
        return djos_give_wide(wide, (int)count, out);
    }
    if (which == 1)
    {
        typedef BOOL(WINAPI * user_function)(LPWSTR, LPDWORD);
        user_function user_name = (user_function)(void*)djos_system_function(L"advapi32.dll", "GetUserNameW");
        DWORD count = 32768;
        if (user_name == NULL) return DJOS_FAIL(DJOS_UNSUPPORTED);
        if (!user_name(wide, &count) || count == 0) return djos_last_error();
        return djos_give_wide(wide, (int)count - 1, out);
    }
    if (which == 2 || which == 3)
    {
        DWORD count = which == 2 ? GetEnvironmentVariableW(L"USERPROFILE", wide, 32768) : GetTempPathW(32768, wide);
        if (count == 0 || count >= 32768) return DJOS_FAIL(DJOS_NOT_FOUND);
        if (count > 3 && (wide[count - 1] == L'\\' || wide[count - 1] == L'/')) count--;
        int64_t length = djos_give_wide(wide, (int)count, out);
        if (length >= 0) djos_forward_slashes(*out);
        return length;
    }
    if (which == 4)
    {
        typedef LONG(WINAPI * version_function)(OSVERSIONINFOW*);
        version_function version = (version_function)(void*)djos_system_function(L"ntdll.dll", "RtlGetVersion");
        OSVERSIONINFOW info;
        memset(&info, 0, sizeof info);
        info.dwOSVersionInfoSize = sizeof info;
        if (version == NULL || version(&info) != 0) return DJOS_FAIL(DJOS_UNSUPPORTED);
        char text[64];
        int count = snprintf(text, sizeof text, "%lu.%lu.%lu", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber);
        return djos_give(text, (size_t)count, out);
    }
    return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#else
    if (which == 0)
    {
        char name[256];
        if (gethostname(name, sizeof name) != 0) return djos_last_error();
        name[sizeof name - 1] = 0;
        return djos_give(name, strlen(name), out);
    }
    if (which == 1 || which == 2)
    {
        if (which == 2)
        {
            djos_acquire();
            const char* home = getenv("HOME");
            int64_t length = home != NULL && home[0] != 0 ? djos_give(home, strlen(home), out) : -1;
            djos_release();
            if (length >= 0) return length;
        }
        struct passwd entry;
        struct passwd* found = NULL;
        char storage[4096];
        if (getpwuid_r(geteuid(), &entry, storage, sizeof storage, &found) != 0 || found == NULL) return DJOS_FAIL(DJOS_NOT_FOUND);
        const char* text = which == 1 ? found->pw_name : found->pw_dir;
        return djos_give(text, strlen(text), out);
    }
    if (which == 3)
    {
        djos_acquire();
        const char* directory = getenv("TMPDIR");
#ifdef __ANDROID__
        const char* fallback = "/data/local/tmp";
#else
        const char* fallback = "/tmp";
#endif
        if (directory == NULL || directory[0] == 0) directory = fallback;
        size_t count = strlen(directory);
        if (count > 1 && directory[count - 1] == '/') count--;
        int64_t length = djos_give(directory, count, out);
        djos_release();
        return length;
    }
    if (which == 4)
    {
        struct utsname name;
        if (uname(&name) != 0) return djos_last_error();
        return djos_give(name.release, strlen(name.release), out);
    }
    return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
#endif
}

// ── Commands: a child process described piece by piece, then started without a shell unless one was asked for ──

typedef struct djos_command
{
    char* program;
    djos_list_t arguments;
    djos_list_t changed_names;
    char** changed_values; // NULL removes the variable
    int32_t changed_capacity;
    char* directory;
    char* input;
    int32_t input_length;
    int32_t stream_modes[3]; // 0 piped, 1 inherited, 2 discarded
    int32_t clear_environment;
    int32_t shell;
    int64_t failure; // the first refused piece; start reports it
} djos_command_t;

static int64_t djos_command_fail(djos_command_t* command, int64_t failure)
{
    if (command == NULL) return DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    if (command->failure == 0) command->failure = failure;
    return failure;
}

void* __djinn_command_create(const char* program, int64_t length, int32_t shell)
{
    djos_command_t* command = (djos_command_t*)calloc(1, sizeof *command);
    if (command == NULL) return NULL;
    command->shell = shell != 0;
    if (length <= 0 || !djos_is_text(program, length)) djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    else command->program = djos_heap_copy(program, (size_t)length);
    return command;
}

int64_t __djinn_command_arg(void* handle, const char* text, int64_t length)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL || command->shell || !djos_is_text(text, length)) return djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    if (!djos_list_push(&command->arguments, djos_heap_copy(text, (size_t)length)))
        return djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
    return 0;
}

int64_t __djinn_command_env(void* handle, const char* name, int64_t name_length, const char* value, int64_t value_length,
                            int32_t remove)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL || !djos_is_env_name(name, name_length) || (!remove && !djos_is_text(value, value_length)))
        return djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    if (command->changed_names.count >= command->changed_capacity)
    {
        int32_t capacity = command->changed_capacity > 0 ? command->changed_capacity * 2 : 8;
        char** values = (char**)realloc(command->changed_values, (size_t)capacity * sizeof(char*));
        if (values == NULL) return djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
        command->changed_values = values;
        command->changed_capacity = capacity;
    }
    char* text = NULL;
    if (!remove)
    {
        text = djos_heap_copy(value, (size_t)value_length);
        if (text == NULL) return djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
    }
    int32_t slot = command->changed_names.count;
    if (!djos_list_push(&command->changed_names, djos_heap_copy(name, (size_t)name_length)))
    {
        free(text);
        return djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
    }
    command->changed_values[slot] = text;
    return 0;
}

void __djinn_command_clear_env(void* handle)
{
    if (handle != NULL) ((djos_command_t*)handle)->clear_environment = 1;
}

int64_t __djinn_command_directory(void* handle, const char* path, int64_t length)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL || length <= 0 || !djos_is_text(path, length))
        return djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    free(command->directory);
    command->directory = djos_heap_copy(path, (size_t)length);
    return command->directory != NULL ? 0 : djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
}

// The bytes are copied: the caller's buffer may go away before the child reads them.
int64_t __djinn_command_input(void* handle, const char* data, int64_t length)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL || length < 0 || length >= INT32_MAX) return djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    char* copy = djos_heap_copy(data, (size_t)length);
    if (copy == NULL) return djos_command_fail(command, DJOS_FAIL(DJOS_OUT_OF_MEMORY));
    free(command->input);
    command->input = copy;
    command->input_length = (int32_t)length;
    command->stream_modes[0] = 0;
    return 0;
}

int64_t __djinn_command_stream(void* handle, int32_t stream, int32_t mode)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL || stream < 0 || stream > 2 || mode < 0 || mode > 2) return djos_command_fail(command, DJOS_FAIL(DJOS_INVALID_ARGUMENT));
    command->stream_modes[stream] = mode;
    return 0;
}

void __djinn_command_free(void* handle)
{
    djos_command_t* command = (djos_command_t*)handle;
    if (command == NULL) return;
    for (int32_t i = 0; i < command->changed_names.count; i++) free(command->changed_values[i]);
    free(command->changed_values);
    djos_list_clear(&command->changed_names);
    djos_list_clear(&command->arguments);
    free(command->program);
    free(command->directory);
    free(command->input);
    free(command);
}

#ifdef _WIN32
typedef struct djos_wide_buffer
{
    wchar_t* data;
    size_t length;
    size_t capacity;
    int failed;
} djos_wide_buffer_t;

static void djos_wide_append(djos_wide_buffer_t* buffer, const wchar_t* text, size_t count)
{
    if (buffer->failed) return;
    if (buffer->length + count + 1 > buffer->capacity)
    {
        size_t capacity = buffer->capacity > 0 ? buffer->capacity : 256;
        while (capacity < buffer->length + count + 1) capacity *= 2;
        wchar_t* data = (wchar_t*)realloc(buffer->data, capacity * sizeof(wchar_t));
        if (data == NULL)
        {
            buffer->failed = 1;
            return;
        }
        buffer->data = data;
        buffer->capacity = capacity;
    }
    memcpy(buffer->data + buffer->length, text, count * sizeof(wchar_t));
    buffer->length += count;
    buffer->data[buffer->length] = 0;
}

static void djos_wide_repeat(djos_wide_buffer_t* buffer, wchar_t value, size_t count)
{
    for (size_t i = 0; i < count; i++) djos_wide_append(buffer, &value, 1);
}

// The quoting the Microsoft C runtime undoes: backslashes are literal except before a quote.
static void djos_quote(djos_wide_buffer_t* line, const wchar_t* argument)
{
    if (argument[0] != 0 && wcspbrk(argument, L" \t\n\v\"") == NULL)
    {
        djos_wide_append(line, argument, wcslen(argument));
        return;
    }
    djos_wide_append(line, L"\"", 1);
    for (const wchar_t* at = argument;; at++)
    {
        size_t slashes = 0;
        while (*at == L'\\')
        {
            at++;
            slashes++;
        }
        if (*at == 0)
        {
            djos_wide_repeat(line, L'\\', slashes * 2);
            break;
        }
        djos_wide_repeat(line, L'\\', *at == L'"' ? slashes * 2 + 1 : slashes);
        djos_wide_append(line, at, 1);
    }
    djos_wide_append(line, L"\"", 1);
}

static int djos_is_file(const wchar_t* path)
{
    DWORD attributes = GetFileAttributesW(path);
    return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

// A name with a separator is used as written; a bare name is looked up in PATH only (not in the working directory).
static wchar_t* djos_resolve_program(const wchar_t* program)
{
    wchar_t found[4096];
    if (wcspbrk(program, L"/\\:") != NULL)
    {
        if (djos_is_file(program)) return _wcsdup(program);
        if (_snwprintf_s(found, 4096, _TRUNCATE, L"%ls.exe", program) > 0 && djos_is_file(found)) return _wcsdup(found);
        return NULL;
    }
    wchar_t* path = (wchar_t*)malloc(32768 * sizeof(wchar_t));
    if (path == NULL) return NULL;
    wchar_t* result = NULL;
    djos_acquire();
    DWORD count = GetEnvironmentVariableW(L"PATH", path, 32768);
    djos_release();
    if (count > 0 && count < 32768)
    {
        DWORD length = SearchPathW(path, program, L".exe", 4096, found, NULL);
        if (length > 0 && length < 4096) result = _wcsdup(found);
    }
    free(path);
    return result;
}

// cmd.exe parses its command line by other rules than the quoting above, so arguments could become commands.
static int djos_is_batch_file(const wchar_t* path)
{
    size_t length = wcslen(path);
    while (length > 0 && (path[length - 1] == L' ' || path[length - 1] == L'.')) length--;
    if (length < 4) return 0;
    return _wcsnicmp(path + length - 4, L".bat", 4) == 0 || _wcsnicmp(path + length - 4, L".cmd", 4) == 0;
}

static int djos_compare_entries(const void* left, const void* right)
{
    const wchar_t* a = *(const wchar_t* const*)left;
    const wchar_t* b = *(const wchar_t* const*)right;
    const wchar_t* a_end = wcschr(a + 1, L'=');
    const wchar_t* b_end = wcschr(b + 1, L'=');
    int a_length = (int)(a_end != NULL ? a_end - a : (ptrdiff_t)wcslen(a));
    int b_length = (int)(b_end != NULL ? b_end - b : (ptrdiff_t)wcslen(b));
    return CompareStringOrdinal(a, a_length, b, b_length, TRUE) - CSTR_EQUAL;
}

// NULL with *failed clear means "inherit the environment of this process".
static wchar_t* djos_environment_block(const djos_command_t* command, int* failed)
{
    *failed = 0;
    if (!command->clear_environment && command->changed_names.count == 0) return NULL;
    wchar_t** entries = NULL;
    size_t count = 0, capacity = 0;
    wchar_t* inherited = NULL;
    size_t inherited_count = 0;
    if (!command->clear_environment)
    {
        djos_acquire();
        inherited = GetEnvironmentStringsW();
        djos_release();
        if (inherited != NULL)
            for (wchar_t* entry = inherited; *entry != 0; entry += wcslen(entry) + 1) inherited_count++;
    }
    capacity = inherited_count + (size_t)command->changed_names.count + 1;
    entries = (wchar_t**)calloc(capacity, sizeof(wchar_t*));
    if (entries == NULL) *failed = 1;
    if (inherited != NULL)
    {
        if (entries != NULL)
            for (wchar_t* entry = inherited; *entry != 0; entry += wcslen(entry) + 1) entries[count++] = _wcsdup(entry);
        FreeEnvironmentStringsW(inherited);
    }
    for (int32_t i = 0; !*failed && i < command->changed_names.count; i++)
    {
        const char* name = command->changed_names.items[i];
        const char* value = command->changed_values[i];
        wchar_t* key = djos_wide(name, (int64_t)strlen(name));
        wchar_t* text = value != NULL ? djos_wide(value, (int64_t)strlen(value)) : NULL;
        if (key == NULL || (value != NULL && text == NULL))
        {
            *failed = 1;
        }
        else
        {
            size_t key_length = wcslen(key);
            for (size_t j = 0; j < count; j++)
            {
                if (_wcsnicmp(entries[j], key, key_length) == 0 && entries[j][key_length] == L'=')
                {
                    free(entries[j]);
                    entries[j] = entries[--count];
                    break;
                }
            }
            if (value != NULL)
            {
                size_t size = key_length + wcslen(text) + 2;
                wchar_t* entry = (wchar_t*)malloc(size * sizeof(wchar_t));
                if (entry == NULL) *failed = 1;
                else
                {
                    _snwprintf_s(entry, size, _TRUNCATE, L"%ls=%ls", key, text);
                    entries[count++] = entry;
                }
            }
        }
        free(key);
        free(text);
    }
    djos_wide_buffer_t block = {0};
    if (!*failed)
    {
        qsort(entries, count, sizeof(wchar_t*), djos_compare_entries);
        for (size_t i = 0; i < count; i++) djos_wide_append(&block, entries[i], wcslen(entries[i]) + 1);
        if (count == 0) djos_wide_append(&block, L"", 1);
        djos_wide_append(&block, L"", 1);
        *failed = block.failed;
    }
    for (size_t i = 0; i < count; i++) free(entries[i]);
    free(entries);
    if (*failed)
    {
        free(block.data);
        return NULL;
    }
    return block.data;
}

static void djos_close_if_open(HANDLE* handle)
{
    if (*handle != NULL) CloseHandle(*handle);
    *handle = NULL;
}

static int64_t djos_spawn(djos_command_t* command, djinn_process_t* process)
{
    wchar_t* program = NULL;
    wchar_t* directory = NULL;
    wchar_t* environment = NULL;
    djos_wide_buffer_t line = {0};
    HANDLE child[3] = {NULL, NULL, NULL};
    HANDLE parent[3] = {NULL, NULL, NULL};
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    int attributes_ready = 0;
    int64_t result = 0;

    wchar_t* requested = djos_wide(command->program, (int64_t)strlen(command->program));
    if (requested == NULL) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    if (command->shell)
    {
        wchar_t system_directory[MAX_PATH];
        wchar_t shell[MAX_PATH + 16];
        UINT count = GetSystemDirectoryW(system_directory, MAX_PATH);
        if (count > 0 && count < MAX_PATH)
        {
            _snwprintf_s(shell, MAX_PATH + 16, _TRUNCATE, L"%ls\\cmd.exe", system_directory);
            program = _wcsdup(shell);
        }
        djos_wide_append(&line, L"cmd.exe /d /s /c \"", 18);
        djos_wide_append(&line, requested, wcslen(requested));
        djos_wide_append(&line, L"\"", 1);
    }
    else
    {
        program = djos_resolve_program(requested);
        djos_quote(&line, requested);
        for (int32_t i = 0; i < command->arguments.count; i++)
        {
            wchar_t* argument = djos_wide(command->arguments.items[i], (int64_t)strlen(command->arguments.items[i]));
            if (argument == NULL)
            {
                result = DJOS_FAIL(DJOS_INVALID_ARGUMENT);
                break;
            }
            djos_wide_append(&line, L" ", 1);
            djos_quote(&line, argument);
            free(argument);
        }
    }
    free(requested);

    if (result == 0 && program == NULL) result = DJOS_FAIL(DJOS_NOT_FOUND);
    if (result == 0 && !command->shell && djos_is_batch_file(program)) result = DJOS_FAIL(DJOS_UNSUPPORTED);
    if (result == 0 && (line.failed || line.length >= 32767)) result = DJOS_FAIL(DJOS_TOO_LONG);
    if (result == 0 && command->directory != NULL)
    {
        directory = djos_wide(command->directory, (int64_t)strlen(command->directory));
        if (directory == NULL) result = DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    }
    if (result == 0)
    {
        int failed = 0;
        environment = djos_environment_block(command, &failed);
        if (failed) result = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    }

    int inherits = 0;
    for (int stream = 0; result == 0 && stream < 3; stream++)
    {
        int32_t mode = command->stream_modes[stream];
        if (mode == 0)
        {
            HANDLE reader = NULL, writer = NULL;
            if (!CreatePipe(&reader, &writer, NULL, 0)) result = djos_last_error();
            child[stream] = stream == 0 ? reader : writer;
            parent[stream] = stream == 0 ? writer : reader;
        }
        else
        {
            HANDLE own = mode == 1 ? djos_standard_handle(stream) : NULL;
            if (own != NULL && DuplicateHandle(GetCurrentProcess(), own, GetCurrentProcess(), &child[stream], 0, FALSE,
                                               DUPLICATE_SAME_ACCESS))
                inherits = 1;
            else
            {
                child[stream] = CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                                            OPEN_EXISTING, 0, NULL);
                if (child[stream] == INVALID_HANDLE_VALUE)
                {
                    child[stream] = NULL;
                    result = djos_last_error();
                }
            }
        }
        if (result == 0 && !SetHandleInformation(child[stream], HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT)) result = djos_last_error();
    }

    if (result == 0)
    {
        SIZE_T size = 0;
        InitializeProcThreadAttributeList(NULL, 1, 0, &size);
        attributes = (LPPROC_THREAD_ATTRIBUTE_LIST)malloc(size);
        if (attributes == NULL || !InitializeProcThreadAttributeList(attributes, 1, 0, &size)) result = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        else attributes_ready = 1;
    }
    // only these three handles reach the child, whatever else this process left inheritable
    if (result == 0 && !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, child, sizeof child, NULL, NULL))
        result = djos_last_error();
    if (result == 0)
    {
        STARTUPINFOEXW startup;
        memset(&startup, 0, sizeof startup);
        startup.StartupInfo.cb = sizeof startup;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = child[0];
        startup.StartupInfo.hStdOutput = child[1];
        startup.StartupInfo.hStdError = child[2];
        startup.lpAttributeList = attributes;
        PROCESS_INFORMATION info;
        memset(&info, 0, sizeof info);
        DWORD flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | (inherits ? 0 : CREATE_NO_WINDOW);
        if (!CreateProcessW(program, line.data, NULL, NULL, TRUE, flags, environment, directory, &startup.StartupInfo, &info))
            result = djos_last_error();
        else
        {
            CloseHandle(info.hThread);
            process->process = info.hProcess;
            process->id = (int64_t)info.dwProcessId;
            process->stdin_write = parent[0];
            process->stdout_read = parent[1];
            process->stderr_read = parent[2];
            parent[0] = parent[1] = parent[2] = NULL;
        }
    }

    for (int stream = 0; stream < 3; stream++)
    {
        djos_close_if_open(&child[stream]);
        djos_close_if_open(&parent[stream]);
    }
    if (attributes_ready) DeleteProcThreadAttributeList(attributes);
    free(attributes);
    free(line.data);
    free(environment);
    free(directory);
    free(program);
    return result;
}
#else
static char* djos_resolve_program(const char* program)
{
    if (strchr(program, '/') != NULL) return djos_heap_copy(program, strlen(program));
    djos_acquire();
    const char* variable = getenv("PATH");
    char* path = variable != NULL ? djos_heap_copy(variable, strlen(variable)) : NULL;
    djos_release();
    const char* at = path != NULL ? path : "/usr/bin:/bin";
    char* found = NULL;
    while (found == NULL)
    {
        const char* end = strchr(at, ':');
        size_t length = end != NULL ? (size_t)(end - at) : strlen(at);
        if (length > 0)
        {
            size_t size = length + strlen(program) + 2;
            char* candidate = (char*)malloc(size);
            if (candidate == NULL) break;
            snprintf(candidate, size, "%.*s/%s", (int)length, at, program);
            struct stat info;
            if (stat(candidate, &info) == 0 && S_ISREG(info.st_mode) && access(candidate, X_OK) == 0) found = candidate;
            else free(candidate);
        }
        if (end == NULL) break;
        at = end + 1;
    }
    free(path);
    return found;
}

static int djos_environment_vector(const djos_command_t* command, djos_list_t* out)
{
    if (!command->clear_environment)
    {
        djos_acquire();
        for (char** entry = environ; entry != NULL && *entry != NULL; entry++)
            djos_list_push(out, djos_heap_copy(*entry, strlen(*entry)));
        djos_release();
    }
    for (int32_t i = 0; i < command->changed_names.count; i++)
    {
        const char* name = command->changed_names.items[i];
        const char* value = command->changed_values[i];
        size_t name_length = strlen(name);
        for (int32_t j = 0; j < out->count; j++)
        {
            if (strncmp(out->items[j], name, name_length) == 0 && out->items[j][name_length] == '=')
            {
                free(out->items[j]);
                out->items[j] = out->items[--out->count];
                out->items[out->count] = NULL;
                break;
            }
        }
        if (value != NULL)
        {
            size_t size = name_length + strlen(value) + 2;
            char* entry = (char*)malloc(size);
            if (entry == NULL) return 0;
            snprintf(entry, size, "%s=%s", name, value);
            if (!djos_list_push(out, entry)) return 0;
        }
    }
    return 1;
}

static void djos_close_if_open(int* descriptor)
{
    if (*descriptor >= 0) close(*descriptor);
    *descriptor = -1;
}

static int64_t djos_spawn(djos_command_t* command, djinn_process_t* process)
{
    int child[3] = {-1, -1, -1};
    int parent[3] = {-1, -1, -1};
    int report[2] = {-1, -1};
    djos_list_t environment = {0};
    int64_t result = 0;
#ifdef __ANDROID__
    const char* shell = "/system/bin/sh";
#else
    const char* shell = "/bin/sh";
#endif
    char* program = command->shell ? djos_heap_copy(shell, strlen(shell)) : djos_resolve_program(command->program);
    char** vector = (char**)calloc((size_t)command->arguments.count + 4, sizeof(char*));
    char* empty_environment[1] = {NULL};

    if (program == NULL) result = DJOS_FAIL(DJOS_NOT_FOUND);
    else if (vector == NULL || !djos_environment_vector(command, &environment)) result = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
    else if (command->shell)
    {
        vector[0] = (char*)"sh";
        vector[1] = (char*)"-c";
        vector[2] = command->program;
    }
    else
    {
        vector[0] = command->program;
        for (int32_t i = 0; i < command->arguments.count; i++) vector[i + 1] = command->arguments.items[i];
    }

    for (int stream = 0; result == 0 && stream < 3; stream++)
    {
        int32_t mode = command->stream_modes[stream];
        if (mode == 0)
        {
            int ends[2];
            if (djos_pipe(ends) != 0) result = djos_last_error();
            else
            {
                child[stream] = stream == 0 ? ends[0] : ends[1];
                parent[stream] = stream == 0 ? ends[1] : ends[0];
            }
        }
        else if (mode == 2)
        {
            child[stream] = open("/dev/null", O_RDWR | O_CLOEXEC);
            if (child[stream] < 0) result = djos_last_error();
        }
        // above the standard descriptors, so the dup2 calls of the child never overwrite a source still needed
        if (result == 0 && child[stream] >= 0 && child[stream] < 3)
        {
            int moved = fcntl(child[stream], F_DUPFD_CLOEXEC, 3);
            if (moved < 0) result = djos_last_error();
            else
            {
                close(child[stream]);
                child[stream] = moved;
            }
        }
    }
    if (result == 0 && djos_pipe(report) != 0) result = djos_last_error();

    if (result == 0)
    {
        char** envp = environment.items != NULL ? environment.items : empty_environment;
        pid_t pid = fork();
        if (pid == 0)
        {
            // only async-signal-safe calls between fork and exec
            for (int stream = 0; stream < 3; stream++)
                if (child[stream] >= 0 && dup2(child[stream], stream) < 0) goto failed;
            if (command->directory != NULL && chdir(command->directory) != 0) goto failed;
            execve(program, vector, envp);
        failed:;
            int code = errno;
            ssize_t ignored = write(report[1], &code, sizeof code);
            (void)ignored;
            _exit(127);
        }
        if (pid < 0) result = djos_last_error();
        else
        {
            close(report[1]);
            report[1] = -1;
            int code = 0;
            ssize_t count;
            do
            {
                count = read(report[0], &code, sizeof code);
            } while (count < 0 && errno == EINTR);
            if (count == (ssize_t)sizeof code)
            {
                waitpid(pid, NULL, 0);
                errno = code;
                result = djos_last_error();
            }
            else
            {
                process->pid = pid;
                process->id = (int64_t)pid;
                process->stdin_write = parent[0];
                process->stdout_read = parent[1];
                process->stderr_read = parent[2];
                parent[0] = parent[1] = parent[2] = -1;
            }
        }
    }

    for (int stream = 0; stream < 3; stream++)
    {
        djos_close_if_open(&child[stream]);
        djos_close_if_open(&parent[stream]);
    }
    djos_close_if_open(&report[0]);
    djos_close_if_open(&report[1]);
    djos_list_clear(&environment);
    free(vector);
    free(program);
    return result;
}
#endif

// The command is left untouched and can start more processes.
djinn_process_t* __djinn_command_start(void* handle, int64_t* failure)
{
    djos_command_t* command = (djos_command_t*)handle;
    *failure = command->failure;
    if (command->failure != 0) return NULL;
    if (command->program == NULL)
    {
        *failure = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        return NULL;
    }
    djinn_process_t* process = (djinn_process_t*)calloc(1, sizeof *process);
    if (process == NULL)
    {
        *failure = DJOS_FAIL(DJOS_OUT_OF_MEMORY);
        return NULL;
    }
    if (command->input_length > 0)
    {
        process->owned_input = djos_heap_copy(command->input, (size_t)command->input_length);
        process->stdin_data = process->owned_input;
        process->stdin_length = process->owned_input != NULL ? command->input_length : 0;
    }
    *failure = djos_spawn(command, process);
    if (*failure != 0)
    {
        free(process->owned_input);
        free(process);
        return NULL;
    }
    if (command->stream_modes[1] == 0)
        process->stdout_thread = djinn_process_pump(process, djinn_pipe_drain, &process->out, &process->stdout_read);
    if (command->stream_modes[2] == 0)
        process->stderr_thread = djinn_process_pump(process, djinn_pipe_drain, &process->err, &process->stderr_read);
    if (command->stream_modes[0] == 0)
        process->stdin_thread = djinn_process_pump(process, djinn_pipe_feed, NULL, &process->stdin_write);
    return process;
}

int64_t __djinn_process_child_id(djinn_process_t* process) { return process != NULL ? process->id : 0; }

// The signal that ended the child, 0 when it exited on its own (always 0 on Windows).
int32_t __djinn_process_signal_number(djinn_process_t* process) { return process != NULL ? process->signal : 0; }

// 0 hangup, 1 interrupt, 2 quit, 3 kill, 4 terminate, 5 user 1, 6 user 2, 7 stop, 8 continue
int64_t __djinn_process_send_signal(djinn_process_t* process, int32_t which)
{
#ifdef _WIN32
    (void)process;
    (void)which;
    return DJOS_FAIL(DJOS_UNSUPPORTED);
#else
    static const int numbers[9] = {SIGHUP, SIGINT, SIGQUIT, SIGKILL, SIGTERM, SIGUSR1, SIGUSR2, SIGSTOP, SIGCONT};
    if (which < 0 || which > 8) return DJOS_FAIL(DJOS_INVALID_ARGUMENT);
    if (process == NULL || process->finished) return DJOS_FAIL(DJOS_NOT_FOUND);
    return kill(process->pid, numbers[which]) == 0 ? 0 : djos_last_error();
#endif
}
