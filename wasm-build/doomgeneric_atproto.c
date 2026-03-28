/**
 * doomgeneric platform implementation for Doom over AT Protocol.
 *
 * Headless WASM build: no SDL, no display, no audio.
 * Exposes tick-by-tick control to JavaScript via exported functions.
 *
 * Exported API:
 *   doom_init(argc, argv)     - Initialize the engine (loads WAD from Emscripten FS)
 *   doom_tick()               - Run one game tick
 *   doom_add_key(pressed,key) - Queue a key event before calling doom_tick()
 *   doom_get_screen()         - Returns pointer to RGBA framebuffer
 *   doom_get_screen_width()   - Returns screen width
 *   doom_get_screen_height()  - Returns screen height
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
    /* No-op in all cases. During init, DG_GetTicksMs uses real time
     * so the engine sees time passing without needing to sleep.
     * After init, we control tick timing externally. */
    (void)ms;
}

uint32_t DG_GetTicksMs()
{
    /* Always use real wall-clock time.
     * For the AT Protocol federated version we may need simulated time,
     * but for local testing real time keeps the engine happy. */
    return (uint32_t)emscripten_get_now();
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

/* main() is required by Emscripten but we don't use it.
 * Initialization happens when JS calls doom_init(). */
int main(int argc, char** argv)
{
    (void)argc;
    (void)argv;
    return 0;
}
