// Capability-based filesystem layer behind std::filesystem.
// Every operation is relative to an open directory handle. Paths are split into components and walked one at a
// time, each opened without following links (unless the caller asks to), so a swapped component cannot redirect
// the walk outside the directory. Results are >= 0, or the negated DJFS_* code below.
// std/filesystem/error.djinn mirrors these codes; keep both in sync.

#define DJFS_NOT_FOUND 1
#define DJFS_ALREADY_EXISTS 2
#define DJFS_PERMISSION_DENIED 3
#define DJFS_NOT_A_DIRECTORY 4
#define DJFS_IS_A_DIRECTORY 5
#define DJFS_NOT_EMPTY 6
#define DJFS_INVALID_ARGUMENT 7
#define DJFS_NAME_TOO_LONG 8
#define DJFS_SYMLINK_REFUSED 9
#define DJFS_NO_SPACE 10
#define DJFS_READ_ONLY 11
#define DJFS_TOO_MANY_OPEN 12
#define DJFS_BUSY 13
#define DJFS_IO_ERROR 15
#define DJFS_CROSS_DEVICE 16
#define DJFS_UNSUPPORTED 17
#define DJFS_QUOTA 18
#define DJFS_LOOP 19
#define DJFS_BAD_HANDLE 20
#define DJFS_FILE_TOO_LARGE 21
#define DJFS_WOULD_BLOCK 22
#define DJFS_OUT_OF_MEMORY 23
#define DJFS_BROKEN_PIPE 24
#define DJFS_NOT_REGULAR_FILE 25
#define DJFS_INVALID_PATH 26
#define DJFS_PATH_ESCAPES 27
#define DJFS_ABSOLUTE_PATH 28
#define DJFS_UNKNOWN 99

#define DJFS_READ 1
#define DJFS_WRITE 2
#define DJFS_CREATE 4
#define DJFS_CREATE_NEW 8
#define DJFS_TRUNCATE 16
#define DJFS_APPEND 32
#define DJFS_FOLLOW 64

#define DJFS_MAX_PATH 4096
#define DJFS_MAX_NAME 255
#define DJFS_MAX_PARTS 2048

static int64_t djfs_parse(const char* path, int64_t length, char* buffer, char** parts, int* count)
{
    if (length < 0 || length > DJFS_MAX_PATH) return -DJFS_NAME_TOO_LONG;
    if (length > 0 && memchr(path, 0, (size_t)length) != NULL) return -DJFS_INVALID_PATH;
    memcpy(buffer, path, (size_t)length);
    buffer[length] = 0;
    if (length > 0 && buffer[0] == '/') return -DJFS_ABSOLUTE_PATH;

    int total = 0;
    char* cursor = buffer;
    char* end = buffer + length;
    while (cursor <= end)
    {
        char* next = cursor;
        while (next < end && *next != '/') next++;
        *next = 0;
        size_t size = (size_t)(next - cursor);
        if (size > DJFS_MAX_NAME) return -DJFS_NAME_TOO_LONG;
        if (size == 2 && cursor[0] == '.' && cursor[1] == '.') return -DJFS_PATH_ESCAPES;
        if (size != 0 && !(size == 1 && cursor[0] == '.'))
        {
#ifdef _WIN32
            for (char* c = cursor; c < next; c++)
            {
                unsigned char v = (unsigned char)*c;
                if (v < 32 || v == '\\' || v == ':' || v == '<' || v == '>' || v == '"' || v == '|' || v == '?' || v == '*')
                    return -DJFS_INVALID_PATH;
            }
#endif
            if (total == DJFS_MAX_PARTS) return -DJFS_NAME_TOO_LONG;
            parts[total++] = cursor;
        }
        cursor = next + 1;
    }
    *count = total;
    return 0;
}

#ifdef _WIN32

#include <winternl.h>

typedef LONG djfs_status;
typedef djfs_status(NTAPI* djfs_nt_create_fn)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK, PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
typedef djfs_status(NTAPI* djfs_nt_set_info_fn)(HANDLE, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG);
typedef djfs_status(NTAPI* djfs_nt_query_dir_fn)(HANDLE, HANDLE, PVOID, PVOID, PIO_STATUS_BLOCK, PVOID, ULONG, ULONG, BOOLEAN, PUNICODE_STRING, BOOLEAN);

typedef struct
{
    ULONG next;
    ULONG index;
    LARGE_INTEGER times[4];
    LARGE_INTEGER end_of_file;
    LARGE_INTEGER allocation;
    ULONG attributes;
    ULONG name_length;
    WCHAR name[1];
} djfs_dir_info;

typedef struct
{
    ULONG flags;
    HANDLE root;
    ULONG name_length;
    WCHAR name[1];
} djfs_rename_info;

#define DJFS_OBJ_CASE_INSENSITIVE 0x40
#define DJFS_FILE_DIRECTORY_FILE 0x1
#define DJFS_FILE_NON_DIRECTORY_FILE 0x40
#define DJFS_FILE_SYNC 0x20
#define DJFS_FILE_OPEN_REPARSE 0x00200000
#define DJFS_DISP_OPEN 1
#define DJFS_DISP_CREATE 2
#define DJFS_DISP_OPEN_IF 3
#define DJFS_DISP_OVERWRITE 4
#define DJFS_DISP_OVERWRITE_IF 5
#define DJFS_TAG_SYMLINK 0xA000000Cu
#define DJFS_TAG_MOUNT_POINT 0xA0000003u

static djfs_nt_create_fn djfs_nt_create;
static djfs_nt_set_info_fn djfs_nt_set_info;
static djfs_nt_query_dir_fn djfs_nt_query_dir;

static int djfs_load(void)
{
    if (djfs_nt_create) return 1;
    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    if (!ntdll) return 0;
    djfs_nt_set_info = (djfs_nt_set_info_fn)(void*)GetProcAddress(ntdll, "NtSetInformationFile");
    djfs_nt_query_dir = (djfs_nt_query_dir_fn)(void*)GetProcAddress(ntdll, "NtQueryDirectoryFile");
    djfs_nt_create = (djfs_nt_create_fn)(void*)GetProcAddress(ntdll, "NtCreateFile");
    return djfs_nt_create && djfs_nt_set_info && djfs_nt_query_dir;
}

