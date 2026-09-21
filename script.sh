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

# Garante dirs do usuário real graváveis (instaladores root às vezes poluem ~/.cache/~/.local)
ensure_user_writable() {
  mkdir -p "$REAL_HOME/.local/bin" "$REAL_HOME/.local/share" "$REAL_HOME/.cache"
  if [ "$REAL_USER" != "root" ]; then
    chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.local" "$REAL_HOME/.cache" 2>/dev/null || true
  fi
}

# Função para exibir mensagens
log() {
  echo -e "\e[32m[INFO]\e[0m $1"
}

warn() {
  echo -e "\e[33m[WARN]\e[0m $1"
}

APT_OPTIONS="${APT_OPTIONS:--o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold}"

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
ensure_user_writable
# Instala como REAL_USER para não criar ~/.local/cache root-owned; depois promove o binário
if [ "$REAL_USER" = "root" ]; then
  curl -fsSL https://mise.run | sh
else
  run_as_user bash -lc 'curl -fsSL https://mise.run | sh' || {
    warn "mise como usuário falhou; tentando como root..."
    curl -fsSL https://mise.run | sh
  }
fi
if [ -x /root/.local/bin/mise ]; then
  mv /root/.local/bin/mise /usr/local/bin/mise
elif [ -x "$REAL_HOME/.local/bin/mise" ]; then
  cp "$REAL_HOME/.local/bin/mise" /usr/local/bin/mise
fi
if [ ! -x /usr/local/bin/mise ]; then
  warn "mise não encontrado após install; tentando PATH..."
  MISE_FOUND=$(command -v mise || true)
  if [ -n "$MISE_FOUND" ]; then
    cp "$MISE_FOUND" /usr/local/bin/mise
  fi
fi
chown root:root /usr/local/bin/mise 2>/dev/null || true
chmod 755 /usr/local/bin/mise 2>/dev/null || true
ensure_user_writable
/usr/local/bin/mise --version
echo 'eval "$(/usr/local/bin/mise activate bash)"' | tee /etc/profile.d/mise.sh > /dev/null
chmod +x /etc/profile.d/mise.sh
append_bashrc 'eval "$(/usr/local/bin/mise activate bash)"'

# Cria alias cls (idempotente)
append_bashrc "alias cls='clear'"

# mise como REAL_USER para tool installs em ~/.local
export PATH="/usr/local/bin:$PATH"
eval "$(/usr/local/bin/mise activate bash)" || true
ensure_user_writable

log "Instalando Node.js via mise..."
run_as_user mise i node@22 || warn "Falha mise node@22 (continuando)."
run_as_user mise i node@18 || warn "Falha mise node@18 (continuando)."
run_as_user mise use --global node@22 || warn "Falha mise use node@22."

# Compiladores úteis se mise precisar buildar Python (no-op se já instalados)
apt-get install -y -qq $APT_OPTIONS build-essential curl ca-certificates 2>/dev/null || true

log "Instalando Python via mise..."
run_as_user mise i python@3.12 || warn "Falha mise python@3.12 (continuando)."
run_as_user mise i python@3.10 || warn "Falha mise python@3.10 (continuando)."
run_as_user mise use --global python@3.12 || warn "Falha mise use python@3.12."

log "Instalando Poetry..."
curl -sSL https://install.python-poetry.org | POETRY_HOME=/opt/poetry python3 - --yes || warn "Falha ao instalar Poetry."
ln -sf /opt/poetry/bin/poetry /usr/local/bin/poetry 2>/dev/null || true
poetry --version 2>/dev/null || warn "poetry não disponível no PATH."

log "Instalando Java via mise..."
run_as_user mise i java@17 || warn "Falha mise java@17 (continuando)."
run_as_user mise use --global java@17 || warn "Falha mise use java@17."

# Spotify/SpotX: somente Ubuntu 24.04 LTS (e quando GUI não estiver pulada)
if [ "${SKIP_GUI:-0}" = "1" ]; then
  warn "SKIP_GUI=1 — pulando Spotify."
