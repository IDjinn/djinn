// The logger API of runtime/logger.c, synchronous: each record goes to the console of the page (errors to stderr).
typedef struct
{
    char name[48];
    int32_t level;
} web_logger_t;

static web_logger_t web_loggers[32];
static int32_t web_logger_count;
static const char* const web_level_names[] = {"TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"};

void* logger_get(const char* name, int32_t output, int32_t level)
{
    (void)output;
    for (int32_t i = 0; i < web_logger_count; i++)
    {
        if (__builtin_strcmp(web_loggers[i].name, name) == 0) return &web_loggers[i];
    }
    if (web_logger_count == 32) return &web_loggers[31];
    web_logger_t* logger = &web_loggers[web_logger_count++];
    int32_t length = strlen(name);
    if (length > 47) length = 47;
    __builtin_memcpy(logger->name, name, (size_t)length);
    logger->name[length] = 0;
    logger->level = level;
    return logger;
}

static void web_log(void* handle, int32_t level, const char* format, va_list args)
{
    web_logger_t* logger = (web_logger_t*)handle;
    if (logger && level < logger->level) return;
    char line[1024];
    int32_t length = snprintf(line, sizeof(line), "[%s] %s: ", web_level_names[level < 0 || level > 5 ? 2 : level],
        logger ? logger->name : "djinn");
    if (length < (int32_t)sizeof(line))
    {
        length += vsnprintf(line + length, sizeof(line) - (size_t)length, format, args);
    }
    if (length >= (int32_t)sizeof(line) - 1) length = (int32_t)sizeof(line) - 2;
    line[length++] = '\n';
    web_console_write(level >= 4 ? 2 : 1, line, length);
}

void logger_log(void* logger, int32_t level, const char* format, ...)
{
    va_list args;
    va_start(args, format);
    web_log(logger, level, format, args);
    va_end(args);
}

#define WEB_LOG_LEVEL(name, level)                    \
    void name(void* logger, const char* format, ...)  \
    {                                                 \
        va_list args;                                 \
        va_start(args, format);                       \
        web_log(logger, level, format, args);         \
        va_end(args);                                 \
    }

WEB_LOG_LEVEL(logger_trace, 0)
WEB_LOG_LEVEL(logger_debug, 1)
WEB_LOG_LEVEL(logger_info, 2)
WEB_LOG_LEVEL(logger_warn, 3)
WEB_LOG_LEVEL(logger_error, 4)
WEB_LOG_LEVEL(logger_fatal, 5)

void logger_set_level(void* logger, int32_t level)
{
    if (logger) ((web_logger_t*)logger)->level = level;
}

void logger_set_async(void* logger, int32_t enabled) { (void)logger; (void)enabled; }
void logger_set_sync_level(void* logger, int32_t level) { (void)logger; (void)level; }
void logger_flush_all(void) {}

int32_t logger_enabled(void* logger, int32_t level)
{
    return !logger || level >= ((web_logger_t*)logger)->level;
}
