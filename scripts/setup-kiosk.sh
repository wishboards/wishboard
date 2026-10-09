#!/bin/bash
set -e

echo "=== Wishboard Raspberry Pi Kiosk Setup Script ==="

MODE="${1:-prod}"
DOMAIN_NAME="${2:-wishboard.painless-computing.com}"
REMOTE_TEMP_DIR="${3:-/tmp}"
AP_IP="10.42.0.1"

echo "Deployment Mode: $MODE"
echo "Domain Name: $DOMAIN_NAME"
echo "Remote Temp Dir: $REMOTE_TEMP_DIR"

# 1. Create wishboard user if it doesn't exist
if id "wishboard" &>/dev/null; then
  echo "User wishboard already exists."
else
  echo "Creating wishboard user..."
  sudo adduser --disabled-password --gecos "Wishboard kiosk user" wishboard
fi

# Add wishboard to necessary groups
echo "Assigning groups..."
sudo usermod -a -G video,audio,input,tty,render wishboard

# 2. Setup the application directory
echo "Creating application folder..."
WISHBOARD_HOME=$(getent passwd wishboard | cut -d: -f6)
sudo mkdir -p $WISHBOARD_HOME/wishboard
sudo chown -R wishboard:wishboard $WISHBOARD_HOME

echo "Installing graphical kiosk and network dependencies..."
sudo apt-get update
sudo apt-get install -y swaybg chromium network-manager iw nginx
# Attempt to install brotli modules, but do not fail if unavailable
sudo apt-get install -y libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static || echo "Warning: Brotli Nginx modules could not be installed."

echo "Checking for Docker CE Rootless dependencies..."
# We unconditionally ensure Docker CE, rootless-extras, uidmap and systemd-container are installed.
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras uidmap systemd-container

echo "Enabling systemd lingering for wishboard user..."
sudo loginctl enable-linger wishboard

echo "Initializing Rootless Docker for wishboard user..."
# Use machinectl to spawn a proper systemd user session shell and install rootless docker
sudo machinectl shell wishboard@ /bin/bash -c "PATH=/usr/bin:/sbin:/usr/sbin:\$PATH dockerd-rootless-setuptool.sh install" || true
sudo systemctl --user -M wishboard@ restart docker 2>/dev/null || true

echo "Exporting DOCKER_HOST for wishboard user..."
sudo -u wishboard bash -c 'grep -q "DOCKER_HOST" ~/.bashrc || echo "export DOCKER_HOST=unix:///run/user/\$(id -u)/docker.sock" >> ~/.bashrc'

echo "Configuring Wireless Access Point (Hotspot) for Mode: $MODE..."

# Ensure NetworkManager keeps Wi-Fi power saving disabled on all interfaces
sudo tee /etc/NetworkManager/conf.d/disable-wifi-powersave.conf > /dev/null << 'EOF'
[connection]
wifi.powersave = 2
EOF
sudo /sbin/iw dev wlan0 set power_save off 2>/dev/null || true

if [[ "$MODE" = "dev" ]]; then
  echo "Dev Mode: Skipping all network modifications. Using existing connections."
elif [[ "$MODE" = "dual" ]]; then
  # Create a virtual AP interface for dual mode concurrency
  echo "Setting up virtual ap0 interface for AP/STA concurrency..."
  sudo tee /usr/local/bin/enable-ap0.sh > /dev/null << 'EOF'
#!/bin/bash
set -e
# Create the virtual AP interface for single-radio AP/STA concurrency.
# Fail loud: a creation failure must surface as a FAILED unit, not a silently
# dead hotspot. The old "|| true" masked exactly this and left ap0 missing.
if ! iw dev ap0 info >/dev/null 2>&1; then
  iw dev wlan0 interface add ap0 type __ap
fi
ip link set ap0 up
# Ensure NetworkManager manages ap0 even if this ever runs after NM has started.
nmcli device set ap0 managed yes 2>/dev/null || true
EOF
  sudo chmod +x /usr/local/bin/enable-ap0.sh

  sudo tee /etc/systemd/system/wifi-ap0.service > /dev/null << 'EOF'