static int64_t djfs_from_status(djfs_status status)
{
    switch ((unsigned long)status)
    {
    case 0xC0000034: case 0xC000003A: case 0xC0000056: return DJFS_NOT_FOUND;
    case 0xC0000035: return DJFS_ALREADY_EXISTS;
    case 0xC0000022: case 0xC0000121: return DJFS_PERMISSION_DENIED;
    case 0xC0000043: case 0xC0000054: case 0xC0000055: return DJFS_BUSY;
    case 0xC0000103: return DJFS_NOT_A_DIRECTORY;
    case 0xC00000BA: return DJFS_IS_A_DIRECTORY;
    case 0xC0000101: return DJFS_NOT_EMPTY;
    case 0xC000007F: return DJFS_NO_SPACE;
    case 0xC000000D: case 0xC0000033: case 0xC000003B: return DJFS_INVALID_ARGUMENT;
    case 0xC0000106: return DJFS_NAME_TOO_LONG;
    case 0xC00000A2: return DJFS_READ_ONLY;
    case 0xC0000017: case 0xC000009A: return DJFS_OUT_OF_MEMORY;
    case 0xC000011F: return DJFS_TOO_MANY_OPEN;
    case 0xD00000D4: return DJFS_CROSS_DEVICE;
    case 0xC00000BB: case 0xC0000003: return DJFS_UNSUPPORTED;
    case 0xC0000008: return DJFS_BAD_HANDLE;
    case 0xC00004C3: return DJFS_LOOP;
    }
    return DJFS_UNKNOWN;
}

static int64_t djfs_from_win32(DWORD error)
{
    switch (error)
    {
    case ERROR_FILE_NOT_FOUND: case ERROR_PATH_NOT_FOUND: return DJFS_NOT_FOUND;
    case ERROR_ALREADY_EXISTS: case ERROR_FILE_EXISTS: return DJFS_ALREADY_EXISTS;
    case ERROR_ACCESS_DENIED: return DJFS_PERMISSION_DENIED;
    case ERROR_SHARING_VIOLATION: case ERROR_LOCK_VIOLATION: return DJFS_BUSY;
    case ERROR_DIRECTORY: return DJFS_NOT_A_DIRECTORY;
    case ERROR_DIR_NOT_EMPTY: return DJFS_NOT_EMPTY;
    case ERROR_DISK_FULL: case ERROR_HANDLE_DISK_FULL: return DJFS_NO_SPACE;
    case ERROR_INVALID_PARAMETER: case ERROR_INVALID_NAME: return DJFS_INVALID_ARGUMENT;
    case ERROR_FILENAME_EXCED_RANGE: return DJFS_NAME_TOO_LONG;
    case ERROR_WRITE_PROTECT: return DJFS_READ_ONLY;
    case ERROR_NOT_ENOUGH_MEMORY: case ERROR_OUTOFMEMORY: return DJFS_OUT_OF_MEMORY;
    case ERROR_TOO_MANY_OPEN_FILES: return DJFS_TOO_MANY_OPEN;
    case ERROR_NOT_SAME_DEVICE: return DJFS_CROSS_DEVICE;
    case ERROR_INVALID_HANDLE: return DJFS_BAD_HANDLE;
    case ERROR_FILE_TOO_LARGE: return DJFS_FILE_TOO_LARGE;
    case ERROR_BROKEN_PIPE: return DJFS_BROKEN_PIPE;
    case ERROR_NOT_SUPPORTED: return DJFS_UNSUPPORTED;
    case ERROR_CANT_RESOLVE_FILENAME: return DJFS_LOOP;
    }
    return DJFS_IO_ERROR;
}

static djfs_status djfs_open_nt(HANDLE root, const char* name, ACCESS_MASK access, ULONG disposition, ULONG options, HANDLE* out)
{
    WCHAR wide[DJFS_MAX_NAME + 1];
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, name, -1, wide, DJFS_MAX_NAME + 1);
    if (count <= 1) return (djfs_status)0xC0000033;
    UNICODE_STRING text;
    text.Length = (USHORT)((count - 1) * 2);
    text.MaximumLength = (USHORT)(count * 2);
    text.Buffer = wide;
    OBJECT_ATTRIBUTES attributes;
    InitializeObjectAttributes(&attributes, &text, DJFS_OBJ_CASE_INSENSITIVE, root, NULL);
    IO_STATUS_BLOCK status_block;
    return djfs_nt_create(out, access | SYNCHRONIZE | FILE_READ_ATTRIBUTES, &attributes, &status_block, NULL, FILE_ATTRIBUTE_NORMAL,
                          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, disposition, options | DJFS_FILE_SYNC, NULL, 0);
}

static int djfs_is_link(HANDLE handle)
{
    FILE_ATTRIBUTE_TAG_INFO info;
    if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &info, sizeof(info))) return 0;
    if (!(info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return 0;
    return info.ReparseTag == DJFS_TAG_SYMLINK || info.ReparseTag == DJFS_TAG_MOUNT_POINT;
}

typedef struct
{
    HANDLE parent;
    int owned;
    const char* leaf;
    char buffer[DJFS_MAX_PATH + 1];
} djfs_loc;

static void djfs_release(djfs_loc* loc)
{
    if (loc->owned) CloseHandle(loc->parent);
    loc->owned = 0;
}

static ULONG djfs_link_option(int follow)
{
    return follow ? 0 : DJFS_FILE_OPEN_REPARSE;
}

static int64_t djfs_locate(int64_t dir, const char* path, int64_t length, int follow, djfs_loc* loc)
{
    if (!djfs_load()) return -DJFS_UNSUPPORTED;
    char* parts[DJFS_MAX_PARTS];
    int count = 0;
    int64_t result = djfs_parse(path, length, loc->buffer, parts, &count);
    if (result < 0) return result;

    loc->parent = (HANDLE)(intptr_t)dir;
    loc->owned = 0;
    loc->leaf = NULL;
    for (int i = 0; i < count; i++)
    {
        if (i == count - 1)
        {
            loc->leaf = parts[i];
            break;
        }
        HANDLE next = NULL;
        djfs_status status = djfs_open_nt(loc->parent, parts[i], FILE_LIST_DIRECTORY | FILE_TRAVERSE, DJFS_DISP_OPEN,
                                          DJFS_FILE_DIRECTORY_FILE | djfs_link_option(follow), &next);
        if (status < 0)
        {
            djfs_release(loc);
            return -djfs_from_status(status);
        }
        if (!follow && djfs_is_link(next))
        {
            CloseHandle(next);
            djfs_release(loc);
            return -DJFS_SYMLINK_REFUSED;
        }
        djfs_release(loc);
        loc->parent = next;
        loc->owned = 1;
    }
    return 0;
}

static int64_t djfs_open_checked(djfs_loc* loc, ACCESS_MASK access, ULONG disposition, ULONG options, int follow, HANDLE* out)
{
    djfs_status status = djfs_open_nt(loc->parent, loc->leaf, access, disposition, options | djfs_link_option(follow), out);
    if (status < 0) return -djfs_from_status(status);
    if (!follow && djfs_is_link(*out))
    {
        CloseHandle(*out);
        return -DJFS_SYMLINK_REFUSED;
    }
    return 0;
}

#define DJFS_DIR_ACCESS (FILE_LIST_DIRECTORY | FILE_TRAVERSE)

int64_t __djinn_fs_open_root(const char* path, int64_t length, int32_t flags)
{
    if (length <= 0 || length > DJFS_MAX_PATH) return -DJFS_INVALID_PATH;
    if (memchr(path, 0, (size_t)length) != NULL) return -DJFS_INVALID_PATH;
    WCHAR wide[DJFS_MAX_PATH + 1];
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, (int)length, wide, DJFS_MAX_PATH);
    if (count <= 0) return -DJFS_INVALID_PATH;
    wide[count] = 0;
    for (int i = 0; i < count; i++)
        if (wide[i] == L'/') wide[i] = L'\\';

    WCHAR full[DJFS_MAX_PATH + 8];
    DWORD size = GetFullPathNameW(wide, DJFS_MAX_PATH, full + 4, NULL);
    if (size == 0 || size >= DJFS_MAX_PATH) return -DJFS_INVALID_PATH;
    WCHAR* target = full + 4;
    if (target[0] != L'\\' && target[1] == L':')
    {
        full[0] = L'\\'; full[1] = L'\\'; full[2] = L'?'; full[3] = L'\\';
        target = full;
    }
    int follow = (flags & DJFS_FOLLOW) != 0;
    HANDLE handle = CreateFileW(target, DJFS_DIR_ACCESS | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
                                FILE_FLAG_BACKUP_SEMANTICS | (follow ? 0 : FILE_FLAG_OPEN_REPARSE_POINT), NULL);
    if (handle == INVALID_HANDLE_VALUE) return -djfs_from_win32(GetLastError());
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(handle, &info) || !(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
    {
        CloseHandle(handle);
        return -DJFS_NOT_A_DIRECTORY;
    }
    if (!follow && djfs_is_link(handle))
    {
        CloseHandle(handle);
        return -DJFS_SYMLINK_REFUSED;
    }
    return (int64_t)(intptr_t)handle;
}

int64_t __djinn_fs_open_dir(int64_t dir, const char* path, int64_t length, int32_t flags)
{
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        HANDLE copy;
        if (!DuplicateHandle(GetCurrentProcess(), loc.parent, GetCurrentProcess(), &copy, 0, FALSE, DUPLICATE_SAME_ACCESS))
            result = -djfs_from_win32(GetLastError());
        else
            result = (int64_t)(intptr_t)copy;
        djfs_release(&loc);
        return result;
    }
    HANDLE handle = NULL;
    result = djfs_open_checked(&loc, DJFS_DIR_ACCESS, DJFS_DISP_OPEN, DJFS_FILE_DIRECTORY_FILE, follow, &handle);
    djfs_release(&loc);
    return result < 0 ? result : (int64_t)(intptr_t)handle;
}

