#!/bin/bash
set -euo pipefail

# Verificar se foi executado com sudo
if [ "$EUID" -ne 0 ]; then
  echo "Você precisa de superpoderes (root) pra rodar este script 🧙"
  echo "Execute: sudo ./script.sh"
  exit 1
fi

# Usuário real e home (quando rodado via sudo)
REAL_USER="${SUDO_USER:-$USER}"
if [ "$REAL_USER" = "root" ] || [ -z "$REAL_USER" ]; then
  REAL_USER="root"
  REAL_HOME="/root"
else
  REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
  REAL_HOME="${REAL_HOME:-/home/$REAL_USER}"
fi

run_as_user() {
  # Executa comando como o usuário que invocou o sudo
  if [ "$REAL_USER" = "root" ]; then
    env HOME="$REAL_HOME" "$@"
  else
    sudo -u "$REAL_USER" -H env HOME="$REAL_HOME" "$@"
  fi
}

append_bashrc() {
  local line="$1"
  local bashrc="$REAL_HOME/.bashrc"
  touch "$bashrc"
  chown "$REAL_USER:$REAL_USER" "$bashrc" 2>/dev/null || true
  grep -Fqx "$line" "$bashrc" 2>/dev/null || echo "$line" >> "$bashrc"
}

# Função para exibir mensagens
log() {
  echo -e "\e[32m[INFO]\e[0m $1"
}

warn() {
  echo -e "\e[33m[WARN]\e[0m $1"
}

log "Usuário alvo: $REAL_USER (HOME=$REAL_HOME)"

log "Configurando DNS Cloudflare (1.1.1.3, 1.0.0.3)..."
mkdir -p /etc/systemd/resolved.conf.d
cat > /etc/systemd/resolved.conf.d/dns.conf <<'EOF'
[Resolve]
DNS=1.1.1.3 1.0.0.3
EOF
if systemctl restart systemd-resolved 2>/dev/null; then
  log "systemd-resolved reiniciado."
else
  warn "systemd-resolved indisponível neste ambiente; DNS via resolved.conf.d foi escrito mesmo assim."
fi

if command -v nmcli >/dev/null 2>&1; then
  while IFS= read -r uuid; do
    [ -z "$uuid" ] && continue
    nmcli connection modify "$uuid" ipv4.ignore-auto-dns yes || true
    nmcli connection modify "$uuid" ipv4.dns "1.1.1.3 1.0.0.3" || true
  done < <(nmcli -t -f UUID connection show 2>/dev/null || true)
fi

# Configuração do mise
log "Instalando mise..."
curl -fsSL https://mise.run | sh
if [ -x /root/.local/bin/mise ]; then
  mv /root/.local/bin/mise /usr/local/bin/
elif [ -x "$REAL_HOME/.local/bin/mise" ]; then
  mv "$REAL_HOME/.local/bin/mise" /usr/local/bin/
fi
chown root:root /usr/local/bin/mise
chmod 755 /usr/local/bin/mise
/usr/local/bin/mise --version
echo 'eval "$(/usr/local/bin/mise activate bash)"' | tee /etc/profile.d/mise.sh > /dev/null
chmod +x /etc/profile.d/mise.sh
append_bashrc 'eval "$(/usr/local/bin/mise activate bash)"'

# Cria alias cls (idempotente)
append_bashrc "alias cls='clear'"

# mise como REAL_USER para tool installs em ~/.local
export PATH="/usr/local/bin:$PATH"
eval "$(/usr/local/bin/mise activate bash)" || true

log "Instalando Node.js via mise..."
run_as_user mise i node@22
run_as_user mise i node@18
run_as_user mise use --global node@22

log "Instalando Python via mise..."
run_as_user mise i python@3.12
run_as_user mise i python@3.10
run_as_user mise use --global python@3.12

log "Instalando Poetry..."
curl -sSL https://install.python-poetry.org | POETRY_HOME=/opt/poetry python3 - --yes
ln -sf /opt/poetry/bin/poetry /usr/local/bin/poetry
poetry --version

log "Instalando Java via mise..."
run_as_user mise i java@17
run_as_user mise use --global java@17