[Unit]
Description=Create virtual ap0 interface for Wi-Fi AP
# wlan0 must exist before a vif can be added to it (a likely cause of the old
# silent boot-time failure), and NM must not start until ap0 exists so it
# adopts ap0 as a managed device from the outset.
After=sys-subsystem-net-devices-wlan0.device
Wants=sys-subsystem-net-devices-wlan0.device
Before=NetworkManager.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/enable-ap0.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable wifi-ap0.service
  sudo systemctl start wifi-ap0.service
  
  if nmcli con show "Hotspot" > /dev/null 2>&1; then
    echo "Hotspot connection already exists. Deleting to recreate with correct interface."
    sudo nmcli con delete "Hotspot" || true
  fi

  sudo nmcli con add type wifi ifname ap0 con-name Hotspot autoconnect yes ssid Wishboard_WiFi
  sudo nmcli con modify Hotspot 802-11-wireless.mode ap ipv4.method shared
  sudo nmcli con modify Hotspot wifi-sec.key-mgmt wpa-psk wifi-sec.psk "wishboard2026"
  sudo nmcli con modify Hotspot connection.autoconnect-priority 100

  # Single-radio AP/STA concurrency requires the AP (ap0) and the wlan0 client
  # to share ONE channel (iw list: "#{ AP } <= 1 ... #channels <= 1"). Leaving
  # the channel unset makes NM default the AP to 2.4 GHz, which collides with a
  # 5 GHz home connection and silently fails to start. Install a NetworkManager
  # dispatcher that keeps ap0 pinned to wlan0's current channel, so the AP
  # follows the router if it ever moves channels.
  sudo tee /etc/NetworkManager/dispatcher.d/90-wishboard-ap-channel.sh > /dev/null << 'EOF'
#!/bin/bash
IFACE="$1"; ACTION="$2"
[[ "$IFACE" = "wlan0" ]] || exit 0
case "$ACTION" in up|dhcp4-change|connectivity-change) ;; *) exit 0 ;; esac
ch=$(iw dev wlan0 info 2>/dev/null | awk '/channel/ {print $2; exit}')
[[ -n "$ch" ]] || exit 0
if [[ "$ch" -gt 14 ]]; then band=a; else band=bg; fi
cur=$(nmcli -g 802-11-wireless.channel con show Hotspot 2>/dev/null)
if [[ "$cur" != "$ch" ]]; then
  logger -t wishboard-ap "pinning ap0 hotspot to wlan0 channel $ch (band $band)"
  nmcli con modify Hotspot 802-11-wireless.band "$band" 802-11-wireless.channel "$ch"
  nmcli device set ap0 managed yes 2>/dev/null || true
  nmcli con up Hotspot || true
fi
EOF
  sudo chmod 755 /etc/NetworkManager/dispatcher.d/90-wishboard-ap-channel.sh

  # Bring the AP up now on wlan0's current channel; the dispatcher keeps it in
  # sync thereafter. wlan0 is already associated at setup time.
  CURRENT_CH=$(iw dev wlan0 info 2>/dev/null | awk '/channel/ {print $2; exit}')
  if [[ -n "$CURRENT_CH" ]]; then
    if [[ "$CURRENT_CH" -gt 14 ]]; then AP_BAND=a; else AP_BAND=bg; fi
    sudo nmcli con modify Hotspot 802-11-wireless.band "$AP_BAND" 802-11-wireless.channel "$CURRENT_CH"
    echo "Pinned Hotspot to wlan0 channel $CURRENT_CH (band $AP_BAND)."
  fi
  sudo nmcli device set ap0 managed yes 2>/dev/null || true
  sudo nmcli con up Hotspot || true
  echo "Dual Mode Hotspot configured on ap0 (channel follows wlan0)."
fi

echo "Generating network utility scripts..."

sudo tee /home/pi/convert-to-prod.sh > /dev/null << 'EOF'
#!/bin/bash
echo "Converting networking to PROD mode (isolated hotspot)..."
sudo nmcli con delete Hotspot || true
sudo systemctl disable wifi-ap0.service || true
sudo systemctl stop wifi-ap0.service || true
sudo rm -f /etc/systemd/system/wifi-ap0.service /usr/local/bin/enable-ap0.sh /etc/NetworkManager/dispatcher.d/90-wishboard-ap-channel.sh
sudo systemctl daemon-reload
sudo iw dev ap0 del || true

sudo nmcli con add type wifi ifname wlan0 con-name Hotspot autoconnect yes ssid Wishboard_WiFi
sudo nmcli con modify Hotspot 802-11-wireless.mode ap ipv4.method shared
sudo nmcli con modify Hotspot wifi-sec.key-mgmt wpa-psk wifi-sec.psk "wishboard2026"
sudo nmcli con modify Hotspot connection.autoconnect-priority 100
sudo nmcli con up Hotspot
echo "Prod Mode Hotspot successfully configured on wlan0. You are now disconnected from your home network."
EOF
sudo chmod +x /home/pi/convert-to-prod.sh
sudo chown pi:pi /home/pi/convert-to-prod.sh || true

