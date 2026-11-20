// The Android side of the UI host: the native_app_glue entry (android_main), the looper, the window, touch events,
// the software present and the fonts (stb_truetype over the system fonts). libs/android binds these functions.
// Built only by tools/build_runtime.sh --android, together with the NDK's android_native_app_glue.c.
#include <android/configuration.h>
#include <android/input.h>
#include <android/log.h>
#include <android/looper.h>
#include <android/native_window.h>
#include <android_native_app_glue.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>

#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#include "../third_party/stb/stb_truetype.h"

extern int main(int argc, char** argv);

// per app thread: the activity can be recreated while the previous app thread is still winding down
static __thread struct android_app* djinn_app = NULL;
static __thread int djinn_window_ready = 0;
static __thread int djinn_dirty = 0;

#define TOUCH_CAPACITY 64
typedef struct { float x, y; int action; } djinn_touch_t;
static __thread djinn_touch_t djinn_touches[TOUCH_CAPACITY];
static __thread int djinn_touch_head = 0, djinn_touch_tail = 0;

void djinn_android_log(const char* text)
{
    __android_log_write(ANDROID_LOG_INFO, "djinn", text);
}

// printf and stderr go nowhere on Android: a thread reads them from a pipe and writes each line to logcat (tag "djinn").
static void* pump_stdio(void* arg)
{
    int fd = (int)(intptr_t)arg;
    char line[1024];
    size_t used = 0;
    char byte;
    while (read(fd, &byte, 1) > 0)
    {
        if (byte == '\n' || used == sizeof line - 1)
        {
            line[used] = 0;
            if (used > 0) __android_log_write(ANDROID_LOG_INFO, "djinn", line);
            used = 0;
        }
        else line[used++] = byte;
    }
    return NULL;
}

static void redirect_stdio(void)
{
    int fds[2];
    if (pipe(fds) != 0) return;
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    dup2(fds[1], 1);
    dup2(fds[1], 2);
    pthread_t thread;
    if (pthread_create(&thread, NULL, pump_stdio, (void*)(intptr_t)fds[0]) == 0) pthread_detach(thread);
}

static void on_command(struct android_app* app, int32_t command)
{
    switch (command)
    {
    case APP_CMD_INIT_WINDOW:
        djinn_window_ready = app->window != NULL;
        djinn_dirty = 1;
        break;
    case APP_CMD_TERM_WINDOW:
        djinn_window_ready = 0;
        break;
    case APP_CMD_WINDOW_RESIZED:
    case APP_CMD_WINDOW_REDRAW_NEEDED:
    case APP_CMD_CONFIG_CHANGED:
    case APP_CMD_CONTENT_RECT_CHANGED:
    case APP_CMD_GAINED_FOCUS:
        djinn_dirty = 1;
        break;
    default:
        break;
    }
}

static int32_t on_input(struct android_app* app, AInputEvent* event)
{
    (void)app;
    if (AInputEvent_getType(event) != AINPUT_EVENT_TYPE_MOTION) return 0;
    int next = (djinn_touch_head + 1) % TOUCH_CAPACITY;
    if (next == djinn_touch_tail) return 1;
    djinn_touches[djinn_touch_head].x = AMotionEvent_getX(event, 0);
    djinn_touches[djinn_touch_head].y = AMotionEvent_getY(event, 0);
    djinn_touches[djinn_touch_head].action = AMotionEvent_getAction(event) & AMOTION_EVENT_ACTION_MASK;
    djinn_touch_head = next;
    return 1;
}

// The glue runs this on its own thread: it starts the Djinn program, whose main runs the UI host loop.
void android_main(struct android_app* app)
{
    djinn_app = app;
    redirect_stdio();
    app->onAppCmd = on_command;
    app->onInputEvent = on_input;
    djinn_android_log("android_main: starting the Djinn program");
    main(0, NULL);
    ANativeActivity_finish(app->activity);
}

// Waits up to timeout_ms (-1: until something happens) for events. Returns -1 when the activity is being destroyed,
// otherwise 1 when the window is ready and 0 when there is none; djinn_android_take_dirty tells if a redraw is due.
int djinn_android_pump(int timeout_ms)
{
    if (djinn_app == NULL) return -1;
    int events;
    struct android_poll_source* source;
    int wait = timeout_ms;
    while (ALooper_pollOnce(wait, NULL, &events, (void**)&source) >= 0)
    {
        if (source != NULL) source->process(djinn_app, source);
        if (djinn_app->destroyRequested) return -1;
        wait = 0;
    }
    if (djinn_app->destroyRequested) return -1;
    return djinn_window_ready;
}

int djinn_android_take_dirty(void)
{
    int dirty = djinn_dirty;
    djinn_dirty = 0;
    return dirty;
}

int djinn_android_width(void) { return djinn_window_ready ? ANativeWindow_getWidth(djinn_app->window) : 0; }
int djinn_android_height(void) { return djinn_window_ready ? ANativeWindow_getHeight(djinn_app->window) : 0; }
void* djinn_android_window(void) { return djinn_window_ready ? djinn_app->window : NULL; }

// The screen density in dpi (160 is a scale of 1).
int djinn_android_density(void)
{
    if (djinn_app == NULL || djinn_app->config == NULL) return 160;
    int density = AConfiguration_getDensity(djinn_app->config);
    return density > 0 ? density : 160;
}