int64_t __djinn_fs_open_file(int64_t dir, const char* path, int64_t length, int32_t flags, int32_t mode)
{
    (void)mode;
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_IS_A_DIRECTORY;
    }

    ACCESS_MASK access = 0;
    if (flags & DJFS_READ) access |= FILE_GENERIC_READ;
    if (flags & DJFS_WRITE) access |= (flags & DJFS_APPEND) ? (FILE_GENERIC_WRITE & ~FILE_WRITE_DATA) : FILE_GENERIC_WRITE;
    if ((flags & DJFS_TRUNCATE) && !(flags & DJFS_APPEND)) access |= FILE_WRITE_DATA;
    ULONG disposition = DJFS_DISP_OPEN;
    if (flags & DJFS_CREATE_NEW) disposition = DJFS_DISP_CREATE;
    else if ((flags & DJFS_CREATE) && (flags & DJFS_TRUNCATE)) disposition = DJFS_DISP_OVERWRITE_IF;
    else if (flags & DJFS_CREATE) disposition = DJFS_DISP_OPEN_IF;
    else if (flags & DJFS_TRUNCATE) disposition = DJFS_DISP_OVERWRITE;

    HANDLE handle = NULL;
    result = djfs_open_checked(&loc, access, disposition, DJFS_FILE_NON_DIRECTORY_FILE, follow, &handle);
    djfs_release(&loc);
    if (result < 0) return result;
    if (GetFileType(handle) != FILE_TYPE_DISK)
    {
        CloseHandle(handle);
        return -DJFS_NOT_REGULAR_FILE;
    }
    return (int64_t)(intptr_t)handle;
}

int64_t __djinn_fs_close(int64_t handle)
{
    return CloseHandle((HANDLE)(intptr_t)handle) ? 0 : -djfs_from_win32(GetLastError());
}

int64_t __djinn_fs_read(int64_t handle, void* buffer, int64_t count)
{
    if (count < 0) return -DJFS_INVALID_ARGUMENT;
    if (count > 0x40000000) count = 0x40000000;
    DWORD done = 0;
    if (!ReadFile((HANDLE)(intptr_t)handle, buffer, (DWORD)count, &done, NULL))
    {
        DWORD error = GetLastError();
        if (error == ERROR_HANDLE_EOF || error == ERROR_BROKEN_PIPE) return 0;
        return -djfs_from_win32(error);
    }
    return done;
}

int64_t __djinn_fs_write(int64_t handle, const void* buffer, int64_t count)
{
    if (count < 0) return -DJFS_INVALID_ARGUMENT;
    if (count > 0x40000000) count = 0x40000000;
    DWORD done = 0;
    if (!WriteFile((HANDLE)(intptr_t)handle, buffer, (DWORD)count, &done, NULL)) return -djfs_from_win32(GetLastError());
    return done;
}

int64_t __djinn_fs_seek(int64_t handle, int64_t offset, int32_t whence)
{
    if (whence < 0 || whence > 2) return -DJFS_INVALID_ARGUMENT;
    LARGE_INTEGER distance, result;
    distance.QuadPart = offset;
    if (!SetFilePointerEx((HANDLE)(intptr_t)handle, distance, &result, (DWORD)whence)) return -djfs_from_win32(GetLastError());
    return result.QuadPart;
}

int64_t __djinn_fs_truncate(int64_t handle, int64_t length)
{
    FILE_END_OF_FILE_INFO info;
    info.EndOfFile.QuadPart = length;
    if (length < 0) return -DJFS_INVALID_ARGUMENT;
    if (!SetFileInformationByHandle((HANDLE)(intptr_t)handle, FileEndOfFileInfo, &info, sizeof(info))) return -djfs_from_win32(GetLastError());
    return 0;
}

int64_t __djinn_fs_sync(int64_t handle)
{
    if (!FlushFileBuffers((HANDLE)(intptr_t)handle))
    {
        DWORD error = GetLastError();
        if (error == ERROR_ACCESS_DENIED || error == ERROR_INVALID_FUNCTION) return 0;
        return -djfs_from_win32(error);
    }
    return 0;
}

static int64_t djfs_filetime_ns(FILETIME time)
{
    int64_t ticks = ((int64_t)time.dwHighDateTime << 32) | time.dwLowDateTime;
    return (ticks - 116444736000000000LL) * 100;
}

