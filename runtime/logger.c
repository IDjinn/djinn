#include "logger.h"
#include <stdlib.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>

#include "djinn_runtime.h"

#ifdef DJINN_ENABLE_TRACE
#define LOG_ALLOC(size) calloc(1, (size))
#define LOG_FREE(pointer) free(pointer)
#else
#define LOG_ALLOC(size) __djinn_alloc_zeroed(size)
#define LOG_FREE(pointer) __djinn_free(pointer)
#endif

#ifdef _WIN32
#include <windows.h>
static SRWLOCK loggers_lock = SRWLOCK_INIT;
static SRWLOCK emit_lock = SRWLOCK_INIT;
static SRWLOCK queue_lock = SRWLOCK_INIT;
static SRWLOCK time_lock = SRWLOCK_INIT;
static CONDITION_VARIABLE queue_not_empty = CONDITION_VARIABLE_INIT;
static CONDITION_VARIABLE queue_progress = CONDITION_VARIABLE_INIT;
#define LOCK(lock) AcquireSRWLockExclusive(&(lock))
#define UNLOCK(lock) ReleaseSRWLockExclusive(&(lock))
#define QUEUE_WAIT(cond) SleepConditionVariableSRW(&(cond), &queue_lock, INFINITE, 0)
#define QUEUE_SIGNAL(cond) WakeConditionVariable(&(cond))
#define QUEUE_BROADCAST(cond) WakeAllConditionVariable(&(cond))
#else
#include <pthread.h>
static pthread_mutex_t loggers_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t emit_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t queue_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t time_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t queue_not_empty = PTHREAD_COND_INITIALIZER;
static pthread_cond_t queue_progress = PTHREAD_COND_INITIALIZER;
#define LOCK(lock) pthread_mutex_lock(&(lock))
#define UNLOCK(lock) pthread_mutex_unlock(&(lock))
#define QUEUE_WAIT(cond) pthread_cond_wait(&(cond), &queue_lock)
#define QUEUE_SIGNAL(cond) pthread_cond_signal(&(cond))
#define QUEUE_BROADCAST(cond) pthread_cond_broadcast(&(cond))
#endif

enum
{
    SEG_LITERAL,
    SEG_LEVEL,
    SEG_LEVEL_PADDED,
    SEG_NAME,
    SEG_MESSAGE,
    SEG_YEAR4,
    SEG_YEAR2,
    SEG_MONTH,
    SEG_DAY,
    SEG_HOUR,
    SEG_MINUTE,
    SEG_SECOND,
    SEG_MILLIS3,
    SEG_MILLIS4
};

#define DEFAULT_PATTERN "[{YYYY-MM-dd HH:mm:ss}] [{level5}] [{file}] {...}"

static Logger* loggers;

static const char* const level_names[] = {
    "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"
};

static const char* const level_names_padded[] = {
    "TRACE", "DEBUG", "INFO ", "WARN ", "ERROR", "FATAL"
};

typedef struct
{
    char* data;
    size_t length;
    size_t capacity;
    int failed;
    char stack[1024];
} LineBuffer;

static void line_init(LineBuffer* buffer)
{
    buffer->data = buffer->stack;
    buffer->length = 0;
    buffer->capacity = sizeof(buffer->stack);
    buffer->failed = 0;
}

static void line_release(LineBuffer* buffer)
{
    if (buffer->data != buffer->stack)
        free(buffer->data);
}

static int line_reserve(LineBuffer* buffer, size_t extra)
{
    if (buffer->failed)
        return 0;
    if (buffer->length + extra <= buffer->capacity)
        return 1;
    size_t capacity = buffer->capacity * 2;
    while (capacity < buffer->length + extra)
        capacity *= 2;
    char* grown = malloc(capacity);
    if (!grown)
    {
        buffer->failed = 1;
        return 0;
    }
    memcpy(grown, buffer->data, buffer->length);
    if (buffer->data != buffer->stack)
        free(buffer->data);
    buffer->data = grown;
    buffer->capacity = capacity;
    return 1;
}

static void line_append(LineBuffer* buffer, const char* text, size_t length)
{
    if (!line_reserve(buffer, length))
        return;
    memcpy(buffer->data + buffer->length, text, length);
    buffer->length += length;
}

