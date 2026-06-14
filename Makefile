HOST ?= 127.0.0.1
PORT ?= 8000
PUBLIC_DIR ?= public
PYTHON ?= python3
OPEN_BROWSER ?= 1
OPEN ?= open
URL = http://$(HOST):$(PORT)/

.DEFAULT_GOAL := serve

.PHONY: help serve

help:
	@printf '%s\n' 'Available targets:'
	@printf '  %-10s %s\n' 'serve' 'Serve public/ locally and open it in a browser'

serve:
	@printf 'Serving %s at %s\n' '$(PUBLIC_DIR)' '$(URL)'
	@if command -v browser-sync >/dev/null 2>&1; then \
		BROWSER_SYNC=browser-sync; \
	elif command -v npx >/dev/null 2>&1; then \
		BROWSER_SYNC="npx --yes browser-sync"; \
	else \
		BROWSER_SYNC=""; \
	fi; \
	if [ "$(OPEN_BROWSER)" = "1" ]; then \
		(sleep 1; $(OPEN) '$(URL)' >/dev/null 2>&1) & \
	fi; \
	if [ -n "$$BROWSER_SYNC" ]; then \
		$$BROWSER_SYNC start --server $(PUBLIC_DIR) --files "$(PUBLIC_DIR)/**/*" --host $(HOST) --port $(PORT) --no-open; \
	else \
		$(PYTHON) -m http.server $(PORT) --bind $(HOST) --directory $(PUBLIC_DIR); \
	fi