int64_t __djinn_fs_fstat(int64_t handle, int64_t* out)
{
    BY_HANDLE_FILE_INFORMATION info;
    HANDLE native = (HANDLE)(intptr_t)handle;
    if (!GetFileInformationByHandle(native, &info)) return -djfs_from_win32(GetLastError());
    int64_t kind = 0;
    if (djfs_is_link(native)) kind = 2;
    else if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) kind = 1;
    else if (GetFileType(native) != FILE_TYPE_DISK) kind = 3;
    out[0] = kind;
    out[1] = ((int64_t)info.nFileSizeHigh << 32) | info.nFileSizeLow;
    out[2] = djfs_filetime_ns(info.ftLastWriteTime);
    out[3] = (info.dwFileAttributes & FILE_ATTRIBUTE_READONLY) ? 0444 : 0666;
    return 0;
}

int64_t __djinn_fs_stat(int64_t dir, const char* path, int64_t length, int32_t flags, int64_t* out)
{
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        result = __djinn_fs_fstat((int64_t)(intptr_t)loc.parent, out);
        djfs_release(&loc);
        return result;
    }
    HANDLE handle = NULL;
    djfs_status status = djfs_open_nt(loc.parent, loc.leaf, 0, DJFS_DISP_OPEN, djfs_link_option(follow), &handle);
    djfs_release(&loc);
    if (status < 0) return -djfs_from_status(status);
    result = __djinn_fs_fstat((int64_t)(intptr_t)handle, out);
    CloseHandle(handle);
    return result;
}

int64_t __djinn_fs_mkdir(int64_t dir, const char* path, int64_t length, int32_t mode)
{
    (void)mode;
    djfs_loc loc;
    int64_t result = djfs_locate(dir, path, length, 0, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_ALREADY_EXISTS;
    }
    HANDLE handle = NULL;
    djfs_status status = djfs_open_nt(loc.parent, loc.leaf, FILE_LIST_DIRECTORY, DJFS_DISP_CREATE, DJFS_FILE_DIRECTORY_FILE, &handle);
    djfs_release(&loc);
    if (status < 0) return -djfs_from_status(status);
    CloseHandle(handle);
    return 0;
}

int64_t __djinn_fs_remove(int64_t dir, const char* path, int64_t length, int32_t is_directory)
{
    djfs_loc loc;
    int64_t result = djfs_locate(dir, path, length, 0, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_INVALID_ARGUMENT;
    }
    HANDLE handle = NULL;
    ULONG kind = is_directory ? DJFS_FILE_DIRECTORY_FILE : DJFS_FILE_NON_DIRECTORY_FILE;
    djfs_status status = djfs_open_nt(loc.parent, loc.leaf, DELETE, DJFS_DISP_OPEN, kind | DJFS_FILE_OPEN_REPARSE, &handle);
    djfs_release(&loc);
    if (status < 0) return -djfs_from_status(status);

    IO_STATUS_BLOCK status_block;
    ULONG posix_delete = 0x3;
    status = djfs_nt_set_info(handle, &status_block, &posix_delete, sizeof(posix_delete), 64);
    if (status < 0 && (unsigned long)status != 0xC0000101)
    {
        BOOLEAN classic = TRUE;
        status = djfs_nt_set_info(handle, &status_block, &classic, sizeof(classic), 13);
    }
    CloseHandle(handle);
    return status < 0 ? -djfs_from_status(status) : 0;
}

int64_t __djinn_fs_rename(int64_t from_dir, const char* from, int64_t from_length, int64_t to_dir, const char* to, int64_t to_length, int32_t replace)
{
    djfs_loc source, target;
    int64_t result = djfs_locate(from_dir, from, from_length, 0, &source);
    if (result < 0) return result;
    result = djfs_locate(to_dir, to, to_length, 0, &target);
    if (result < 0)
    {
        djfs_release(&source);
        return result;
    }
    if (source.leaf == NULL || target.leaf == NULL)
    {
        djfs_release(&source);
        djfs_release(&target);
        return -DJFS_INVALID_ARGUMENT;
    }

    HANDLE handle = NULL;
    djfs_status status = djfs_open_nt(source.parent, source.leaf, DELETE, DJFS_DISP_OPEN, DJFS_FILE_OPEN_REPARSE, &handle);
    djfs_release(&source);
    if (status < 0)
    {
        djfs_release(&target);
        return -djfs_from_status(status);
    }

    WCHAR wide[DJFS_MAX_NAME + 1];
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, target.leaf, -1, wide, DJFS_MAX_NAME + 1);
    if (count <= 1)
    {
        CloseHandle(handle);
        djfs_release(&target);
        return -DJFS_INVALID_PATH;
    }
    size_t name_bytes = (size_t)(count - 1) * sizeof(WCHAR);
    size_t size = sizeof(djfs_rename_info) + name_bytes;
    djfs_rename_info* info = (djfs_rename_info*)calloc(1, size);
    if (!info)
    {
        CloseHandle(handle);
        djfs_release(&target);
        return -DJFS_OUT_OF_MEMORY;
    }
    info->flags = replace ? 0x3 : 0x2;
    info->root = target.parent;
    info->name_length = (ULONG)name_bytes;
    memcpy(info->name, wide, name_bytes);

    IO_STATUS_BLOCK status_block;
    status = djfs_nt_set_info(handle, &status_block, info, (ULONG)size, 65);
    if (status < 0 && ((unsigned long)status == 0xC0000003 || (unsigned long)status == 0xC0000002 || (unsigned long)status == 0xC000000D))
    {
        info->flags = replace ? 1 : 0;
        status = djfs_nt_set_info(handle, &status_block, info, (ULONG)size, 10);
    }
    free(info);
    CloseHandle(handle);
    djfs_release(&target);
    return status < 0 ? -djfs_from_status(status) : 0;
}

typedef struct
{
    char* data;
    size_t length;
    size_t capacity;
    size_t position;
} djfs_list;

static int djfs_list_push(djfs_list* list, int kind, const char* name, size_t size)
{
    size_t need = list->length + size + 2;
    if (need > list->capacity)
    {
        size_t capacity = list->capacity ? list->capacity : 256;
        while (capacity < need) capacity *= 2;
        char* grown = (char*)realloc(list->data, capacity);
        if (!grown) return 0;
        list->data = grown;
        list->capacity = capacity;
    }
    list->data[list->length++] = (char)kind;
    memcpy(list->data + list->length, name, size);
    list->length += size;
    list->data[list->length++] = 0;
    return 1;
}