static void line_number(LineBuffer* buffer, int value, int width)
{
    char digits[12];
    for (int i = width - 1; i >= 0; i--)
    {
        digits[i] = (char)('0' + value % 10);
        value /= 10;
    }
    line_append(buffer, digits, (size_t)width);
}

static void line_format(LineBuffer* buffer, const char* fmt, va_list args)
{
    va_list copy;
    va_copy(copy, args);
    int needed = vsnprintf(buffer->data + buffer->length, buffer->capacity - buffer->length, fmt, copy);
    va_end(copy);
    if (needed < 0)
        return;
    if ((size_t)needed >= buffer->capacity - buffer->length)
    {
        if (!line_reserve(buffer, (size_t)needed + 1))
            return;
        vsnprintf(buffer->data + buffer->length, buffer->capacity - buffer->length, fmt, args);
    }
    buffer->length += (size_t)needed;
}

static LogLevel parse_level(const char* str)
{
    if (strcmp(str, "TRACE") == 0) return LOG_TRACE;
    if (strcmp(str, "DEBUG") == 0) return LOG_DEBUG;
    if (strcmp(str, "INFO") == 0) return LOG_INFO;
    if (strcmp(str, "WARN") == 0) return LOG_WARN;
    if (strcmp(str, "ERROR") == 0) return LOG_ERROR;
    if (strcmp(str, "FATAL") == 0) return LOG_FATAL;
    return LOG_INFO;
}

static int token_has(const char* token, size_t length, const char* needle)
{
    size_t n = strlen(needle);
    for (size_t i = 0; i + n <= length; i++)
        if (memcmp(token + i, needle, n) == 0)
            return 1;
    return 0;
}

static int is_datetime_token(const char* token, size_t length)
{
    return length >= 2 && (
        token_has(token, length, "dd") || token_has(token, length, "MM") ||
        token_has(token, length, "YY") || token_has(token, length, "HH") ||
        token_has(token, length, "mm") || token_has(token, length, "ss"));
}

typedef struct
{
    LogSegment* segments;
    size_t count;
    char* text;
    size_t text_length;
    int needs_time;
} PatternBuilder;

static void pattern_add(PatternBuilder* builder, uint8_t kind)
{
    if (kind != SEG_LITERAL)
    {
        LogSegment* segment = &builder->segments[builder->count++];
        segment->kind = kind;
        segment->start = 0;
        segment->length = 0;
    }
}

static void pattern_literal(PatternBuilder* builder, const char* text, size_t length)
{
    LogSegment* last = builder->count > 0 ? &builder->segments[builder->count - 1] : NULL;
    if (!last || last->kind != SEG_LITERAL)
    {
        last = &builder->segments[builder->count++];
        last->kind = SEG_LITERAL;
        last->start = (uint32_t)builder->text_length;
        last->length = 0;
    }
    memcpy(builder->text + builder->text_length, text, length);
    builder->text_length += length;
    last->length += (uint32_t)length;
}

static size_t pattern_datetime(PatternBuilder* builder, const char* token, size_t length, size_t i)
{
    builder->needs_time = 1;
    if (i + 4 <= length && memcmp(token + i, "YYYY", 4) == 0) { pattern_add(builder, SEG_YEAR4); return 4; }
    if (i + 4 <= length && memcmp(token + i, "mmmm", 4) == 0) { pattern_add(builder, SEG_MILLIS4); return 4; }
    if (i + 3 <= length && memcmp(token + i, "mmm", 3) == 0) { pattern_add(builder, SEG_MILLIS3); return 3; }
    if (i + 2 <= length && memcmp(token + i, "dd", 2) == 0) { pattern_add(builder, SEG_DAY); return 2; }
    if (i + 2 <= length && memcmp(token + i, "MM", 2) == 0) { pattern_add(builder, SEG_MONTH); return 2; }
    if (i + 2 <= length && memcmp(token + i, "YY", 2) == 0) { pattern_add(builder, SEG_YEAR2); return 2; }
    if (i + 2 <= length && memcmp(token + i, "HH", 2) == 0) { pattern_add(builder, SEG_HOUR); return 2; }
    if (i + 2 <= length && memcmp(token + i, "mm", 2) == 0) { pattern_add(builder, SEG_MINUTE); return 2; }
    if (i + 2 <= length && memcmp(token + i, "ss", 2) == 0) { pattern_add(builder, SEG_SECOND); return 2; }
    pattern_literal(builder, token + i, 1);
    return 1;
}