# TODO: instalar apenas para versões baseadas em Ubuntu 24.04 LTS
if [ "${SKIP_GUI:-0}" != "1" ]; then
  log "Instalando Spotify..."
  bash <(curl -sSL https://spotx-official.github.io/run.sh) --installdeb --stable || warn "Falha ao instalar Spotify (continuando)."
else
  warn "SKIP_GUI=1 — pulando Spotify."
fi

log "Instalando yarn"
# Garante npm no PATH após mise
if run_as_user bash -lc 'command -v npm >/dev/null'; then
  run_as_user bash -lc 'npm install --global yarn'
else
  warn "npm não encontrado; pulando yarn global via npm."
fi

log "Adicionando repositórios..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || true
apt-get install -y -qq software-properties-common ca-certificates curl wget gnupg apt-transport-https 2>/dev/null || true
add-apt-repository ppa:diodon-team/stable -y > /dev/null 2>&1 || warn "PPA diodon indisponível neste sistema."
add-apt-repository ppa:tomtomtom/yt-dlp -y > /dev/null 2>&1 || warn "PPA yt-dlp indisponível neste sistema."

APT_APPS=(
  ffmpeg
  flameshot
  diodon
  btop
  folder-color
  yarn
  gnome-sushi
  yt-dlp
  mysql-client
)

log "Instalando pacotes apt..."
apt-get update -qq || true
for app in "${APT_APPS[@]}"; do
  log "Instalando $app..."
  if ! apt-get install -y "$app" > /dev/null; then
    warn "Falha ao instalar pacote apt: $app (continuando)."
  fi
done

if [ "${SKIP_GUI:-0}" != "1" ] && command -v nautilus >/dev/null 2>&1; then
  run_as_user nautilus -q 2>/dev/null || true
fi

log "Instalando Zoxide..."
if curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh; then
  # zoxide costuma instalar em ~/.local/bin do usuário atual (root); move se necessário
  if [ -x /root/.local/bin/zoxide ] && [ "$REAL_USER" != "root" ]; then
    mkdir -p "$REAL_HOME/.local/bin"
    cp /root/.local/bin/zoxide "$REAL_HOME/.local/bin/zoxide"
    chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.local"
  fi
  append_bashrc 'eval "$(zoxide init bash)"'
else
  warn "Falha ao instalar Zoxide (continuando)."
fi

if [ "${SKIP_GUI:-0}" != "1" ]; then
  log "Instalando React Native Debugger..."
  wget -q https://github.com/jhen0409/react-native-debugger/releases/download/v0.14.0/react-native-debugger_0.14.0_amd64.deb -O /tmp/react-native-debugger.deb || warn "Download RND falhou."
  if [ -f /tmp/react-native-debugger.deb ]; then
    dpkg -i /tmp/react-native-debugger.deb || apt-get install -f -y
    rm -f /tmp/react-native-debugger.deb
  fi
else
  warn "SKIP_GUI=1 — pulando React Native Debugger."
fi

# Flatpak (opcional em harness de teste)
if [ "${SKIP_FLATPAK:-0}" = "1" ]; then
  warn "SKIP_FLATPAK=1 — pulando Flatpak / LibreOffice."
else
  if ! command -v flatpak >/dev/null 2>&1; then
    log "Instalando flatpak..."
    apt-get install -y flatpak > /dev/null || warn "Não foi possível instalar flatpak."
    flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true
  fi

  if dpkg -l 2>/dev/null | grep -q libreoffice || flatpak list 2>/dev/null | grep -q org.libreoffice.LibreOffice; then
    log "LibreOffice já está instalado."
  else
    log "Instalando LibreOffice..."
    flatpak install flathub org.libreoffice.LibreOffice -y > /dev/null 2>&1 || warn "Falha ao instalar LibreOffice via Flatpak."
  fi

  # Lista de pacotes Flatpak (Raider sem duplicata)
  FLATPAK_APPS=(
    com.google.Chrome
    com.discordapp.Discord
    com.mongodb.Compass
    org.pgadmin.pgadmin4
    io.dbeaver.DBeaverCommunity
    io.beekeeperstudio.Studio
    com.anydesk.Anydesk
    org.videolan.VLC
    rest.insomnia.Insomnia
    md.obsidian.Obsidian
    org.telegram.desktop
    com.valvesoftware.Steam
    com.heroicgameslauncher.hgl
    com.getpostman.Postman
    com.visualstudio.code
    org.localsend.localsend_app
    org.gnome.Boxes
    me.iepure.devtoolbox
    com.github.ADBeveridge.Raider
    io.github.jeffshee.Hidamari
    com.obsproject.Studio
    org.qbittorrent.qBittorrent
    it.mijorus.gearlever
    com.github.tchx84.Flatseal
    io.missioncenter.MissionCenter
    com.stremio.Stremio
    io.github.peazip.PeaZip
    com.github.wwmm.easyeffects
  )

  log "Instalando pacotes Flatpak..."
  for app in "${FLATPAK_APPS[@]}"; do
    log "Instalando $app..."
    if ! flatpak install flathub "$app" -y > /dev/null 2>&1; then
      warn "Falha ao instalar Flatpak $app (continuando)."
    fi
  done
fi

if [ "${SKIP_GUI:-0}" != "1" ]; then
  log "Instalando Termius..."
  wget -q https://www.termius.com/download/linux/Termius.deb -O /tmp/Termius.deb || warn "Download Termius falhou."
  if [ -f /tmp/Termius.deb ]; then
    dpkg -i /tmp/Termius.deb || apt-get install -f -y || warn "Falha ao instalar Termius."
    rm -f /tmp/Termius.deb
  fi

  log "Instalando Cursor..."
  curl -s https://gist.githubusercontent.com/paulovisam/abc5cbbd187a101d90bd71c5e0fb0eba/raw/c52aa0bfc302e85ee2094c5adf8e346b60f8114b/install_cursor.sh | bash || warn "Falha ao instalar Cursor."
else
  warn "SKIP_GUI=1 — pulando Termius e Cursor."
fi

if [ "${SKIP_GUI:-0}" != "1" ] && command -v gsettings >/dev/null 2>&1; then
  log "Definindo atalhos de teclado..."
  log "Configurando atalhos personalizados..."

  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings \
  "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/', \
  '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']" || warn "gsettings custom-keybindings falhou."

  log "Configurando atalho do FlameShot..."
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name "flameshot" || true
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command "flameshot gui" || true
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding "<Shift><Super>s" || true

  log "Configurando atalho do Diodon..."
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ name "diodon" || true
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ command "/usr/bin/diodon" || true
  run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ binding "<Super>v" || true

  log "Removendo atalho de emoji"
  run_as_user gsettings set org.freedesktop.ibus.panel.emoji hotkey "@as []" || true
  if command -v ibus >/dev/null 2>&1; then
    run_as_user ibus restart 2>/dev/null || true
  fi
else
  warn "SKIP_GUI=1 ou sem gsettings — pulando atalhos GNOME."
fi

# Configurar o FlameShot (cria diretório antes de escrever)
mkdir -p "$REAL_HOME/.config/flameshot"
cat <<EOF > "$REAL_HOME/.config/flameshot/flameshot.ini"
[General]
drawColor=#ff0000
drawThickness=3
EOF
chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.config/flameshot" 2>/dev/null || true

if [ -f /etc/gdm3/custom.conf ]; then
  log "Desativando Wayland e usando Xorg..."
  sed -i 's/#WaylandEnable=false/WaylandEnable=false/' /etc/gdm3/custom.conf || true
  grep -q 'WaylandEnable=false' /etc/gdm3/custom.conf || echo "WaylandEnable=false" >> /etc/gdm3/custom.conf
else
  warn "/etc/gdm3/custom.conf ausente — pulando desativação do Wayland."
fi

log "Ambiente de desenvolvimento configurado com sucesso!"

# Ferramentas via Docker
log "Instalando Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
else
  log "Docker já instalado: $(docker --version 2>/dev/null || true)"
fi

log "Adicionando $REAL_USER ao grupo docker (sem newgrp — faça logout/login)..."
usermod -aG docker "$REAL_USER" || true

ensure_container() {
  local name="$1"
  shift
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
      log "Contêiner $name já está em execução."
    else
      log "Reiniciando contêiner existente: $name"
      docker start "$name" || warn "Falha ao iniciar $name"
    fi
  else
    log "Criando contêiner $name..."
    docker run -d --name "$name" "$@" || warn "Falha ao criar $name"
  fi
}

log "Iniciando contêiner PostgreSQL..."
ensure_container postgres --restart=always \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=admin \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 \
  postgres

log "Iniciando contêiner MySQL..."
ensure_container mysql --restart=always \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=meubanco \
  -e MYSQL_USER=admin \
  -e MYSQL_PASSWORD=admin \
  -p 3306:3306 \
  mysql

log "Iniciando contêiner Redis..."
ensure_container redis --restart=always -p 6379:6379 redis

log "Concluído. Reinicie o sistema quando conveniente para aplicar grupo docker e GDM:"
echo "  sudo reboot"
log "NÃO reiniciando automaticamente (removido reboot forçado)."