int64_t __djinn_fs_list_open(int64_t dir)
{
    if (!djfs_load()) return -DJFS_UNSUPPORTED;
    djfs_list* list = (djfs_list*)calloc(1, sizeof(djfs_list));
    if (!list) return -DJFS_OUT_OF_MEMORY;
    size_t buffer_size = 65536;
    char* buffer = (char*)malloc(buffer_size);
    if (!buffer)
    {
        free(list);
        return -DJFS_OUT_OF_MEMORY;
    }
    BOOLEAN restart = TRUE;
    int64_t failure = 0;
    for (;;)
    {
        IO_STATUS_BLOCK status_block;
        djfs_status status = djfs_nt_query_dir((HANDLE)(intptr_t)dir, NULL, NULL, NULL, &status_block, buffer, (ULONG)buffer_size, 1, FALSE, NULL, restart);
        restart = FALSE;
        if ((unsigned long)status == 0x80000006) break;
        if (status < 0)
        {
            failure = -djfs_from_status(status);
            break;
        }
        djfs_dir_info* entry = (djfs_dir_info*)buffer;
        for (;;)
        {
            int units = (int)(entry->name_length / sizeof(WCHAR));
            int dots = (units == 1 && entry->name[0] == L'.') || (units == 2 && entry->name[0] == L'.' && entry->name[1] == L'.');
            if (!dots)
            {
                char name[DJFS_MAX_NAME * 4 + 4];
                int size = WideCharToMultiByte(CP_UTF8, 0, entry->name, units, name, (int)sizeof(name), NULL, NULL);
                int kind = (entry->attributes & FILE_ATTRIBUTE_REPARSE_POINT) ? 2 : (entry->attributes & FILE_ATTRIBUTE_DIRECTORY) ? 1 : 0;
                if (size > 0 && !djfs_list_push(list, kind, name, (size_t)size))
                {
                    failure = -DJFS_OUT_OF_MEMORY;
                    break;
                }
            }
            if (entry->next == 0) break;
            entry = (djfs_dir_info*)((char*)entry + entry->next);
        }
        if (failure) break;
    }
    free(buffer);
    if (failure)
    {
        free(list->data);
        free(list);
        return failure;
    }
    return (int64_t)(intptr_t)list;
}

#else

#include <fcntl.h>
#include <dirent.h>
#include <sys/stat.h>
#include <sys/types.h>

#ifndef O_CLOEXEC
#define O_CLOEXEC 0
#endif
#ifndef O_DIRECTORY
#define O_DIRECTORY 0
#endif
#ifndef O_NOFOLLOW
#define O_NOFOLLOW 0
#endif

static int64_t djfs_from_errno(int error)
{
    switch (error)
    {
    case ENOENT: return DJFS_NOT_FOUND;
    case EEXIST: return DJFS_ALREADY_EXISTS;
    case EACCES: case EPERM: return DJFS_PERMISSION_DENIED;
    case ENOTDIR: return DJFS_NOT_A_DIRECTORY;
    case EISDIR: return DJFS_IS_A_DIRECTORY;
    case ENOTEMPTY: return DJFS_NOT_EMPTY;
    case EINVAL: return DJFS_INVALID_ARGUMENT;
    case ENAMETOOLONG: return DJFS_NAME_TOO_LONG;
    case ELOOP: return DJFS_SYMLINK_REFUSED;
#ifdef EMLINK
    case EMLINK: return DJFS_SYMLINK_REFUSED;
#endif
    case ENOSPC: return DJFS_NO_SPACE;
    case EROFS: return DJFS_READ_ONLY;
    case EMFILE: case ENFILE: return DJFS_TOO_MANY_OPEN;
    case EBUSY: case ETXTBSY: return DJFS_BUSY;
    case EIO: return DJFS_IO_ERROR;
    case EXDEV: return DJFS_CROSS_DEVICE;
    case ENOSYS: case ENOTSUP: return DJFS_UNSUPPORTED;
#ifdef EDQUOT
    case EDQUOT: return DJFS_QUOTA;
#endif
    case EBADF: return DJFS_BAD_HANDLE;
    case EFBIG: return DJFS_FILE_TOO_LARGE;
    case EAGAIN: return DJFS_WOULD_BLOCK;
    case ENOMEM: return DJFS_OUT_OF_MEMORY;
    case EPIPE: return DJFS_BROKEN_PIPE;
    }
    return DJFS_UNKNOWN;
}

typedef struct
{
    int parent;
    int owned;
    const char* leaf;
    char buffer[DJFS_MAX_PATH + 1];
} djfs_loc;

static void djfs_release(djfs_loc* loc)
{
    if (loc->owned) close(loc->parent);
    loc->owned = 0;
}

static int djfs_link_flag(int follow)
{
    return follow ? 0 : O_NOFOLLOW;
}

static int djfs_open_dir_at(int parent, const char* name, int follow)
{
    int handle = openat(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | djfs_link_flag(follow));
    if (handle >= 0 || follow || errno != ENOTDIR) return handle;
    struct stat info;
    if (fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) == 0 && S_ISLNK(info.st_mode)) errno = ELOOP;
    else errno = ENOTDIR;
    return -1;
}

static int64_t djfs_locate(int64_t dir, const char* path, int64_t length, int follow, djfs_loc* loc)
{
    char* parts[DJFS_MAX_PARTS];
    int count = 0;
    int64_t result = djfs_parse(path, length, loc->buffer, parts, &count);
    if (result < 0) return result;

    loc->parent = (int)dir;
    loc->owned = 0;
    loc->leaf = NULL;
    for (int i = 0; i < count; i++)
    {
        if (i == count - 1)
        {
            loc->leaf = parts[i];
            break;
        }
        int next = djfs_open_dir_at(loc->parent, parts[i], follow);
        if (next < 0)
        {
            int error = errno;
            djfs_release(loc);
            return -djfs_from_errno(error);
        }
        djfs_release(loc);
        loc->parent = next;
        loc->owned = 1;
    }
    return 0;
}

int64_t __djinn_fs_open_root(const char* path, int64_t length, int32_t flags)
{
    if (length <= 0 || length > DJFS_MAX_PATH) return -DJFS_INVALID_PATH;
    if (memchr(path, 0, (size_t)length) != NULL) return -DJFS_INVALID_PATH;
    char buffer[DJFS_MAX_PATH + 1];
    memcpy(buffer, path, (size_t)length);
    buffer[length] = 0;
    int handle = open(buffer, O_RDONLY | O_DIRECTORY | O_CLOEXEC | djfs_link_flag((flags & DJFS_FOLLOW) != 0));
    return handle < 0 ? -djfs_from_errno(errno) : handle;
}

int64_t __djinn_fs_open_dir(int64_t dir, const char* path, int64_t length, int32_t flags)
{
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    int handle = loc.leaf == NULL
        ? fcntl(loc.parent, F_DUPFD_CLOEXEC, 0)
        : djfs_open_dir_at(loc.parent, loc.leaf, follow);
    int error = errno;
    djfs_release(&loc);
    return handle < 0 ? -djfs_from_errno(error) : handle;
}

int64_t __djinn_fs_open_file(int64_t dir, const char* path, int64_t length, int32_t flags, int32_t mode)
{
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_IS_A_DIRECTORY;
    }

    int access = O_RDONLY;
    if ((flags & DJFS_READ) && (flags & DJFS_WRITE)) access = O_RDWR;
    else if (flags & DJFS_WRITE) access = O_WRONLY;
    int open_flags = access | O_CLOEXEC | O_NONBLOCK | djfs_link_flag(follow);