// 1 when the system is in night mode.
int djinn_android_night(void)
{
    if (djinn_app == NULL || djinn_app->config == NULL) return 0;
    return (AConfiguration_getUiModeNight(djinn_app->config) == ACONFIGURATION_UI_MODE_NIGHT_YES) ? 1 : 0;
}

// Copies an RGBA frame to the window (the window format is RGBA_8888, the same byte order). 1 on success.
int djinn_android_present(const uint32_t* pixels, int width, int height)
{
    if (!djinn_window_ready) return 0;
    ANativeWindow* window = djinn_app->window;
    ANativeWindow_setBuffersGeometry(window, width, height, WINDOW_FORMAT_RGBA_8888);
    ANativeWindow_Buffer buffer;
    if (ANativeWindow_lock(window, &buffer, NULL) != 0) return 0;
    int rows = height < buffer.height ? height : buffer.height;
    int columns = width < buffer.width ? width : buffer.width;
    for (int y = 0; y < rows; y++)
        memcpy((uint32_t*)buffer.bits + (size_t)y * buffer.stride, pixels + (size_t)y * width, (size_t)columns * 4);
    ANativeWindow_unlockAndPost(window);
    return 1;
}

// The next touch event: action 0 down, 1 up, 2 move, 3 cancel. 0 when the queue is empty.
int djinn_android_next_touch(float* x, float* y, int* action)
{
    if (djinn_touch_tail == djinn_touch_head) return 0;
    *x = djinn_touches[djinn_touch_tail].x;
    *y = djinn_touches[djinn_touch_tail].y;
    *action = djinn_touches[djinn_touch_tail].action;
    djinn_touch_tail = (djinn_touch_tail + 1) % TOUCH_CAPACITY;
    return 1;
}

// ---- fonts ----------------------------------------------------------------------------------------------------------

typedef struct { stbtt_fontinfo info; unsigned char* data; int loaded; int tried; } djinn_face_t;
static djinn_face_t djinn_faces[2];
static __thread unsigned char* djinn_glyph = NULL;

static djinn_face_t* face_for(unsigned weight)
{
    int bold = weight >= 600;
    djinn_face_t* face = &djinn_faces[bold];
    if (!face->tried)
    {
        face->tried = 1;
        const char* paths[4];
        if (bold) { paths[0] = "/system/fonts/DroidSans-Bold.ttf"; paths[1] = "/system/fonts/Roboto-Regular.ttf"; }
        else { paths[0] = "/system/fonts/RobotoStatic-Regular.ttf"; paths[1] = "/system/fonts/DroidSans.ttf"; }
        paths[2] = "/system/fonts/Roboto-Regular.ttf";
        paths[3] = "/system/fonts/DroidSans.ttf";
        for (int i = 0; i < 4 && !face->loaded; i++)
        {
            FILE* file = fopen(paths[i], "rb");
            if (file == NULL) continue;
            fseek(file, 0, SEEK_END);
            long size = ftell(file);
            fseek(file, 0, SEEK_SET);
            unsigned char* data = (unsigned char*)malloc((size_t)size);
            if (data != NULL && fread(data, 1, (size_t)size, file) == (size_t)size
                && stbtt_InitFont(&face->info, data, stbtt_GetFontOffsetForIndex(data, 0)))
            {
                face->data = data;
                face->loaded = 1;
            }
            else free(data);
            fclose(file);
        }
    }
    return face->loaded ? face : NULL;
}

float djinn_font_advance(uint32_t code, float size, uint32_t weight)
{
    djinn_face_t* face = face_for(weight);
    if (face == NULL) return size * 0.5f;
    int advance, bearing;
    stbtt_GetCodepointHMetrics(&face->info, (int)code, &advance, &bearing);
    return (float)advance * stbtt_ScaleForMappingEmToPixels(&face->info, size);
}

// Rasterizes one glyph; the bitmap stays valid until the next call. Returns 0 for a glyph without pixels.
int djinn_font_rasterize(uint32_t code, float size, uint32_t weight, uint32_t phase, int* width, int* height, int* bearing_x,
    int* bearing_y, unsigned char** pixels)
{
    djinn_face_t* face = face_for(weight);
    if (face == NULL) return 0;
    if (djinn_glyph != NULL) { stbtt_FreeBitmap(djinn_glyph, NULL); djinn_glyph = NULL; }
    float scale = stbtt_ScaleForMappingEmToPixels(&face->info, size);
    int w = 0, h = 0, off_x = 0, off_y = 0;
    unsigned char* bitmap = stbtt_GetCodepointBitmapSubpixel(&face->info, scale, scale, (float)phase / 4.0f, 0.0f, (int)code, &w, &h,
        &off_x, &off_y);
    if (bitmap == NULL || w == 0 || h == 0) { if (bitmap != NULL) stbtt_FreeBitmap(bitmap, NULL); return 0; }
    djinn_glyph = bitmap;
    *width = w;
    *height = h;
    *bearing_x = off_x;
    *bearing_y = -off_y;
    *pixels = bitmap;
    return 1;
}

void djinn_font_metrics(float size, uint32_t weight, float* ascent, float* descent)
{
    djinn_face_t* face = face_for(weight);
    if (face == NULL) { *ascent = size * 0.9f; *descent = size * 0.25f; return; }
    int up, down, gap;
    stbtt_GetFontVMetrics(&face->info, &up, &down, &gap);
    float scale = stbtt_ScaleForMappingEmToPixels(&face->info, size);
    *ascent = (float)up * scale;
    *descent = (float)(-down) * scale;
}