else
  OS_ID=""
  OS_VERSION_ID=""
  if [ -r /etc/os-release ]; then
    OS_ID=$(. /etc/os-release; printf '%s' "${ID:-}")
    OS_VERSION_ID=$(. /etc/os-release; printf '%s' "${VERSION_ID:-}")
  fi
  if [ "$OS_ID" = "ubuntu" ] && [ "$OS_VERSION_ID" = "24.04" ]; then
    log "Instalando Spotify (SpotX) — Ubuntu 24.04 detectado..."
    bash <(curl -sSL https://spotx-official.github.io/run.sh) --installdeb --stable || warn "Falha ao instalar Spotify (continuando)."
  else
    warn "Spotify/SpotX pulado: requer Ubuntu 24.04 (detectado: ID=${OS_ID:-desconhecido} VERSION_ID=${OS_VERSION_ID:-desconhecido})."
  fi
fi

log "Instalando yarn via npm (global; evita pacote apt/cmdtest)..."
# Aviso se yarn/cmdtest do apt já estiverem presentes (conflito clássico no Ubuntu)
if dpkg -l 2>/dev/null | awk '/^ii/ {print $2}' | grep -qx 'yarn'; then
  warn "Pacote apt 'yarn' detectado — pode ser cmdtest. Prefira 'npm i -g yarn' (mise/npm)."
fi
if dpkg -l 2>/dev/null | awk '/^ii/ {print $2}' | grep -qx 'cmdtest'; then
  warn "Pacote apt 'cmdtest' detectado — o binário 'yarn' do cmdtest NÃO é o Yarn JS. Considere: apt-get remove -y cmdtest"
fi
if command -v yarn >/dev/null 2>&1; then
  # Se o yarn no PATH for o stub do cmdtest, avisa
  if yarn --version 2>&1 | grep -Eq '^[0-9]+\.[0-9]+'; then
    : # parece Yarn JS válido
  else
    warn "Comando yarn no PATH nao parece ser o Yarn do Node (possivel cmdtest)."
  fi
fi
# Garante npm no PATH após mise
if run_as_user bash -lc 'command -v npm >/dev/null'; then
  run_as_user bash -lc 'npm install --global yarn'
  run_as_user bash -lc 'yarn --version' || warn "yarn global instalado, mas 'yarn --version' falhou no PATH do usuário."
else
  warn "npm não encontrado; pulando yarn global via npm."
fi

log "Adicionando repositórios..."
export DEBIAN_FRONTEND=noninteractive
# Evita prompts interativos de conffile (ex.: /etc/fuse.conf) que travam CI/VMs headless
export APT_OPTIONS='-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold'
apt-get update -qq || true
apt-get install -y -qq $APT_OPTIONS software-properties-common ca-certificates curl wget gnupg apt-transport-https 2>/dev/null || true
add-apt-repository ppa:diodon-team/stable -y > /dev/null 2>&1 || warn "PPA diodon indisponível neste sistema."
add-apt-repository ppa:tomtomtom/yt-dlp -y > /dev/null 2>&1 || warn "PPA yt-dlp indisponível neste sistema."

APT_APPS=(
  ffmpeg
  flameshot
  diodon
  btop
  folder-color
  gnome-sushi
  yt-dlp
  mysql-client
)

log "Instalando pacotes apt..."
apt-get update -qq || true
for app in "${APT_APPS[@]}"; do
  log "Instalando $app..."
  if ! apt-get install -y $APT_OPTIONS "$app" > /dev/null; then
    warn "Falha ao instalar pacote apt: $app (continuando)."
  fi
done

if [ "${SKIP_GUI:-0}" != "1" ] && command -v nautilus >/dev/null 2>&1; then
  run_as_user nautilus -q 2>/dev/null || true
fi

log "Instalando Zoxide..."
install_zoxide_ok=0
# 1) Instalador oficial (pode falhar por rate limit do GitHub)
if curl -fsSL --retry 2 --retry-delay 2 https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh -o /tmp/zoxide-install.sh 2>/dev/null; then
  if sh /tmp/zoxide-install.sh; then
    install_zoxide_ok=1
    log "Zoxide instalado via install.sh oficial."
  else
    warn "install.sh do Zoxide falhou (possível rate limit do GitHub)."
  fi
  rm -f /tmp/zoxide-install.sh
else
  warn "Não foi possível baixar install.sh do Zoxide (rede/GitHub)."
fi

# 2) Fallback apt
if [ "$install_zoxide_ok" -ne 1 ]; then
  log "Tentando Zoxide via apt..."
  if apt-get install -y $APT_OPTIONS zoxide > /dev/null 2>&1; then
    install_zoxide_ok=1
    log "Zoxide instalado via apt."
  else
    warn "apt não conseguiu instalar zoxide."
  fi
fi

# 3) Fallback: copiar binário do mise (se houver)
if [ "$install_zoxide_ok" -ne 1 ]; then
  log "Tentando Zoxide via mise..."
  if run_as_user bash -lc 'command -v mise >/dev/null && mise install zoxide && mise use --global zoxide'; then
    # Localiza binário do zoxide no cache mise do usuário
    ZOXIDE_BIN=""
    for cand in       "$REAL_HOME/.local/share/mise/shims/zoxide"       "$REAL_HOME/.local/bin/zoxide"       "/usr/local/bin/zoxide"; do
      if [ -x "$cand" ]; then ZOXIDE_BIN="$cand"; break; fi
    done
    if [ -z "$ZOXIDE_BIN" ]; then
      ZOXIDE_BIN=$(run_as_user bash -lc 'command -v zoxide' 2>/dev/null || true)
    fi
    if [ -n "$ZOXIDE_BIN" ] && [ -x "$ZOXIDE_BIN" ]; then
      mkdir -p "$REAL_HOME/.local/bin"
      if [ "$ZOXIDE_BIN" != "$REAL_HOME/.local/bin/zoxide" ]; then
        cp "$ZOXIDE_BIN" "$REAL_HOME/.local/bin/zoxide" 2>/dev/null || true
        chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.local/bin/zoxide" 2>/dev/null || true
      fi
      install_zoxide_ok=1
      log "Zoxide obtido via mise ($ZOXIDE_BIN)."
    else
      warn "mise instalou zoxide, mas binário não encontrado."
    fi
  else
    warn "Fallback mise para zoxide também falhou."
  fi
fi

# Normaliza ownership se install.sh rodou como root
if [ -x /root/.local/bin/zoxide ] && [ "$REAL_USER" != "root" ]; then
  mkdir -p "$REAL_HOME/.local/bin"
  cp /root/.local/bin/zoxide "$REAL_HOME/.local/bin/zoxide"
  chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.local"
fi

if [ "$install_zoxide_ok" -eq 1 ]; then
  append_bashrc 'eval "$(zoxide init bash)"'
  log "Zoxide configurado no bashrc."
else
  warn "Zoxide não pôde ser instalado (continuando sem abortar o script)."
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
    apt-get install -y $APT_OPTIONS flatpak > /dev/null || warn "Não foi possível instalar flatpak."
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
  sh /tmp/get-docker.sh || warn "get.docker.com falhou; tentando apt..."
  rm -f /tmp/get-docker.sh
  if ! command -v docker >/dev/null 2>&1; then
    apt-get install -y $APT_OPTIONS docker.io docker-compose-v2 > /dev/null 2>&1 || warn "Falha ao instalar docker via apt."
  fi
else
  log "Docker já instalado: $(docker --version 2>/dev/null || true)"
fi

# Garante daemon (systemd ou dockerd manual — ambientes sem systemd)
if ! docker info >/dev/null 2>&1; then
  log "Docker daemon não responde; tentando iniciar..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start docker 2>/dev/null || true
    systemctl enable docker 2>/dev/null || true
  fi
  if ! docker info >/dev/null 2>&1 && command -v dockerd >/dev/null 2>&1; then
    warn "Iniciando dockerd em background (sem systemd)..."
    mkdir -p /var/run /var/log
    dockerd >/tmp/dockerd-setup.log 2>&1 &
    for i in $(seq 1 30); do
      docker info >/dev/null 2>&1 && break
      sleep 1
    done
  fi
fi
if docker info >/dev/null 2>&1; then
  log "Docker daemon OK."
else
  warn "Docker daemon indisponível — contêineres podem falhar."
fi

log "Adicionando $REAL_USER ao grupo docker (sem newgrp — faça logout/login)..."
getent group docker >/dev/null 2>&1 || groupadd docker || true
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