#ifdef O_NOCTTY
    open_flags |= O_NOCTTY;
#endif
    if (flags & DJFS_CREATE_NEW) open_flags |= O_CREAT | O_EXCL;
    else if (flags & DJFS_CREATE) open_flags |= O_CREAT;
    if (flags & DJFS_TRUNCATE) open_flags |= O_TRUNC;
    if (flags & DJFS_APPEND) open_flags |= O_APPEND;

    int handle = openat(loc.parent, loc.leaf, open_flags, (mode_t)mode);
    int error = errno;
    djfs_release(&loc);
    if (handle < 0) return -djfs_from_errno(error);

    struct stat info;
    if (fstat(handle, &info) != 0)
    {
        error = errno;
        close(handle);
        return -djfs_from_errno(error);
    }
    if (!S_ISREG(info.st_mode))
    {
        close(handle);
        return S_ISDIR(info.st_mode) ? -DJFS_IS_A_DIRECTORY : -DJFS_NOT_REGULAR_FILE;
    }
    int status_flags = fcntl(handle, F_GETFL);
    if (status_flags >= 0) fcntl(handle, F_SETFL, status_flags & ~O_NONBLOCK);
    return handle;
}

int64_t __djinn_fs_close(int64_t handle)
{
    return close((int)handle) == 0 ? 0 : -djfs_from_errno(errno);
}

int64_t __djinn_fs_read(int64_t handle, void* buffer, int64_t count)
{
    if (count < 0) return -DJFS_INVALID_ARGUMENT;
    for (;;)
    {
        ssize_t done = read((int)handle, buffer, (size_t)count);
        if (done >= 0) return done;
        if (errno != EINTR) return -djfs_from_errno(errno);
    }
}

int64_t __djinn_fs_write(int64_t handle, const void* buffer, int64_t count)
{
    if (count < 0) return -DJFS_INVALID_ARGUMENT;
    for (;;)
    {
        ssize_t done = write((int)handle, buffer, (size_t)count);
        if (done >= 0) return done;
        if (errno != EINTR) return -djfs_from_errno(errno);
    }
}

int64_t __djinn_fs_seek(int64_t handle, int64_t offset, int32_t whence)
{
    if (whence < 0 || whence > 2) return -DJFS_INVALID_ARGUMENT;
    off_t result = lseek((int)handle, (off_t)offset, whence);
    return result < 0 ? -djfs_from_errno(errno) : (int64_t)result;
}

int64_t __djinn_fs_truncate(int64_t handle, int64_t length)
{
    if (length < 0) return -DJFS_INVALID_ARGUMENT;
    return ftruncate((int)handle, (off_t)length) == 0 ? 0 : -djfs_from_errno(errno);
}

int64_t __djinn_fs_sync(int64_t handle)
{
    for (;;)
    {
        if (fsync((int)handle) == 0) return 0;
        if (errno == EINTR) continue;
        if (errno == EINVAL || errno == EROFS) return 0;
        return -djfs_from_errno(errno);
    }
}

static void djfs_fill_stat(const struct stat* info, int64_t* out)
{
    int64_t kind = 3;
    if (S_ISREG(info->st_mode)) kind = 0;
    else if (S_ISDIR(info->st_mode)) kind = 1;
    else if (S_ISLNK(info->st_mode)) kind = 2;
    out[0] = kind;
    out[1] = (int64_t)info->st_size;
#ifdef __APPLE__
    out[2] = (int64_t)info->st_mtimespec.tv_sec * 1000000000LL + info->st_mtimespec.tv_nsec;
#else
    out[2] = (int64_t)info->st_mtim.tv_sec * 1000000000LL + info->st_mtim.tv_nsec;
#endif
    out[3] = (int64_t)(info->st_mode & 07777);
}

int64_t __djinn_fs_fstat(int64_t handle, int64_t* out)
{
    struct stat info;
    if (fstat((int)handle, &info) != 0) return -djfs_from_errno(errno);
    djfs_fill_stat(&info, out);
    return 0;
}

int64_t __djinn_fs_stat(int64_t dir, const char* path, int64_t length, int32_t flags, int64_t* out)
{
    djfs_loc loc;
    int follow = (flags & DJFS_FOLLOW) != 0;
    int64_t result = djfs_locate(dir, path, length, follow, &loc);
    if (result < 0) return result;
    struct stat info;
    int status = loc.leaf == NULL ? fstat(loc.parent, &info) : fstatat(loc.parent, loc.leaf, &info, follow ? 0 : AT_SYMLINK_NOFOLLOW);
    int error = errno;
    djfs_release(&loc);
    if (status != 0) return -djfs_from_errno(error);
    djfs_fill_stat(&info, out);
    return 0;
}

int64_t __djinn_fs_mkdir(int64_t dir, const char* path, int64_t length, int32_t mode)
{
    djfs_loc loc;
    int64_t result = djfs_locate(dir, path, length, 0, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_ALREADY_EXISTS;
    }
    int status = mkdirat(loc.parent, loc.leaf, (mode_t)mode);
    int error = errno;
    djfs_release(&loc);
    return status == 0 ? 0 : -djfs_from_errno(error);
}

int64_t __djinn_fs_remove(int64_t dir, const char* path, int64_t length, int32_t is_directory)
{
    djfs_loc loc;
    int64_t result = djfs_locate(dir, path, length, 0, &loc);
    if (result < 0) return result;
    if (loc.leaf == NULL)
    {
        djfs_release(&loc);
        return -DJFS_INVALID_ARGUMENT;
    }
    int status = unlinkat(loc.parent, loc.leaf, is_directory ? AT_REMOVEDIR : 0);
    int error = errno;
    djfs_release(&loc);
    if (status == 0) return 0;
    if (!is_directory && error == EPERM) error = EISDIR;
    return -djfs_from_errno(error);
}

int64_t __djinn_fs_rename(int64_t from_dir, const char* from, int64_t from_length, int64_t to_dir, const char* to, int64_t to_length, int32_t replace)
{
    djfs_loc source, target;
    int64_t result = djfs_locate(from_dir, from, from_length, 0, &source);
    if (result < 0) return result;
    result = djfs_locate(to_dir, to, to_length, 0, &target);
    if (result < 0)
    {
        djfs_release(&source);
        return result;
    }
    int status = -1;
    int error = EINVAL;
    if (source.leaf != NULL && target.leaf != NULL)
    {
        if (replace)
        {
            status = renameat(source.parent, source.leaf, target.parent, target.leaf);
        }
        else
        {
#if defined(__linux__) && defined(RENAME_NOREPLACE)
            status = renameat2(source.parent, source.leaf, target.parent, target.leaf, RENAME_NOREPLACE);
#else
            status = linkat(source.parent, source.leaf, target.parent, target.leaf, 0);
            if (status == 0) status = unlinkat(source.parent, source.leaf, 0);
#endif
        }
        error = errno;
    }
    djfs_release(&source);
    djfs_release(&target);
    return status == 0 ? 0 : -djfs_from_errno(error);
}

