---
title: Deployment Guide
---

# Wishboard Deployment Guide

This guide is designed for system owners and event managers who want to deploy a fresh instance of Wishboard on a Raspberry Pi using a custom domain.

> [!NOTE]
> If you prefer to deploy Wishboard to the cloud rather than hosting it on local Raspberry Pi hardware, see the [**AWS Deployment Guide**](../aws-serverless/deploy-instructions.md) for deploying to AWS Serverless.

Wishboard is designed to be an offline-first kiosk application. However, to provide a seamless mobile experience for users in the venue, we use a custom domain, standard SSL certificates, and local DNS hijacking so users don't get scary browser warnings when connecting.

## Prerequisites

1. **Hardware**: A Raspberry Pi (Pi 4 or Pi 5 recommended).
2. **OS**: A fresh installation of **Raspberry Pi OS (Trixie/Debian 13 or newer)**.
3. **Domain Name**: You must own a domain name (e.g., `wishboard.example.com`).
4. **Network**: The Pi must be temporarily connected to the internet to download dependencies during the initial deployment.

---

## Step 1: Obtain SSL Certificates (DNS Challenge)

Because the Pi will eventually run offline (without a public IP), you cannot use standard HTTP validation to get an SSL certificate. You must use a **DNS Challenge** via Let's Encrypt.

SSH into your fresh Raspberry Pi and install Certbot:

```bash
sudo apt-get update
sudo apt-get install -y certbot
```

Run Certbot to request a certificate manually via DNS:

```bash
sudo certbot certonly --manual --preferred-challenges dns -d wishboard.example.com
```

Certbot will ask you to create a specific `TXT` record in your domain's DNS settings.

1. Log into your domain registrar (e.g., Namecheap, Cloudflare, Google Domains).
2. Add the `TXT` record provided by Certbot.
3. Wait a few minutes for DNS to propagate, then press `Enter` in the Certbot terminal.

If successful, your certificates will be securely saved to:
`/etc/letsencrypt/live/wishboard.example.com/`

> **Note:** The deployment scripts are hardcoded to look in `/etc/letsencrypt/live/` for the certificate matching your base domain.

---

## Step 2: Run the Deployment Orchestrator

From your **local developer machine** (not the Pi), run the unified deployment command. It configures the Pi, installs Docker Rootless, sets up the kiosk, and launches the container — the **same command on any OS** (Windows, macOS, or Linux):

```bash
npx wishboard kiosk deploy --host raspberrypi.local --mode prod --domain wishboard.example.com
```

Add `--user <name>` if your Pi login isn't `pi`, and `--dry-run` to preview the exact SSH/scp steps without executing them. `--reset-rules` re-seeds the matching rules from the profile defaults (`profiles/**/profiles.yaml`) — rules live in the database `rules` table now, not a file. It clears only the DB `rules` table and preserves uploaded images, users, and wishes (this was corrected in [#194](https://github.com/wishboards/wishboard/issues/194); it previously wiped the whole `/app/data` volume).

### Networking Modes

- `prod`: The Pi creates an isolated `Wishboard_WiFi` hotspot and hijacks DNS for your custom domain.
- `dual`: The Pi stays connected to your home Wi-Fi but broadcasts a virtual hotspot for testing.
- `dev`: Standard mode without Wi-Fi AP manipulation.

---

## Step 3: Configure Environment Variables

The deployment script automatically generates a base `.env` file and maps it securely into the Rootless Docker container.

The environment file is located on the Pi at:
`/home/wishboard/wishboard/.env`

### Customizing Variables

If you need to inject special environment variables (like changing the default admin credentials), follow these steps:

1. SSH into the Pi:

   ```bash
   ssh pi@raspberrypi.local
   ```

2. Edit the environment file (you must use `sudo` to edit as the `wishboard` service user):

   ```bash
   sudo -u wishboard nano /home/wishboard/wishboard/.env
   ```

3. Add your custom variables:

   ```env
   # Pre-populated by deployment script. WISHBOARD_DOMAIN / WISHBOARD_AP_IP are
   # read at runtime by the server and served via /api/config to the poster and
   # the kiosk Wi-Fi popup (a single image works on any domain). See #196/#197.
   WISHBOARD_DOMAIN=wishboard.example.com
   WISHBOARD_AP_IP=10.42.0.1:3000
   CORS_ALLOWED_ORIGINS=https://wishboard.example.com

   # Add your custom overrides here:
   WISHBOARD_ADMIN_USERNAME=event_admin
   WISHBOARD_ADMIN_SECRET=SuperSecretPassword123
   ```

4. Restart the Docker container so it picks up the new environment variables:

   ```bash
   sudo -u wishboard DOCKER_HOST=unix:///run/user/$(id -u wishboard)/docker.sock bash -c 'cd /home/wishboard/wishboard && docker compose restart'
   ```

---

## Updating the Application

When a new version of Wishboard is published, re-run the same unified deploy command from your developer machine. It pulls the new image and cleanly restarts the container without destroying your persisted data — the matching rules and app database in the `db_data` libSQL volume, and uploaded images in the `data/` bind mount.

```bash
# Upgrade to a specific version
npx wishboard kiosk deploy --host raspberrypi.local --mode prod --domain wishboard.example.com --app-version v1.3.0
```
