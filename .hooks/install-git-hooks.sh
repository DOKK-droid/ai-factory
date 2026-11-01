#!/usr/bin/env bash
# Activa los git hooks versionados de este repo (una vez por clon).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
chmod +x .hooks/*.sh .hooks/git/*
git config core.hooksPath .hooks/git
echo "OK: core.hooksPath = .hooks/git"
