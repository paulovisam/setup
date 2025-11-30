#!/bin/bash
set -euo pipefail

#Verificar se foi executado com sudo
if [ "$EUID" -ne 0 ]; then
  echo "Você precisa de superpoderes (root) pra rodar este script 🧙‍" 
  echo "Execute: sudo ./script.sh"
  exit 1
fi

# Função para exibir mensagens
log() {
  echo -e "\e[32m[INFO]\e[0m $1"
}

# Configuração do mise
curl https://mise.run | sh

#Instala o mise para todos os usuários
sudo mv /root/.local/bin/mise /usr/local/bin/
sudo chown root:root /usr/local/bin/mise
sudo chmod 755 /usr/local/bin/mise
/usr/local/bin/mise --version
echo 'eval "$(/usr/local/bin/mise activate bash)"' | sudo tee /etc/profile.d/mise.sh > /dev/null
sudo chmod +x /etc/profile.d/mise.sh
source ~/.bashrc

#Cria alias cls
echo "alias cls='clear'" >> ~/.bashrc
source ~/.bashrc

log "Instalando Node.js via mise..."
mise i node@22
mise i node@18
mise use --global node@22

log "Instalando Python via mise..."
mise i python@3.12
mise i python@3.10
mise use --global python@3.12

log "Instalando Java via mise..."
mise i java@17
mise use --global java@17

log "Instalando Spotify..."
bash <(curl -sSL https://spotx-official.github.io/run.sh) --installdeb --stable

log "Instalando yarn"
npm install --global yarn

log "Adicionando repositórios..."
sudo add-apt-repository ppa:diodon-team/stable -y > /dev/null
sudo add-apt-repository ppa:tomtomtom/yt-dlp -y > /dev/null

APT_APPS=(
  ffmpeg
  flameshot
  diodon
  btop
  folder-color
  yarn
  gnome-sushi
  zoxide
  yt-dlp
  mysql-client
)
log "Instalando pacotes apt..."
sudo apt-get update
for app in "${FLATPAK_APPS[@]}"; do
  log "Instalando $app..."
  sudo apt install "$app" -y > /dev/null
done

eval "$(zoxide init bash)"
nautilus -q #Fechar o Nautilus para aplicar as mudanças

log "Instalando React Native Debugger..."
wget -q https://github.com/jhen0409/react-native-debugger/releases/download/v0.14.0/react-native-debugger_0.14.0_amd64.deb -O react-native-debugger.deb
sudo dpkg -i react-native-debugger.deb || sudo apt-get install -f -y
rm -f react-native-debugger.deb



#Verificar se LibreOffice já está instalado
if dpkg -l | grep libreoffice; then
  log "LibreOffice já está instalado."
else
  log "Instalando LibreOffice..."
  flatpak install flathub org.libreoffice.LibreOffice -y > /dev/null
fi

# Lista de pacotes Flatpak a serem instalados
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
  com.termius.Termius
  com.github.ADBeveridge.Raider
  com.github.tchx84.Flatseal
  io.missioncenter.MissionCenter
  com.stremio.Stremio
  io.github.peazip.PeaZip
)

# Loop para instalar os pacotes Flatpak
log "Instalando pacotes Flatpak..."
for app in "${FLATPAK_APPS[@]}"; do
  log "Instalando $app..."
  flatpak install flathub "$app" -y > /dev/null
done

log "Instalando Cursor..."
curl -s https://gist.githubusercontent.com/paulovisam/abc5cbbd187a101d90bd71c5e0fb0eba/raw/c52aa0bfc302e85ee2094c5adf8e346b60f8114b/install_cursor.sh | bash

log "Definindo atalhos de teclado..."

# Configurar o atalho
log "Configurando atalhos personalizados..."

# Define a lista completa de atalhos
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings \
"['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/', \
'/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']"

# Atalho do FlameShot
log "Configurando atalho do FlameShot..."
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name "flameshot"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command "flameshot gui"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding "<Shift><Super>s"

# Atalho do Diodon
log "Configurando atalho do Diodon..."
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ name "diodon"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ command "/usr/bin/diodon"
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ binding "<Super>v"


log "Removendo atalho de emoji"
gsettings set org.freedesktop.ibus.panel.emoji hotkey "@as []"
ibus restart

log "Desativando Wayland e usando Xorg..."
sudo sed -i 's/#WaylandEnable=false/WaylandEnable=false/' /etc/gdm3/custom.conf || echo "WaylandEnable=false" | sudo tee -a /etc/gdm3/custom.conf > /dev/null

log "Ambiente de desenvolvimento configurado com sucesso!"


# Ferramentas via Docker
log "Instalando Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

log "Testando instalação do Docker..."
sudo usermod -aG docker "$USER"
newgrp docker

# Contêineres com Docker
log "Iniciando contêiner PostgreSQL..."
docker run -d --name postgres --restart=always \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=admin \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 postgres

log "Iniciando contêiner MySQL..."
docker run -d --name mysql --restart=always \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=meubanco \
  -e MYSQL_USER=admin \
  -e MYSQL_PASSWORD=admin \
  -p 3306:3306 mysql

log "Iniciando contêiner Redis..."
docker run -d --name redis --restart=always -p 6379:6379 redis


sudo reboot

