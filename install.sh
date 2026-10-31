#!/bin/sh
# tchat — installeur.   curl -fsSL https://tchat.187-124-38-234.sslip.io/install.sh | sh
set -e
SITE="https://tchat.187-124-38-234.sslip.io"
DEST="$HOME/.tchat-app"

b='\033[1m'; g='\033[32m'; m='\033[35m'; r='\033[31m'; d='\033[2m'; n='\033[0m'
say() { printf "%b\n" "$*"; }

say "${m}${b}tchat${n} ${d}— messagerie dans le terminal${n}"

if ! command -v node >/dev/null 2>&1; then
  say "${r}✗ Node.js est requis.${n}"
  say "  macOS : ${b}brew install node${n}    Linux : ${b}sudo apt install nodejs${n}    ou https://nodejs.org"
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  say "${r}✗ Node.js 18 ou plus récent requis (tu as $(node -v)).${n}"; exit 1
fi

tmp="$(mktemp -d)"
say "${d}→ téléchargement…${n}"
curl -fsSL "$SITE/tchat.tar.gz" | tar -xz -C "$tmp"
rm -rf "$DEST"
mv "$tmp/tchat" "$DEST"
rm -rf "$tmp"
chmod +x "$DEST/bin/tchat.js"

mkdir -p "$HOME/.local/bin"
ln -sf "$DEST/bin/tchat.js" "$HOME/.local/bin/tchat"

add_line() { # fichier, ligne
  touch "$1"
  grep -qF "$2" "$1" 2>/dev/null || printf '\n# tchat — messagerie dans le terminal\n%s\n' "$2" >> "$1"
}
case "$(basename "${SHELL:-sh}")" in
  zsh)  add_line "$HOME/.zshrc"  "source \"$DEST/shell/tchat.zsh\""; RC="~/.zshrc" ;;
  bash) add_line "$HOME/.bashrc" "source \"$DEST/shell/tchat.bash\""; RC="~/.bashrc" ;;
  *)    RC="" ;;
esac

# Mise à jour : relance le daemon avec le nouveau code
if [ -r "$HOME/.tchat/daemon.pid" ] && kill -0 "$(cat "$HOME/.tchat/daemon.pid")" 2>/dev/null; then
  kill "$(cat "$HOME/.tchat/daemon.pid")" 2>/dev/null || true
  sleep 0.3
fi
node "$DEST/bin/tchat.js" daemon start

say "${g}✓ tchat $(node -p "require('$DEST/package.json').version") installé.${n}"
say ""
if [ -n "$RC" ]; then
  say "  1. Ouvre un nouveau terminal ${d}(ou : exec \$SHELL)${n}"
else
  say "  1. Ajoute ${b}$HOME/.local/bin${n} à ton PATH"
fi
say "  2. ${b}tchat${n} ou ${b}Ctrl+G${n} pour ouvrir la messagerie"
say "  3. ${b}tchat new potes${n} pour créer un salon, ou ${b}tchat join <code>${n}"