sudo tee /home/pi/restore-network.sh > /dev/null << 'EOF'
#!/bin/bash
echo "Restoring NetworkManager configuration..."
sudo nmcli con delete Hotspot || true
sudo systemctl disable wifi-ap0.service || true
sudo systemctl stop wifi-ap0.service || true
sudo rm -f /etc/systemd/system/wifi-ap0.service /usr/local/bin/enable-ap0.sh /etc/NetworkManager/dispatcher.d/90-wishboard-ap-channel.sh
sudo systemctl daemon-reload
sudo iw dev ap0 del || true
sudo systemctl restart NetworkManager
echo "Network fully restored to standard client mode."
EOF
sudo chmod +x /home/pi/restore-network.sh
sudo chown pi:pi /home/pi/restore-network.sh || true

echo "Configuring DNS and Nginx Reverse Proxy..."

# Always configure Nginx for external port forwarding
BASE_DOMAIN=$(echo "$DOMAIN_NAME" | grep -oE '[^.]+\.[^.]+$')
if [[ -d "/etc/letsencrypt/live/$DOMAIN_NAME" ]]; then
    CERT_DIR="/etc/letsencrypt/live/$DOMAIN_NAME"
elif [[ -d "/etc/letsencrypt/live/$BASE_DOMAIN" ]]; then
    CERT_DIR="/etc/letsencrypt/live/$BASE_DOMAIN"
