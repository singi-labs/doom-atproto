/**
 * doomgeneric platform implementation for Doom over AT Protocol.
 *
 * Headless WASM build: no SDL, no display, no audio.
 * Exposes tick-by-tick control to JavaScript via exported functions.
 */

#include "doomgeneric.h"
#include "doomkeys.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

#include <emscripten/emscripten.h>

/* ----- Key queue ----- */

#define KEYQUEUE_SIZE 64

static unsigned short s_KeyQueue[KEYQUEUE_SIZE];
static unsigned int s_KeyQueueWriteIndex = 0;
static unsigned int s_KeyQueueReadIndex = 0;

/* Tick counter (incremented each doom_tick call) */
static uint32_t s_TickCount = 0;
static int s_InitDone = 0;

/*
 * Time management:
 * - During init: use real wall-clock time so Doom's startup loop works
 * - After init: use controlled time that only advances when doom_tick() is called
 *   This prevents the demo loop from triggering during idle periods.
 *
 * On the first doom_tick() after init, we capture the real time as the base
 * and count ticks from there, so there's no time gap.
 */
static double s_TimeBase = 0;  /* real time at first tick after init */
static int s_FirstTick = 1;    /* flag: is this the first tick after init? */

/* ----- DG callbacks ----- */

void DG_Init()
{
    /* No display to initialize */
}

void DG_DrawFrame()
{
    /* Framebuffer is already in DG_ScreenBuffer, JS reads it directly */
}

void DG_SleepMs(uint32_t ms)
{
    /* No-op */
    (void)ms;
}

uint32_t DG_GetTicksMs()
{
    if (!s_InitDone)
    {
        /* During init, use real time so Doom's startup loop can progress */
        return (uint32_t)emscripten_get_now();
    }
    /* After init: controlled time based on tick count.
     * Each tick = 28ms (Doom runs at ~35 ticks/sec). */
    return (uint32_t)(s_TimeBase + s_TickCount * 28);
}

int DG_GetKey(int* pressed, unsigned char* doomKey)
{
    if (s_KeyQueueReadIndex == s_KeyQueueWriteIndex)
    {
        return 0;
    }

    unsigned short keyData = s_KeyQueue[s_KeyQueueReadIndex];
    s_KeyQueueReadIndex++;
    s_KeyQueueReadIndex %= KEYQUEUE_SIZE;

    *pressed = keyData >> 8;
    *doomKey = keyData & 0xFF;

    return 1;
}

void DG_SetWindowTitle(const char* title)
{
    /* No window */
    (void)title;
}

/* ----- Exported functions for JavaScript ----- */

EMSCRIPTEN_KEEPALIVE
void doom_init(int argc, char** argv)
{
    doomgeneric_Create(argc, argv);
    s_InitDone = 1;
}

EMSCRIPTEN_KEEPALIVE
void doom_tick()
{
    if (s_FirstTick)
    {
        /* Capture real time as base, so controlled time starts from
         * where init left off (no gap = no demo trigger). */
        s_TimeBase = emscripten_get_now();
        s_FirstTick = 0;
    }
    s_TickCount++;
    doomgeneric_Tick();
}

EMSCRIPTEN_KEEPALIVE
void doom_add_key(int pressed, unsigned char key)
{
    unsigned short keyData = (pressed << 8) | key;
    s_KeyQueue[s_KeyQueueWriteIndex] = keyData;
    s_KeyQueueWriteIndex++;
    s_KeyQueueWriteIndex %= KEYQUEUE_SIZE;
}

EMSCRIPTEN_KEEPALIVE
uint32_t* doom_get_screen()
{
    return (uint32_t*)DG_ScreenBuffer;
}

EMSCRIPTEN_KEEPALIVE
int doom_get_screen_width()
{
    return DOOMGENERIC_RESX;
}

EMSCRIPTEN_KEEPALIVE
int doom_get_screen_height()
{
    return DOOMGENERIC_RESY;
}

EMSCRIPTEN_KEEPALIVE
uint32_t doom_get_tick_count()
{
    return s_TickCount;
}

int main(int argc, char** argv)
{
    (void)argc;
    (void)argv;
    return 0;
}
