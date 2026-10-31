# tchat — intégration zsh
# À sourcer depuis ~/.zshrc :  source /chemin/vers/terminalMessagerie/shell/tchat.zsh
#
#  - commande `tchat` (pas besoin de toucher au PATH)
#  - raccourci clavier (Ctrl+G par défaut, modifiable via TCHAT_KEY avant le source)
#  - notifs en temps réel au-dessus du prompt, même pendant que tu tapes (via SIGUSR1)
#  - badge 💬 N de messages non lus à droite du prompt

typeset -g _TCHAT_ROOT="${${(%):-%x}:A:h:h}"
typeset -g TCHAT_HOME="${TCHAT_HOME:-$HOME/.tchat}"
typeset -g _TCHAT_INBOX="$TCHAT_HOME/shells/$$"
typeset -g TCHAT_BADGE=""

tchat() { command node "$_TCHAT_ROOT/bin/tchat.js" "$@" }

# Inscription de ce shell auprès du daemon : un fichier inbox nommé par notre pid.
mkdir -p "$TCHAT_HOME/shells" 2>/dev/null
: >| "$_TCHAT_INBOX"
_tchat_zshexit() { rm -f "$_TCHAT_INBOX" }
zshexit_functions+=(_tchat_zshexit)

# Lance le daemon s'il ne tourne pas (vérif en pur zsh, node n'est lancé que si besoin).
() {
  local p; [[ -r $TCHAT_HOME/daemon.pid ]] && p=$(<$TCHAT_HOME/daemon.pid)
  if [[ -z $p ]] || ! kill -0 $p 2>/dev/null; then
    (tchat daemon start >/dev/null 2>&1 &)
  fi
}

_tchat_flush() {
  [[ -s $_TCHAT_INBOX ]] || return 0
  local msgs=$(<$_TCHAT_INBOX)
  : >| "$_TCHAT_INBOX"
  print -r -- "$msgs"
}

_tchat_badge() {
  local n=0
  [[ -r $TCHAT_HOME/unread ]] && n=$(<$TCHAT_HOME/unread)
  if (( ${n:-0} > 0 )); then TCHAT_BADGE="%F{magenta}💬 $n%f"; else TCHAT_BADGE=""; fi
}

# Le daemon envoie SIGUSR1 à chaque message reçu.
# Si on est au prompt : on affiche la notif au-dessus et zsh redessine la ligne en cours.
# Si une commande tourne (vim, htop…) : on ne salit pas l'écran, ce sera affiché au prochain prompt.
TRAPUSR1() {
  if zle; then
    zle -I
    _tchat_flush
    _tchat_badge
    zle reset-prompt
  fi
  return 0
}

_tchat_precmd() { _tchat_flush; _tchat_badge }
precmd_functions+=(_tchat_precmd)

setopt prompt_subst
[[ $RPROMPT == *TCHAT_BADGE* ]] || RPROMPT='${TCHAT_BADGE}'"$RPROMPT"

# Raccourci : met de côté ce que tu étais en train de taper, ouvre le chat, puis te le rend.
_tchat_widget() {
  zle push-input
  BUFFER="tchat"
  zle accept-line
}
zle -N _tchat_widget
bindkey "${TCHAT_KEY:-^G}" _tchat_widget