static void pattern_compile(Logger* logger, const char* format)
{
    size_t length = strlen(format);
    PatternBuilder builder;
    builder.segments = LOG_ALLOC((length + 2) * sizeof(LogSegment));
    builder.text = LOG_ALLOC(length + 2);
    builder.count = 0;
    builder.text_length = 0;
    builder.needs_time = 0;

    size_t i = 0;
    while (i < length)
    {
        if (format[i] != '{')
        {
            pattern_literal(&builder, format + i, 1);
            i++;
            continue;
        }
        size_t end = i + 1;
        while (end < length && format[end] != '}') end++;
        if (end >= length)
        {
            pattern_literal(&builder, "{", 1);
            i++;
            continue;
        }
        const char* token = format + i + 1;
        size_t token_length = end - i - 1;
        if (token_length == 3 && memcmp(token, "...", 3) == 0)
            pattern_add(&builder, SEG_MESSAGE);
        else if (token_length == 4 && memcmp(token, "file", 4) == 0)
            pattern_add(&builder, SEG_NAME);
        else if (token_length == 5 && memcmp(token, "level", 5) == 0)
            pattern_add(&builder, SEG_LEVEL);
        else if (token_length == 6 && memcmp(token, "level5", 6) == 0)
            pattern_add(&builder, SEG_LEVEL_PADDED);
        else if (is_datetime_token(token, token_length))
        {
            size_t j = 0;
            while (j < token_length)
                j += pattern_datetime(&builder, token, token_length, j);
        }
        else
        {
            pattern_literal(&builder, "{", 1);
            pattern_literal(&builder, token, token_length);
            pattern_literal(&builder, "}", 1);
        }
        i = end + 1;
    }

    LogSegment* old_segments = logger->segments;
    char* old_text = logger->text;
    logger->segments = builder.segments;
    logger->segment_count = builder.count;
    logger->text = builder.text;
    logger->needs_time = builder.needs_time;
    if (old_segments) LOG_FREE(old_segments);
    if (old_text) LOG_FREE(old_text);
}

static void stream_write(void* ctx, const char* data, size_t length, LogLevel level)
{
    (void)level;
    fwrite(data, 1, length, (FILE*)ctx);
}

static void stream_flush(void* ctx)
{
    fflush((FILE*)ctx);
}

static void file_close(void* ctx)
{
    fclose((FILE*)ctx);
}

static int add_appender_locked(Logger* logger, LogWriteFn write, LogFlushFn flush, LogCloseFn close, void* ctx, LogLevel min_level)
{
    LogAppender* appender = LOG_ALLOC(sizeof(LogAppender));
    appender->write = write;
    appender->flush = flush;
    appender->close = close;
    appender->ctx = ctx;
    appender->min_level = min_level;
    LogAppender** tail = &logger->appenders;
    while (*tail) tail = &(*tail)->next;
    *tail = appender;
    return 1;
}

static void free_appenders(LogAppender* appender)
{
    while (appender)
    {
        LogAppender* next = appender->next;
        if (appender->flush) appender->flush(appender->ctx);
        if (appender->close) appender->close(appender->ctx);
        LOG_FREE(appender);
        appender = next;
    }
}

static struct tm cached_time;
static time_t cached_seconds = -1;

static void load_time(const struct timespec* ts, struct tm* out)
{
    LOCK(time_lock);
    if (ts->tv_sec != cached_seconds)
    {
        time_t seconds = ts->tv_sec;
#ifdef _WIN32
        localtime_s(&cached_time, &seconds);
#else
        localtime_r(&seconds, &cached_time);
#endif
        cached_seconds = ts->tv_sec;
    }
    *out = cached_time;
    UNLOCK(time_lock);
}

