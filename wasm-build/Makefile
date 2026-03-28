# Doom over AT Protocol -- WASM build
#
# Compiles doomgeneric to WebAssembly for headless tick-by-tick control.
# No SDL, no audio, no display -- just the game engine.
#
# Prerequisites: Emscripten SDK (emsdk) activated in PATH
# WAD file: place doom1.wad in this directory before building
#
# Usage:
#   make            # Build doom.js + doom.wasm
#   make clean      # Remove build artifacts

# Path to doomgeneric source
DOOM_SRC = ../doom-doomgeneric/doomgeneric

CC = emcc

# Lower resolution for AT Protocol (less data per frame)
CFLAGS += -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200
CFLAGS += -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE
CFLAGS += -Os -Wall

# Emscripten flags
LDFLAGS += -s WASM=1
LDFLAGS += -s MODULARIZE=1
LDFLAGS += -s EXPORT_NAME="DoomModule"
LDFLAGS += -s EXPORTED_FUNCTIONS="['_doom_init','_doom_tick','_doom_add_key','_doom_get_screen','_doom_get_screen_width','_doom_get_screen_height','_doom_get_tick_count','_main','_malloc','_free']"
LDFLAGS += -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','HEAPU8','HEAPU32','FS']"
LDFLAGS += -s ALLOW_MEMORY_GROWTH=1
LDFLAGS += -s INITIAL_MEMORY=33554432
LDFLAGS += -s NO_EXIT_RUNTIME=1
LDFLAGS += -s FILESYSTEM=1
LDFLAGS += -s FORCE_FILESYSTEM=1

LIBS += -lm

OBJDIR = build
OUTPUT = doom

# All source files from doomgeneric (excluding platform-specific ones)
SRC_DOOM = dummy.o am_map.o doomdef.o doomstat.o dstrings.o d_event.o \
	d_items.o d_iwad.o d_loop.o d_main.o d_mode.o d_net.o f_finale.o \
	f_wipe.o g_game.o hu_lib.o hu_stuff.o info.o i_cdmus.o i_endoom.o \
	i_joystick.o i_scale.o i_sound.o i_system.o i_timer.o memio.o \
	m_argv.o m_bbox.o m_cheat.o m_config.o m_controls.o m_fixed.o \
	m_menu.o m_misc.o m_random.o p_ceilng.o p_doors.o p_enemy.o \
	p_floor.o p_inter.o p_lights.o p_map.o p_maputl.o p_mobj.o \
	p_plats.o p_pspr.o p_saveg.o p_setup.o p_sight.o p_spec.o \
	p_switch.o p_telept.o p_tick.o p_user.o r_bsp.o r_data.o \
	r_draw.o r_main.o r_plane.o r_segs.o r_sky.o r_things.o \
	sha1.o sounds.o statdump.o st_lib.o st_stuff.o s_sound.o \
	tables.o v_video.o wi_stuff.o w_checksum.o w_file.o w_main.o \
	w_wad.o z_zone.o w_file_stdc.o i_input.o i_video.o doomgeneric.o

# Our custom platform implementation (NOT from doomgeneric source dir)
SRC_PLATFORM = doomgeneric_atproto.o

OBJS_DOOM = $(addprefix $(OBJDIR)/, $(SRC_DOOM))
OBJS_PLATFORM = $(addprefix $(OBJDIR)/, $(SRC_PLATFORM))
OBJS = $(OBJS_DOOM) $(OBJS_PLATFORM)

all: $(OUTPUT).js

clean:
	rm -rf $(OBJDIR)
	rm -f $(OUTPUT).js $(OUTPUT).wasm

$(OUTPUT).js: $(OBJS)
	@echo [Linking $@]
	$(CC) $(CFLAGS) $(LDFLAGS) $(OBJS) -o $@ $(LIBS)
	@echo [Done] $(OUTPUT).js + $(OUTPUT).wasm

$(OBJS): | $(OBJDIR)

$(OBJDIR):
	mkdir -p $(OBJDIR)

# Compile doomgeneric sources
$(OBJDIR)/%.o: $(DOOM_SRC)/%.c
	@echo [Compiling $<]
	$(CC) $(CFLAGS) -c $< -o $@

# Compile our platform implementation
$(OBJDIR)/doomgeneric_atproto.o: doomgeneric_atproto.c
	@echo [Compiling $<]
	$(CC) $(CFLAGS) -I$(DOOM_SRC) -c $< -o $@

.PHONY: all clean
