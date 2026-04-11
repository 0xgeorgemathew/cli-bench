#!/usr/bin/env bash
# quickstart.sh — One-step setup for cli-bench
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/USER/REPO/main/quickstart.sh)
#   bash <(curl -fsSL https://raw.githubusercontent.com/USER/REPO/main/quickstart.sh) --yes
#
# Flags:
#   --yes    Auto-accept all prompts (non-interactive mode)

# --- Configuration ---
# TODO: Replace with your actual GitHub repo URL
REPO_URL="https://github.com/0xgeorgemathew/cli-bench.git"
REPO_DIR="cli-bench"

# --- Safety flags ---
set -euo pipefail

# --- Argument parsing ---
AUTO_ACCEPT=false
for arg in "$@"; do
	case "$arg" in
		--yes|-y)
			AUTO_ACCEPT=true
			;;
	esac
done

# --- Color helpers (ANSI, works on macOS and Linux terminals) ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${BLUE}  info:${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}    ok:${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW} warn:${RESET} %s\n" "$*"; }
err()   { printf "${RED} error:${RESET} %s\n" "$*" >&2; }
header() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

# --- Prompt helper: ask yes/no, respect AUTO_ACCEPT ---
ask_yes() {
	local prompt="$1"
	if $AUTO_ACCEPT; then
		return 0
	fi
	printf "  ${BOLD}?${RESET} %s [Y/n] " "$prompt"
	read -r answer
	case "$answer" in
		n*|N*) return 1 ;;
		*)     return 0 ;;
	esac
}

# --- Error trap: print failure context on unexpected exit ---
cleanup() {
	local exit_code=$?
	if [ $exit_code -ne 0 ]; then
		err "Setup failed (exit code $exit_code). Check the output above for details."
		err "If Bun was just installed, you may need to restart your shell or run: source ~/.bashrc (or ~/.zshrc)"
	fi
}
trap cleanup EXIT

# ============================================================
#  Step 1: Check for required tools (git, curl)
# ============================================================
header "Step 1/5: Checking prerequisites"

for cmd in git curl; do
	if command -v "$cmd" &>/dev/null; then
		ok "$cmd is installed"
	else
		err "$cmd is required but not found. Please install it and re-run this script."
		exit 1
	fi
done

# ============================================================
#  Step 2: Install Bun if missing
# ============================================================
header "Step 2/5: Checking Bun runtime"

if command -v bun &>/dev/null; then
	ok "Bun $(bun --version) is installed"
else
	info "Bun is not installed."
	if ask_yes "Install Bun now? (uses official installer at bun.sh)"; then
		info "Installing Bun..."
		curl -fsSL https://bun.sh/install | bash

		# Make bun available in this shell session
		export PATH="$HOME/.bun/bin:$PATH"

		if command -v bun &>/dev/null; then
			ok "Bun $(bun --version) installed successfully"
		else
			err "Bun installation may have succeeded but bun is not on PATH."
			err "Restart your shell or run: source ~/.bashrc (or ~/.zshrc)"
			exit 1
		fi
	else
		err "Bun is required to run cli-bench. Install it from https://bun.sh and re-run."
		exit 1
	fi
fi

# ============================================================
#  Step 3: Clone the repository
# ============================================================
header "Step 3/5: Cloning repository"

if [ -d "$REPO_DIR/.git" ]; then
	info "Directory '$REPO_DIR' already exists. Pulling latest changes..."
	(cd "$REPO_DIR" && git pull --ff-only) || {
		warn "Could not pull latest changes. Continuing with existing checkout."
	}
else
	info "Cloning $REPO_URL ..."
	git clone "$REPO_URL" "$REPO_DIR"
	ok "Cloned into ./$REPO_DIR"
fi

# ============================================================
#  Step 4: Install dependencies
# ============================================================
header "Step 4/5: Installing dependencies"

cd "$REPO_DIR"

if [ -f "package.json" ]; then
	bun install
	ok "Dependencies installed"
else
	info "No package.json found — nothing to install"
fi

# ============================================================
#  Step 5: Check for target CLI tools
# ============================================================
header "Step 5/5: Checking target CLI tools"

# These CLIs require separate install and auth — we can only warn
declare -A CLI_TOOLS=(
	[claude]="https://docs.anthropic.com/en/docs/claude-code"
	[kilo]="https://kilo.dev"
	[opencode]="https://opencode.ai"
)

ALL_FOUND=true
for cli in claude kilo opencode; do
	if command -v "$cli" &>/dev/null; then
		ok "$cli is installed"
	else
		warn "$cli is not found — install it: ${CLI_TOOLS[$cli]}"
		ALL_FOUND=false
	fi
done

# ============================================================
#  Done
# ============================================================
printf "\n"
printf "${BOLD}${GREEN}  ╔══════════════════════════════════════════╗${RESET}\n"
printf "${BOLD}${GREEN}  ║        Setup complete!                   ║${RESET}\n"
printf "${BOLD}${GREEN}  ╚══════════════════════════════════════════╝${RESET}\n"
printf "\n"

if $ALL_FOUND; then
	info "All CLI tools are installed. Run the benchmark:"
	printf "\n    ${BOLD}cd %s && bun bench.ts${RESET}\n\n" "$REPO_DIR"
else
	info "Install the missing CLI tools above, then run:"
	printf "\n    ${BOLD}cd %s && bun bench.ts${RESET}\n\n" "$REPO_DIR"
fi