static void render(LineBuffer* line, const Logger* logger, LogLevel level, const LineBuffer* message,
                   const struct tm* time_parts, int millis)
{
    for (size_t i = 0; i < logger->segment_count; i++)
    {
        const LogSegment* segment = &logger->segments[i];
        switch (segment->kind)
        {
        case SEG_LITERAL: line_append(line, logger->text + segment->start, segment->length); break;
        case SEG_LEVEL: line_append(line, level_names[level], strlen(level_names[level])); break;
        case SEG_LEVEL_PADDED: line_append(line, level_names_padded[level], 5); break;
        case SEG_NAME: line_append(line, logger->name, logger->name_length); break;
        case SEG_MESSAGE: line_append(line, message->data, message->length); break;
        case SEG_YEAR4: line_number(line, time_parts->tm_year + 1900, 4); break;
        case SEG_YEAR2: line_number(line, (time_parts->tm_year + 1900) % 100, 2); break;
        case SEG_MONTH: line_number(line, time_parts->tm_mon + 1, 2); break;
        case SEG_DAY: line_number(line, time_parts->tm_mday, 2); break;
        case SEG_HOUR: line_number(line, time_parts->tm_hour, 2); break;
        case SEG_MINUTE: line_number(line, time_parts->tm_min, 2); break;
        case SEG_SECOND: line_number(line, time_parts->tm_sec, 2); break;
        case SEG_MILLIS3: line_number(line, millis, 3); break;
        case SEG_MILLIS4: line_number(line, millis, 4); break;
        default: break;
        }
    }
}

typedef struct AsyncNode
{
    struct AsyncNode* next;
    Logger* logger;
    LogLevel level;
    uint64_t sequence;
    size_t length;
    char data[];
} AsyncNode;

#define ASYNC_QUEUE_LIMIT 16384

static AsyncNode* queue_head;
static AsyncNode* queue_tail;
static size_t queue_count;
static uint64_t enqueued_sequence;
static uint64_t written_sequence;
static int writer_started;

static void emit_line(Logger* logger, LogLevel level, const char* data, size_t length, int flush)
{
    LOCK(emit_lock);
    for (LogAppender* appender = logger->appenders; appender; appender = appender->next)
    {
        if (level < appender->min_level)
            continue;
        appender->write(appender->ctx, data, length, level);
        if (flush && appender->flush)
            appender->flush(appender->ctx);
    }
    logger->dirty = !flush;
    UNLOCK(emit_lock);
}

static void flush_dirty_loggers(void)
{
    LOCK(loggers_lock);
    for (Logger* logger = loggers; logger; logger = logger->next)
    {
        LOCK(emit_lock);
        if (logger->dirty)
        {
            for (LogAppender* appender = logger->appenders; appender; appender = appender->next)
                if (appender->flush)
                    appender->flush(appender->ctx);
            logger->dirty = 0;
        }
        UNLOCK(emit_lock);
    }
    UNLOCK(loggers_lock);
}

static void drain_queue(void)
{
    LOCK(queue_lock);
    while (written_sequence < enqueued_sequence)
        QUEUE_WAIT(queue_progress);
    UNLOCK(queue_lock);
}

#ifdef _WIN32
static DWORD WINAPI writer_main(LPVOID arg)
#else
static void* writer_main(void* arg)
#endif
{
    (void)arg;
    LOCK(queue_lock);
    for (;;)
    {
        while (!queue_head)
            QUEUE_WAIT(queue_not_empty);
        AsyncNode* batch = queue_head;
        queue_head = NULL;
        queue_tail = NULL;
        queue_count = 0;
        QUEUE_BROADCAST(queue_progress);
        UNLOCK(queue_lock);

        uint64_t last_sequence = 0;
        while (batch)
        {
            AsyncNode* next = batch->next;
            emit_line(batch->logger, batch->level, batch->data, batch->length, 0);
            last_sequence = batch->sequence;
            free(batch);
            batch = next;
        }
        flush_dirty_loggers();

        LOCK(queue_lock);
        written_sequence = last_sequence;
        QUEUE_BROADCAST(queue_progress);
    }
    return 0;
}

static int start_writer_locked(void)
{
    if (writer_started)
        return 1;
#ifdef _WIN32
    HANDLE thread = CreateThread(NULL, 0, writer_main, NULL, 0, NULL);
    if (!thread)
        return 0;
    CloseHandle(thread);
#else
    pthread_t thread;
    if (pthread_create(&thread, NULL, writer_main, NULL) != 0)
        return 0;
    pthread_detach(thread);
#endif
    writer_started = 1;
    return 1;
}

