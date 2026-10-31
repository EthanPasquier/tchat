# tchat — intégration bash (l'expérience complète, avec notifs en direct au-dessus du prompt, est sous zsh)
# À sourcer depuis ~/.bashrc :  source ~/.tchat-app/shell/tchat.bash

_TCHAT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TCHAT_HOME="${TCHAT_HOME:-$HOME/.tchat}"
_TCHAT_INBOX="$TCHAT_HOME/shells/$$"

tchat() { command node "$_TCHAT_ROOT/bin/tchat.js" "$@"; }

mkdir -p "$TCHAT_HOME/shells" 2>/dev/null
: > "$_TCHAT_INBOX"
trap 'rm -f "$_TCHAT_INBOX"' EXIT
# bash ne sait pas redessiner la ligne en cours depuis un trap : on encaisse le signal,
# et les messages s'affichent au prochain prompt.
trap ':' USR1

if ! { [ -r "$TCHAT_HOME/daemon.pid" ] && kill -0 "$(cat "$TCHAT_HOME/daemon.pid")" 2>/dev/null; }; then
  (tchat daemon start >/dev/null 2>&1 &)
fi

_tchat_prompt() {
  if [ -s "$_TCHAT_INBOX" ]; then cat "$_TCHAT_INBOX"; : > "$_TCHAT_INBOX"; fi
  local n=0; [ -r "$TCHAT_HOME/unread" ] && n=$(cat "$TCHAT_HOME/unread")
  if [ "${n:-0}" -gt 0 ] 2>/dev/null; then printf '\033[35m💬 %s non lu(s) — Ctrl+G\033[0m\n' "$n"; fi
}
PROMPT_COMMAND="_tchat_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

bind -x '"\C-g": tchat' 2>/dev/null
