# Leaflet Link for 3DS. Needs devkitPro with the 3ds-dev group (devkitARM, libctru, citro2d):
#   make            -> LeafletLink.3dsx (copy it to /3ds/ on the SD card, open it from the Homebrew Launcher)
#   make sim        -> host/leaflet-link-sim, the same core on this computer with a simulated game card
.SUFFIXES:

ifeq ($(MAKECMDGOALS),sim)
sim:
	python3 ../tools/build_link_web.py
	$(CC) -O2 -Wall -Wextra -Wno-unused-parameter -o host/leaflet-link-sim source/core.c source/webapp.c host/sim.c
.PHONY: sim
else

ifneq ($(words $(CURDIR)),1)
# devkitPro's rules can't handle spaces in paths, so build in a space-free copy and bring the result back.
TMPBUILD := /tmp/leaflet-link-build
.PHONY: all clean
all:
	@python3 ../tools/build_link_web.py
	@rm -rf $(TMPBUILD) && mkdir -p $(TMPBUILD)
	@cp -R Makefile icon.png source $(TMPBUILD)/
	@$(MAKE) --no-print-directory -C $(TMPBUILD)
	@cp $(TMPBUILD)/LeafletLink.3dsx $(TMPBUILD)/LeafletLink.smdh .
	@echo "Built LeafletLink.3dsx"
	@-python3 ../tools/build_link_js.py
clean:
	@rm -rf $(TMPBUILD) LeafletLink.3dsx LeafletLink.smdh host/leaflet-link-sim
else

ifeq ($(strip $(DEVKITARM)),)
$(error "DEVKITARM isn't set. Install devkitPro (https://devkitpro.org/wiki/Getting_Started) and the 3ds-dev group")
endif
include $(DEVKITARM)/3ds_rules

TARGET      := LeafletLink
BUILD       := build
SOURCES     := source
INCLUDES    := source
APP_TITLE   := Leaflet Link
APP_DESCRIPTION := Wild World cartridge sync for Leaflet
APP_AUTHOR  := oddnebula
ICON        := icon.png

ARCH     := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS   := -g -Wall -O2 -mword-relocations -ffunction-sections $(ARCH) $(INCLUDE) -D__3DS__
ASFLAGS  := -g $(ARCH)
LDFLAGS   = -specs=3dsx.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)
LIBS     := -lcitro2d -lcitro3d -lctru -lm
LIBDIRS  := $(CTRULIB)

ifneq ($(BUILD),$(notdir $(CURDIR)))
export OUTPUT   := $(CURDIR)/$(TARGET)
export TOPDIR   := $(CURDIR)
export VPATH    := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR  := $(CURDIR)/$(BUILD)
CFILES          := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
export LD       := $(CC)
export OFILES   := $(CFILES:.c=.o)
export INCLUDE  := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD)
export LIBPATHS := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)
export APP_ICON := $(TOPDIR)/$(ICON)
export _3DSXFLAGS += --smdh=$(CURDIR)/$(TARGET).smdh

.PHONY: all clean
all: $(BUILD)
	@if [ -f $(CURDIR)/../tools/build_link_web.py ]; then python3 $(CURDIR)/../tools/build_link_web.py; fi
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile
	@-python3 $(CURDIR)/../tools/build_link_js.py
$(BUILD):
	@mkdir -p $@
clean:
	@rm -rf $(BUILD) $(TARGET).3dsx $(TARGET).smdh $(TARGET).elf host/leaflet-link-sim

else
DEPENDS := $(OFILES:.o=.d)
$(OUTPUT).3dsx: $(OUTPUT).elf $(OUTPUT).smdh
$(OUTPUT).elf: $(OFILES)
-include $(DEPENDS)
endif
endif
endif