typedef struct
{
    char* data;
    size_t length;
    size_t capacity;
    size_t position;
} djfs_list;

static int djfs_list_push(djfs_list* list, int kind, const char* name, size_t size)
{
    size_t need = list->length + size + 2;
    if (need > list->capacity)
    {
        size_t capacity = list->capacity ? list->capacity : 256;
        while (capacity < need) capacity *= 2;
        char* grown = (char*)realloc(list->data, capacity);
        if (!grown) return 0;
        list->data = grown;
        list->capacity = capacity;
    }
    list->data[list->length++] = (char)kind;
    memcpy(list->data + list->length, name, size);
    list->length += size;
    list->data[list->length++] = 0;
    return 1;
}

int64_t __djinn_fs_list_open(int64_t dir)
{
    int copy = fcntl((int)dir, F_DUPFD_CLOEXEC, 0);
    if (copy < 0) return -djfs_from_errno(errno);
    DIR* stream = fdopendir(copy);
    if (!stream)
    {
        int error = errno;
        close(copy);
        return -djfs_from_errno(error);
    }
    rewinddir(stream);
    djfs_list* list = (djfs_list*)calloc(1, sizeof(djfs_list));
    if (!list)
    {
        closedir(stream);
        return -DJFS_OUT_OF_MEMORY;
    }
    int64_t failure = 0;
    struct dirent* entry;
    errno = 0;
    while ((entry = readdir(stream)) != NULL)
    {
        const char* name = entry->d_name;
        if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) continue;
        int kind = 3;
#ifdef DT_DIR
        if (entry->d_type == DT_REG) kind = 0;
        else if (entry->d_type == DT_DIR) kind = 1;
        else if (entry->d_type == DT_LNK) kind = 2;
        else if (entry->d_type == DT_UNKNOWN)
#endif
        {
            struct stat info;
            if (fstatat(dirfd(stream), name, &info, AT_SYMLINK_NOFOLLOW) == 0)
            {
                int64_t scratch[4];
                djfs_fill_stat(&info, scratch);
                kind = (int)scratch[0];
            }
        }
        if (!djfs_list_push(list, kind, name, strlen(name)))
        {
            failure = -DJFS_OUT_OF_MEMORY;
            break;
        }
    }
    if (!failure && errno != 0) failure = -djfs_from_errno(errno);
    closedir(stream);
    if (failure)
    {
        free(list->data);
        free(list);
        return failure;
    }
    return (int64_t)(intptr_t)list;
}

#endif

typedef struct
{
    const char* name;
    int32_t length;
    int32_t kind;
} djfs_cursor;

int64_t __djinn_fs_list_next(int64_t handle, djfs_cursor* cursor)
{
    djfs_list* list = (djfs_list*)(intptr_t)handle;
    if (list->position >= list->length) return 0;
    cursor->kind = (unsigned char)list->data[list->position];
    const char* start = list->data + list->position + 1;
    size_t size = strlen(start);
    cursor->name = start;
    cursor->length = (int32_t)size;
    list->position += size + 2;
    return 1;
}

void __djinn_fs_list_free(int64_t handle)
{
    djfs_list* list = (djfs_list*)(intptr_t)handle;
    if (!list) return;
    free(list->data);
    free(list);
}

int64_t __djinn_fs_temp_name(const char* leaf, int64_t leaf_length, char* out, int64_t capacity)
{
    static volatile uint64_t counter = 0;
    if (leaf_length < 0 || leaf_length > 200 || capacity < leaf_length + 48) return -DJFS_NAME_TOO_LONG;
    uint64_t mix = (uint64_t)time(NULL) * 0x9e3779b97f4a7c15ULL;
    mix ^= (uint64_t)(uintptr_t)&mix;
    mix ^= (uint64_t)clock() << 20;
    mix += __atomic_fetch_add(&counter, 1, __ATOMIC_RELAXED) * 0xbf58476d1ce4e5b9ULL;
    mix ^= mix >> 31;
    mix *= 0x94d049bb133111ebULL;
    mix ^= mix >> 29;
    int written = snprintf(out, (size_t)capacity, ".%.*s.%016llx.tmp", (int)leaf_length, leaf, (unsigned long long)mix);
    return written < 0 ? -DJFS_INVALID_ARGUMENT : written;
}

// Asynchronous submission. A request runs the blocking call above on a small worker pool. The submitting coroutine is
// marked as waiting and suspends; the worker puts it back on the ready queue when the call returns, so the scheduler
// never blocks on the disk and never polls for it.

void __djinn_mark_waiting(void* handle);

#define DJFS_OP_OPEN_ROOT 1
#define DJFS_OP_OPEN_DIR 2
#define DJFS_OP_OPEN_FILE 3
#define DJFS_OP_CLOSE 4
#define DJFS_OP_READ 5
#define DJFS_OP_WRITE 6
#define DJFS_OP_SEEK 7
#define DJFS_OP_TRUNCATE 8
#define DJFS_OP_SYNC 9
#define DJFS_OP_FSTAT 10
#define DJFS_OP_STAT 11
#define DJFS_OP_MKDIR 12
#define DJFS_OP_REMOVE 13
#define DJFS_OP_RENAME 14
#define DJFS_OP_LIST_OPEN 15

#define DJFS_WORKERS 4
#define DJFS_SPIN 2000

typedef struct djfs_request
{
    int32_t op;
    int64_t args[7];
    int64_t result;
    volatile int32_t done;
    void* coro;
    struct djfs_request* next;
} djfs_request;

static djfs_request* volatile djfs_queue_head;
static djfs_request* volatile djfs_queue_tail;

