# tchat 💬

Messagerie **chiffrée de bout en bout** directement dans le terminal, qui marche entre potes
sur des réseaux différents (4G, wifi de la fac, box à la maison…), **sans serveur à héberger**.

## Installation (toi et chaque pote)

🌐 **Site : https://tchat.187-124-38-234.sslip.io**

```sh
curl -fsSL https://tchat.187-124-38-234.sslip.io/install.sh | sh
```

Prérequis : Node ≥ 18, zsh (ou bash). Zéro dépendance npm. Mise à jour : `tchat update`.

À la main :

```sh
git clone https://github.com/EthanPasquier/tchat.git ~/.tchat-app
echo 'source ~/.tchat-app/shell/tchat.zsh' >> ~/.zshrc && exec zsh
```

## Utilisation

```sh
tchat new potes         # crée le salon #potes et affiche un code d'invitation
# → envoie la ligne "tchat join tc-…" à tes potes (Discord, SMS…)
tchat join tc-xxxx      # côté pote : rejoindre le salon
tchat                   # ouvrir le chat  —  ou juste Ctrl+G n'importe quand
tchat send potes "on mange ?"   # envoyer sans ouvrir le chat
```

Dans le chat : `/r <salon>` changer de salon, `/rooms`, `/invite`, `/new`, `/join`, `/leave`,
`/name`, `/notif on|off`, `/quit` (ou Ctrl+C). Les messages des autres salons s'affichent en petit.

## Les notifs dans le terminal

Un petit daemon (lancé automatiquement par ton shell) écoute tous tes salons. Quand un message arrive :

1. **Dans chaque terminal zsh ouvert**, la notif s'affiche au-dessus du prompt, en temps réel,
   même si tu es en train de taper (ta ligne est conservée). Astuce : chaque shell s'enregistre
   dans `~/.tchat/shells/<pid>`, le daemon y dépose le message puis envoie `SIGUSR1` au shell, dont
   le `TRAPUSR1` l'affiche via `zle -I` et redessine le prompt.
   Si une commande plein écran tourne (vim, htop…), la notif attend le prochain prompt.
2. **Badge `💬 N`** des non-lus à droite du prompt.
3. **Notif macOS** (désactivable : `tchat notif off`).

Pas de notif pour le salon que tu as déjà ouvert dans le chat.

## Dans Claude Code

Quand tu codes avec Claude Code, ton prompt zsh n'est plus affiché : les notifs passent alors par
Claude Code lui-même (branché automatiquement à l'installation si `~/.claude` existe, sinon
`tchat claude install`) :

1. **Barre d'état** : `💬 N non lus · #potes alex: on mange ?`, rafraîchie toutes les 2 s, même
   quand Claude ne fait rien. Si tu avais déjà ta propre barre, elle reste affichée au-dessus.
2. **Messages dans la conversation** : à chaque étape de Claude (outil utilisé, réponse finie,
   prompt envoyé), les nouveaux messages s'affichent en entier. Ils sont pour toi seulement :
   Claude ne les lit pas, zéro token consommé.
3. **`/tchat`** : Claude résume les derniers messages ; `/tchat potes on arrive` envoie la réponse
   (tel quel, Claude n'écrit jamais à ta place).

`tchat claude status` pour vérifier, `tchat claude uninstall` pour tout retirer (ta config
d'origine est remise, une copie est gardée dans `settings.json.avant-tchat`).

## Comment ça marche

- Relais : un serveur [ntfy](https://ntfy.sh) (pub/sub HTTP) hébergé sur `relay.tchat.187-124-38-234.sslip.io`,
  réservé aux salons tchat. Tout passe en HTTPS sortant, donc ça traverse n'importe quel NAT/pare-feu.
  Messages en cache 48 h : si ton pote écrit pendant que ton Mac dort, tu les récupères au réveil.
- Chaque salon = un secret aléatoire de 256 bits (dans le code d'invitation). On en dérive le nom
  du topic ntfy (indevinable) et une clé **AES-256-GCM**. Le serveur ne voit que du chiffré.
- ⚠️ Quiconque a le code d'invitation peut lire et écrire : ne le partage qu'avec tes potes.
- Relais perso : `tchat server https://ton-ntfy.exemple` *avant* de créer les salons
  (le serveur est inclus dans l'invitation, tes potes n'ont rien à configurer).

## Déploiement (site + relais)

`deploy/` contient le docker-compose (site nginx + relais ntfy derrière Traefik).
`./deploy/deploy.sh` synchronise le repo sur le VPS et relance les conteneurs.

## Personnalisation

- Raccourci : `export TCHAT_KEY='^T'` dans `~/.zshrc` **avant** la ligne `source`.
- Données : `~/.tchat/` (config, historique). `tchat daemon status|restart|log`.