static int enqueue_line(Logger* logger, LogLevel level, const char* data, size_t length, int wait_written)
{
    AsyncNode* node = malloc(sizeof(AsyncNode) + length);
    if (!node)
        return 0;
    node->next = NULL;
    node->logger = logger;
    node->level = level;
    node->length = length;
    memcpy(node->data, data, length);

    LOCK(queue_lock);
    if (!start_writer_locked())
    {
        UNLOCK(queue_lock);
        free(node);
        return 0;
    }
    while (queue_count >= ASYNC_QUEUE_LIMIT)
        QUEUE_WAIT(queue_progress);
    node->sequence = ++enqueued_sequence;
    if (queue_tail)
        queue_tail->next = node;
    else
        queue_head = node;
    queue_tail = node;
    queue_count++;
    uint64_t sequence = node->sequence;
    QUEUE_SIGNAL(queue_not_empty);
    if (wait_written)
        while (written_sequence < sequence)
            QUEUE_WAIT(queue_progress);
    UNLOCK(queue_lock);
    return 1;
}

static void log_internal(Logger* logger, LogLevel level, const char* fmt, va_list args)
{
    if ((int)level < atomic_load_explicit(&logger->level, memory_order_relaxed))
        return;

    LineBuffer message;
    line_init(&message);
    line_format(&message, fmt, args);

    LineBuffer line;
    line_init(&line);

    struct timespec ts = {0};
    struct tm time_parts = {0};
    int millis = 0;
    if (logger->needs_time)
    {
        timespec_get(&ts, TIME_UTC);
        load_time(&ts, &time_parts);
        millis = (int)(ts.tv_nsec / 1000000);
    }
    render(&line, logger, level, &message, &time_parts, millis);
    line_append(&line, "\n", 1);
    line_release(&message);

    if (!line.failed)
    {
        int handled = 0;
        if (atomic_load_explicit(&logger->async, memory_order_relaxed))
        {
            int wait_written = (int)level >= atomic_load_explicit(&logger->sync_level, memory_order_relaxed);
            handled = enqueue_line(logger, level, line.data, line.length, wait_written);
        }
        if (!handled)
        {
            int flush = (int)level >= atomic_load_explicit(&logger->flush_level, memory_order_relaxed);
            emit_line(logger, level, line.data, line.length, flush);
        }
    }
    line_release(&line);
}

Logger* logger_get(const char* name, int output, LogLevel level)
{
    LOCK(loggers_lock);
    Logger* logger = loggers;
    while (logger != NULL && strcmp(logger->name, name) != 0)
        logger = logger->next;
    if (logger == NULL)
    {
        const size_t size = strlen(name) + 1;
        logger = LOG_ALLOC(sizeof(Logger));
        logger->name = LOG_ALLOC(size);
        memcpy(logger->name, name, size);
        logger->name_length = size - 1;
        atomic_init(&logger->level, (int)level);
        atomic_init(&logger->flush_level, (int)LOG_TRACE);
        atomic_init(&logger->async, 0);
        atomic_init(&logger->sync_level, (int)LOG_ERROR);
        pattern_compile(logger, DEFAULT_PATTERN);
        add_appender_locked(logger, stream_write, stream_flush, NULL, (output == 2) ? (void*)stderr : (void*)stdout, LOG_TRACE);
        logger->next = loggers;
        loggers = logger;
    }
    UNLOCK(loggers_lock);
    return logger;
}

void logger_flush_all(void)
{
    drain_queue();
}

void logger_destroy_all(void)
{
    drain_queue();
    LOCK(loggers_lock);
    Logger* logger = loggers;
    loggers = NULL;
    UNLOCK(loggers_lock);
    while (logger != NULL)
    {
        Logger* next = logger->next;
        LOCK(emit_lock);
        free_appenders(logger->appenders);
        UNLOCK(emit_lock);
        LOG_FREE(logger->segments);
        LOG_FREE(logger->text);
        LOG_FREE(logger->name);
        LOG_FREE(logger);
        logger = next;
    }
}