static int64_t djfs_execute(const djfs_request* request)
{
    const int64_t* a = request->args;
    switch (request->op)
    {
    case DJFS_OP_OPEN_ROOT: return __djinn_fs_open_root((const char*)(intptr_t)a[0], a[1], (int32_t)a[2]);
    case DJFS_OP_OPEN_DIR: return __djinn_fs_open_dir(a[0], (const char*)(intptr_t)a[1], a[2], (int32_t)a[3]);
    case DJFS_OP_OPEN_FILE: return __djinn_fs_open_file(a[0], (const char*)(intptr_t)a[1], a[2], (int32_t)a[3], (int32_t)a[4]);
    case DJFS_OP_CLOSE: return __djinn_fs_close(a[0]);
    case DJFS_OP_READ: return __djinn_fs_read(a[0], (void*)(intptr_t)a[1], a[2]);
    case DJFS_OP_WRITE: return __djinn_fs_write(a[0], (const void*)(intptr_t)a[1], a[2]);
    case DJFS_OP_SEEK: return __djinn_fs_seek(a[0], a[1], (int32_t)a[2]);
    case DJFS_OP_TRUNCATE: return __djinn_fs_truncate(a[0], a[1]);
    case DJFS_OP_SYNC: return __djinn_fs_sync(a[0]);
    case DJFS_OP_FSTAT: return __djinn_fs_fstat(a[0], (int64_t*)(intptr_t)a[1]);
    case DJFS_OP_STAT: return __djinn_fs_stat(a[0], (const char*)(intptr_t)a[1], a[2], (int32_t)a[3], (int64_t*)(intptr_t)a[4]);
    case DJFS_OP_MKDIR: return __djinn_fs_mkdir(a[0], (const char*)(intptr_t)a[1], a[2], (int32_t)a[3]);
    case DJFS_OP_REMOVE: return __djinn_fs_remove(a[0], (const char*)(intptr_t)a[1], a[2], (int32_t)a[3]);
    case DJFS_OP_RENAME:
        return __djinn_fs_rename(a[0], (const char*)(intptr_t)a[1], a[2], a[3], (const char*)(intptr_t)a[4], a[5], (int32_t)a[6]);
    case DJFS_OP_LIST_OPEN: return __djinn_fs_list_open(a[0]);
    }
    return -DJFS_INVALID_ARGUMENT;
}

#ifdef _WIN32

static CRITICAL_SECTION djfs_lock;
static CONDITION_VARIABLE djfs_wake;
static INIT_ONCE djfs_once = INIT_ONCE_STATIC_INIT;

static volatile LONG djfs_spinning;

static void djfs_spin(void)
{
    if (djfs_queue_head) return;
    if (InterlockedCompareExchange(&djfs_spinning, 1, 0) != 0) return;
    for (int i = 0; i < DJFS_SPIN && !djfs_queue_head; i++) YieldProcessor();
    InterlockedExchange(&djfs_spinning, 0);
}

static DWORD WINAPI djfs_worker(LPVOID unused)
{
    (void)unused;
    for (;;)
    {
        djfs_spin();
        EnterCriticalSection(&djfs_lock);
        while (!djfs_queue_head) SleepConditionVariableCS(&djfs_wake, &djfs_lock, INFINITE);
        djfs_request* request = djfs_queue_head;
        djfs_queue_head = request->next;
        if (!djfs_queue_head) djfs_queue_tail = NULL;
        LeaveCriticalSection(&djfs_lock);
        request->result = djfs_execute(request);
        void* coro = request->coro;
        MemoryBarrier();
        request->done = 1;
        djinn_enqueue_task(&djinn_rt.ready_queue, coro);
    }
    return 0;
}

static BOOL CALLBACK djfs_start(PINIT_ONCE once, PVOID parameter, PVOID* context)
{
    (void)once; (void)parameter; (void)context;
    InitializeCriticalSection(&djfs_lock);
    InitializeConditionVariable(&djfs_wake);
    for (int i = 0; i < DJFS_WORKERS; i++)
    {
        HANDLE thread = CreateThread(NULL, 0, djfs_worker, NULL, 0, NULL);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}

static void djfs_enqueue(djfs_request* request)
{
    InitOnceExecuteOnce(&djfs_once, djfs_start, NULL, NULL);
    EnterCriticalSection(&djfs_lock);
    int was_empty = djfs_queue_head == NULL;
    if (djfs_queue_tail) djfs_queue_tail->next = request;
    else djfs_queue_head = request;
    djfs_queue_tail = request;
    MemoryBarrier();
    if (!was_empty || djfs_spinning == 0) WakeConditionVariable(&djfs_wake);
    LeaveCriticalSection(&djfs_lock);
}

#else

static pthread_mutex_t djfs_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t djfs_wake = PTHREAD_COND_INITIALIZER;
static pthread_once_t djfs_once = PTHREAD_ONCE_INIT;

static volatile int djfs_spinning;

static void djfs_spin(void)
{
    if (djfs_queue_head) return;
    int expected = 0;
    if (!__atomic_compare_exchange_n(&djfs_spinning, &expected, 1, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)) return;
    for (int i = 0; i < DJFS_SPIN && !djfs_queue_head; i++)
    {
#if defined(__x86_64__) || defined(__i386__)
        __builtin_ia32_pause();
#elif defined(__aarch64__)
        __asm__ volatile("yield");
#endif
    }
    __atomic_store_n(&djfs_spinning, 0, __ATOMIC_SEQ_CST);
}

static void* djfs_worker(void* unused)
{
    (void)unused;
    for (;;)
    {
        djfs_spin();
        pthread_mutex_lock(&djfs_lock);
        while (!djfs_queue_head) pthread_cond_wait(&djfs_wake, &djfs_lock);
        djfs_request* request = djfs_queue_head;
        djfs_queue_head = request->next;
        if (!djfs_queue_head) djfs_queue_tail = NULL;
        pthread_mutex_unlock(&djfs_lock);
        request->result = djfs_execute(request);
        void* coro = request->coro;
        __atomic_store_n(&request->done, 1, __ATOMIC_RELEASE);
        djinn_enqueue_task(&djinn_rt.ready_queue, coro);
    }
    return NULL;
}

static void djfs_start(void)
{
    for (int i = 0; i < DJFS_WORKERS; i++)
    {
        pthread_t thread;
        if (pthread_create(&thread, NULL, djfs_worker, NULL) == 0) pthread_detach(thread);
    }
}

static void djfs_enqueue(djfs_request* request)
{
    pthread_once(&djfs_once, djfs_start);
    pthread_mutex_lock(&djfs_lock);
    int was_empty = djfs_queue_head == NULL;
    if (djfs_queue_tail) djfs_queue_tail->next = request;
    else djfs_queue_head = request;
    djfs_queue_tail = request;
    if (!was_empty || __atomic_load_n(&djfs_spinning, __ATOMIC_SEQ_CST) == 0) pthread_cond_signal(&djfs_wake);
    pthread_mutex_unlock(&djfs_lock);
}

#endif

int64_t __djinn_fs_submit(int32_t op, int64_t a0, int64_t a1, int64_t a2, int64_t a3, int64_t a4, int64_t a5, int64_t a6, void* coro)
{
    if (!coro) return -DJFS_INVALID_ARGUMENT;
    djfs_request* request = (djfs_request*)calloc(1, sizeof(djfs_request));
    if (!request) return -DJFS_OUT_OF_MEMORY;
    request->op = op;
    request->args[0] = a0;
    request->args[1] = a1;
    request->args[2] = a2;
    request->args[3] = a3;
    request->args[4] = a4;
    request->args[5] = a5;
    request->args[6] = a6;
    request->coro = coro;
    __djinn_mark_waiting(coro);
    djfs_enqueue(request);
    return (int64_t)(intptr_t)request;
}

int64_t __djinn_fs_finish(int64_t handle)
{
    if (handle < 0) return handle;
    djfs_request* request = (djfs_request*)(intptr_t)handle;
    int64_t result = request->result;
    free(request);
    return result;
}