else
    ALT_DIR=$(ls -d /etc/letsencrypt/live/*/ 2>/dev/null | head -n 1)
    if [[ -n "$ALT_DIR" ]]; then
        CERT_DIR=${ALT_DIR%/}
    fi
fi

NGINX_CONF="/etc/nginx/sites-available/wishboard"

# Check if Brotli Nginx module is installed
ENABLE_BROTLI=""
if [[ -d /etc/nginx/modules-enabled ]] && ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
    ENABLE_BROTLI="    brotli on;
    brotli_comp_level 6;
    brotli_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm;"
fi

sudo tee "$NGINX_CONF" > /dev/null <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN_NAME;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN_NAME;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Gzip settings
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_buffers 16 8k;
    gzip_http_version 1.1;
    gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm;

    # Brotli settings
$ENABLE_BROTLI

    location /assets/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        proxy_hide_header Cache-Control;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

if [[ ! -f "/etc/nginx/sites-enabled/wishboard" ]]; then
    sudo ln -s "$NGINX_CONF" "/etc/nginx/sites-enabled/wishboard"
fi
sudo systemctl reload nginx || true
echo "Nginx reverse proxy for $DOMAIN_NAME configured."

# Configure local DNS hijacking only in prod/dual
if [[ "$MODE" = "dev" ]]; then
    echo "Dev Mode: Disabling local DNS redirection..."
    sudo rm -f "/etc/NetworkManager/dnsmasq-shared.d/wishboard.conf"
    sudo systemctl reload NetworkManager || true
    echo "Local DNS redirection disabled."
else
    echo "Prod/Dual Mode: Configuring local DNS redirection for domain $DOMAIN_NAME at IP $AP_IP..."
    DNS_CONF="/etc/NetworkManager/dnsmasq-shared.d/wishboard.conf"
    if [[ -d "/etc/NetworkManager/dnsmasq-shared.d" ]]; then
        echo "address=/$DOMAIN_NAME/$AP_IP" | sudo tee "$DNS_CONF" > /dev/null
    elif [[ -d "/etc/dnsmasq.d" ]]; then
        echo "address=/$DOMAIN_NAME/$AP_IP" | sudo tee "/etc/dnsmasq.d/wishboard.conf" > /dev/null
    fi
    sudo systemctl reload NetworkManager || true
    echo "Local DNS redirection enabled."
fi

# 3. (Systemd Node Service Removed in favor of Docker --restart always)

# 4. Configure LightDM auto-login
echo "Configuring auto-login in LightDM..."
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"

# Hardcode to Wayland (labwc) since we only target Trixie+
KIOSK_SESSION="labwc"
echo "Targeting Wayland graphics stack. Using session: $KIOSK_SESSION"

if [[ -f "$LIGHTDM_CONF" ]]; then
  # Remove existing autologin settings to prevent conflicts
  sudo sed -i '/^autologin-user=/d' "$LIGHTDM_CONF"
  sudo sed -i '/^autologin-user-timeout=/d' "$LIGHTDM_CONF"
  sudo sed -i '/^autologin-session=/d' "$LIGHTDM_CONF"
  
  # Insert under [Seat:*]
  sudo sed -i "/^\[Seat:\*\]/a autologin-user=wishboard\nautologin-user-timeout=0\nautologin-session=$KIOSK_SESSION" "$LIGHTDM_CONF"
  echo "Auto-login for user 'wishboard' configured in LightDM."
else
  echo "WARNING: /etc/lightdm/lightdm.conf not found. Auto-login might need manual configuration."
fi

# 5. Disable TTY1 autologin (prevent bypass via Ctrl-Alt-F1)
echo "Disabling TTY1 autologin for security..."
TTY_OVERRIDE="/etc/systemd/system/getty@tty1.service.d/autologin.conf"
TTY_RASPI="/etc/systemd/system/getty@tty1.service.d/override.conf"
if [[ -f "$TTY_OVERRIDE" ]]; then
  sudo rm -f "$TTY_OVERRIDE"
  echo "Removed $TTY_OVERRIDE"
fi
if [[ -f "$TTY_RASPI" ]]; then
  sudo rm -f "$TTY_RASPI"
  echo "Removed $TTY_RASPI"
fi
sudo systemctl daemon-reload
sudo systemctl restart getty@tty1.service

# 6. Configure autostart for Wayland (labwc)
echo "Configuring labwc Wayland autostart..."
sudo -u wishboard mkdir -p $WISHBOARD_HOME/.config/labwc
sudo -u wishboard tee $WISHBOARD_HOME/.config/labwc/autostart > /dev/null << 'EOF'
#!/bin/bash
swaybg -c "#000000" &
while ! curl -s http://localhost:3000 > /dev/null; do
  sleep 1
done
while true; do
  chromium --kiosk --noerrdialogs --disable-infobars --app=http://localhost:3000/#display?kiosk=true --disable-translate --disable-features=Translate --fast --fast-start --password-store=basic --disk-cache-size=33554432
  sleep 1
done
EOF
sudo chmod +x $WISHBOARD_HOME/.config/labwc/autostart

sudo -u wishboard tee $WISHBOARD_HOME/.config/labwc/rc.xml > /dev/null << 'EOF'
<?xml version="1.0"?>
<labwc_config>
  <keyboard>
    <keybind key="C-A-q"><action name="Execute"><command>dm-tool switch-to-greeter</command></action></keybind>
    <keybind key="C-A-Q"><action name="Execute"><command>dm-tool switch-to-greeter</command></action></keybind>
  </keyboard>
  <mouse><!-- Empty mouse block --></mouse>
</labwc_config>
EOF


echo "=== Setup Completed! ==="

echo "Configuring TTY Watchdog Service..."
# Create watchdog script
sudo tee /usr/local/bin/tty-watchdog.sh > /dev/null << 'EOF'
#!/bin/bash
IDLE_COUNT=0
while true; do
  ACTIVE_TTY=$(cat /sys/class/tty/tty0/active 2>/dev/null || echo "")
  
  if [[ "$ACTIVE_TTY" =~ ^tty[1-6]$ ]]; then
    IDLE_COUNT=$((IDLE_COUNT + 10))
    if [[ "$IDLE_COUNT" -ge 60 ]]; then
      echo "TTY idle timeout reached. Switching back to graphical session."
      chvt 7 || true
      IDLE_COUNT=0
    fi
  else
    # We are on a GUI. Check loginctl for active session status
    ACTIVE_SESSION=$(loginctl show-seat seat0 -p ActiveSession --value 2>/dev/null || echo "")
    if [[ -n "$ACTIVE_SESSION" ]]; then
      SESSION_USER=$(loginctl show-session "$ACTIVE_SESSION" -p Name --value 2>/dev/null || echo "")
      IDLE_HINT=$(loginctl show-session "$ACTIVE_SESSION" -p IdleHint --value 2>/dev/null || echo "no")
      
      if [[ "$SESSION_USER" != "wishboard" ]]; then
        if [[ "$SESSION_USER" = "lightdm" ]]; then
           # Greeter is active, count up unconditionally since they should log in or leave
           IDLE_COUNT=$((IDLE_COUNT + 10))
        elif [[ "$IDLE_HINT" = "yes" ]]; then
           # Pi user is logged in but systemd marked them idle
           IDLE_COUNT=$((IDLE_COUNT + 10))
        else
           IDLE_COUNT=0
        fi
        
        if [[ "$IDLE_COUNT" -ge 60 ]]; then
           echo "Non-kiosk session is idle. Forcing switch to wishboard."
           dm-tool switch-to-user wishboard || chvt 7
           IDLE_COUNT=0
        fi
      else
        IDLE_COUNT=0
      fi
    else
      IDLE_COUNT=0
    fi
  fi
  sleep 10
done
EOF
sudo chmod +x /usr/local/bin/tty-watchdog.sh

# Create watchdog systemd service
sudo tee /etc/systemd/system/tty-watchdog.service > /dev/null << 'EOF'
[Unit]
Description=TTY Watchdog (forces display back to GUI if idle on text console)
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/local/bin/tty-watchdog.sh
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tty-watchdog.service
sudo systemctl start tty-watchdog.service
echo "TTY Watchdog configured and started."
