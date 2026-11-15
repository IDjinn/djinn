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
