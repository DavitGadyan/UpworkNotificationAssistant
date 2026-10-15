# 1. Prepare the Ubuntu machine

Run everything as your normal admin user. The examples use the user `david` and the hostname `upbox`; change them to yours.

## 1. Install Ubuntu Server
1. Install **Ubuntu Server 24.04 LTS**. During setup, tick **Install OpenSSH server**.
2. Give it a stable, unique hostname. The worker's lease in Supabase is owned by the hostname, so it must differ from the Mac's:
   ```bash
   sudo hostnamectl set-hostname upbox
   ```
3. Give it a fixed LAN address: either a DHCP reservation in your router (simplest) or netplan.
4. From the Mac, check you can log in: `ssh david@upbox.local` (or the IP address).
   Optional: `ssh-copy-id david@upbox.local` so you don't need a password.

## 2. BIOS: power on after a power cut
In the BIOS/UEFI setup, set **Restore on AC Power Loss / After Power Failure** to **Power On** (Last State also works).
If the box supports it, turn on **Wake-on-LAN** as a fallback. Without one of these, a power cut stops the assistant until someone presses the button.

## 3. Base packages and Node 22
```bash
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install git curl ca-certificates build-essential python3 rsync jq
# Node 22 LTS (NodeSource). Do not use the distro's nodejs package: it is too old.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v      # v22.x
npm -v
```
`build-essential` and `python3` are needed because `npm ci` compiles `better-sqlite3`, which is only used by local/demo mode but is still a dependency.

## 4. Never sleep
On a server image this is usually already the case, but make sure (on a desktop install, closing the lid or idling would suspend it):
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
# Laptop as a server: ignore the lid
sudo sed -i 's/^#\?HandleLidSwitch=.*/HandleLidSwitch=ignore/; s/^#\?HandleLidSwitchExternalPower=.*/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
systemctl status sleep.target | head -3     # "Loaded: masked"
```

## 5. Time zone and clock
```bash
sudo timedatectl set-timezone Asia/Yerevan
timedatectl          # "System clock synchronized: yes"
```
The app stores UTC and uses `DEFAULT_TIMEZONE` from `.env` for quiet hours and daily caps, so the box's zone only affects how log timestamps look. The clock **must** be synced: Upwork OAuth and the lease depend on it.

## 6. Wait for the network at boot
The services start after `network-online.target`. Make sure that target really waits:
```bash
# Ubuntu Server uses systemd-networkd:
systemctl is-enabled systemd-networkd-wait-online.service
# Desktop/NetworkManager installs instead:
systemctl is-enabled NetworkManager-wait-online.service
```
One of them should show `enabled`. If neither does, enable the one that matches your network stack.

## 7. Firewall
Nothing needs to be reachable from outside, so allow only SSH:
```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

## 8. Automatic security updates
```bash
sudo apt -y install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades       # answer "Yes"
# Optional: allow a reboot at 04:30 when a kernel update needs one. The services come back by themselves.
echo 'Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";' | sudo tee /etc/apt/apt.conf.d/52up-assistant-reboot
```
Node is **not** upgraded across major versions automatically (NodeSource pins `node_22.x`), so an update never breaks the app.

## 9. Keep the logs bounded
journald keeps logs on disk. Cap them so a chatty week can't fill the disk:
```bash
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\nMaxRetentionSec=30day\n' | sudo tee /etc/systemd/journald.conf.d/up-assistant.conf
sudo systemctl restart systemd-journald
```

## 10. Remote access from outside home (optional)
For checking on the box or opening the dashboard away from home, without port forwarding, use [Tailscale](https://tailscale.com/download/linux):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```
Install Tailscale on the Mac and iPhone too. You can then `ssh david@upbox` from anywhere on your tailnet.

Next: [02-app.md](02-app.md)
