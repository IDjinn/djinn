#pragma once

#ifndef DJINN_LOGGER_H
#define DJINN_LOGGER_H

#include <stdio.h>
#include <stddef.h>
#include <stdint.h>

#define DJINN_LOG_FORMAT_MAX 256

#ifndef DJINN_LOG_COMPILE_LEVEL
#define DJINN_LOG_COMPILE_LEVEL LOG_TRACE
#endif

typedef enum
{
    LOG_TRACE = 0,
    LOG_DEBUG,
    LOG_INFO,
    LOG_WARN,
    LOG_ERROR,
    LOG_FATAL
} LogLevel;

typedef void (*LogWriteFn)(void* ctx, const char* data, size_t length, LogLevel level);
typedef void (*LogFlushFn)(void* ctx);
typedef void (*LogCloseFn)(void* ctx);

typedef struct LogAppender
{
    LogWriteFn write;
    LogFlushFn flush;
    LogCloseFn close;
    void* ctx;
    LogLevel min_level;
    struct LogAppender* next;
} LogAppender;

typedef struct LogSegment
{
    uint8_t kind;
    uint32_t start;
    uint32_t length;
} LogSegment;

typedef struct Logger
{
    _Atomic int level;
    _Atomic int flush_level;
    _Atomic int async;
    _Atomic int sync_level;
    int dirty;
    char* name;
    size_t name_length;
    LogSegment* segments;
    size_t segment_count;
    char* text;
    int needs_time;
    LogAppender* appenders;
    struct Logger* next;
} Logger;

Logger* logger_get(const char* name, int output, LogLevel level);
void logger_destroy_all(void);
void logger_configure_from_properties(Logger* logger, const char* props_path);

void logger_set_level(Logger* logger, LogLevel level);
void logger_set_format(Logger* logger, const char* format);
void logger_set_flush_level(Logger* logger, LogLevel level);
void logger_set_async(Logger* logger, int enabled);
void logger_set_sync_level(Logger* logger, LogLevel level);
void logger_flush_all(void);

int logger_enabled(Logger* logger, int level);
int logger_add_appender(Logger* logger, LogWriteFn write, LogFlushFn flush, LogCloseFn close, void* ctx, LogLevel min_level);
int logger_add_file(Logger* logger, const char* path, LogLevel min_level);

void logger_log(Logger* logger, LogLevel level, const char* fmt, ...);
void logger_trace(Logger* logger, const char* fmt, ...);
void logger_debug(Logger* logger, const char* fmt, ...);
void logger_info(Logger* logger, const char* fmt, ...);
void logger_warn(Logger* logger, const char* fmt, ...);
void logger_error(Logger* logger, const char* fmt, ...);
void logger_fatal(Logger* logger, const char* fmt, ...);

#define LOGGER_LOG(lg, lvl, ...) do { \
        if ((lvl) >= DJINN_LOG_COMPILE_LEVEL && logger_enabled((lg), (lvl))) \
            logger_log((lg), (lvl), __VA_ARGS__); \
    } while (0)

#endif //DJINN_LOGGER_H