void logger_configure_from_properties(Logger* logger, const char* props_path)
{
    FILE* f = NULL;
#ifdef _WIN32
    if (fopen_s(&f, props_path, "r") != 0 || !f) return;
#else
    f = fopen(props_path, "r");
    if (!f) return;
#endif

    char line[512];
    while (fgets(line, sizeof(line), f))
    {
        line[strcspn(line, "\r\n")] = '\0';

        char* eq = strchr(line, '=');
        if (!eq) continue;

        *eq = '\0';
        const char* key = line;
        const char* val = eq + 1;

        if (strcmp(key, "logger.level") == 0)
            logger_set_level(logger, parse_level(val));
        else if (strcmp(key, "logger.format") == 0)
            logger_set_format(logger, val);
        else if (strcmp(key, "logger.flush") == 0)
            logger_set_flush_level(logger, parse_level(val));
        else if (strcmp(key, "logger.async") == 0)
            logger_set_async(logger, strcmp(val, "true") == 0 || strcmp(val, "1") == 0);
        else if (strcmp(key, "logger.sync") == 0)
            logger_set_sync_level(logger, parse_level(val));
        else if (strcmp(key, "logger.file") == 0)
            logger_add_file(logger, val, LOG_TRACE);
    }

    fclose(f);
}

void logger_set_level(Logger* logger, LogLevel level)
{
    atomic_store_explicit(&logger->level, (int)level, memory_order_relaxed);
}

void logger_set_flush_level(Logger* logger, LogLevel level)
{
    atomic_store_explicit(&logger->flush_level, (int)level, memory_order_relaxed);
}

void logger_set_async(Logger* logger, int enabled)
{
    atomic_store_explicit(&logger->async, enabled != 0, memory_order_relaxed);
}

void logger_set_sync_level(Logger* logger, LogLevel level)
{
    atomic_store_explicit(&logger->sync_level, (int)level, memory_order_relaxed);
}

void logger_set_format(Logger* logger, const char* format)
{
    char limited[DJINN_LOG_FORMAT_MAX];
    const char* source = DEFAULT_PATTERN;
    if (format && format[0] != '\0')
    {
        size_t length = strlen(format);
        if (length >= DJINN_LOG_FORMAT_MAX)
            length = DJINN_LOG_FORMAT_MAX - 1;
        memcpy(limited, format, length);
        limited[length] = '\0';
        source = limited;
    }
    LOCK(emit_lock);
    pattern_compile(logger, source);
    UNLOCK(emit_lock);
}

int logger_enabled(Logger* logger, int level)
{
    return logger != NULL && level >= atomic_load_explicit(&logger->level, memory_order_relaxed);
}

int logger_add_appender(Logger* logger, LogWriteFn write, LogFlushFn flush, LogCloseFn close, void* ctx, LogLevel min_level)
{
    if (!logger || !write)
        return 0;
    LOCK(emit_lock);
    int added = add_appender_locked(logger, write, flush, close, ctx, min_level);
    UNLOCK(emit_lock);
    return added;
}

int logger_add_file(Logger* logger, const char* path, LogLevel min_level)
{
    FILE* f = NULL;
#ifdef _WIN32
    if (fopen_s(&f, path, "a") != 0 || !f) return 0;
#else
    f = fopen(path, "a");
    if (!f) return 0;
#endif
    return logger_add_appender(logger, stream_write, stream_flush, file_close, f, min_level);
}

void logger_log(Logger* logger, LogLevel level, const char* fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    log_internal(logger, level, fmt, args);
    va_end(args);
}

#define DEFINE_LEVEL_FUNCTION(name, level) \
    void name(Logger* logger, const char* fmt, ...) \
    { \
        va_list args; \
        va_start(args, fmt); \
        log_internal(logger, level, fmt, args); \
        va_end(args); \
    }

DEFINE_LEVEL_FUNCTION(logger_trace, LOG_TRACE)
DEFINE_LEVEL_FUNCTION(logger_debug, LOG_DEBUG)
DEFINE_LEVEL_FUNCTION(logger_info, LOG_INFO)
DEFINE_LEVEL_FUNCTION(logger_warn, LOG_WARN)
DEFINE_LEVEL_FUNCTION(logger_error, LOG_ERROR)
DEFINE_LEVEL_FUNCTION(logger_fatal, LOG_FATAL)
