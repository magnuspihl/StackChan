# StackChan kit voice server: upstream xiaozhi-esp32-server, pinned by digest,
# with the kit's English/privacy fixes baked in. Rebuild after editing anything
# in overrides/ or patches/:  docker compose build && docker compose up -d
FROM ghcr.io/xinnan-tech/xiaozhi-esp32-server@sha256:cd41415f887410080dc2424b5faef651373c72fba37b3979d28e90ee548181af

WORKDIR /opt/xiaozhi-esp32-server

# Whole-file replacements (each file says what it changes at the top or inline).
COPY overrides/asr_openai.py         core/providers/asr/openai.py
COPY overrides/vllm_openai.py        core/providers/vllm/openai.py
COPY overrides/handle_exit_intent.py plugins_func/functions/handle_exit_intent.py
COPY overrides/web_search.py         plugins_func/functions/web_search.py

# Exact-string patches; the build fails if upstream no longer matches.
COPY patches/apply_kit_patches.py /tmp/apply_kit_patches.py
RUN python3 /tmp/apply_kit_patches.py && rm /tmp/apply_kit_patches.py
