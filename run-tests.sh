#!/bin/sh
# Deterministic test suite for Catalyst.play. Exits nonzero on any failure.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "node not found"; exit 1; fi
node --test test/*.test.js
