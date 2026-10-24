# Putting Journey Simulator online (no technical knowledge needed)

You need a small rented server. It costs about €5–25 a month, and the whole setup takes about 20 minutes.

## Step 1 — Rent a server

**Hetzner Cloud** is the cheapest good option. https://www.hetzner.com/cloud

1. Create an account and open the **Cloud Console**. Create a project, then click **Add Server**.
2. **Location:** any location near you.
3. **Image:** choose **Ubuntu 24.04**.
4. **Type:** choose **Shared vCPU → x86 → CX22** (2 vCPU, 4 GB RAM). A bigger server is fine too, but it needs **at least 4 GB of RAM**.
5. Leave everything else as it is and click **Create & Buy now**.
6. Copy the server's **IPv4 address** (it looks like `65.21.100.42`). Hetzner also emails you a root password.

DigitalOcean works the same way: create a **Droplet** with **Ubuntu 24.04**, **4 GB RAM**.

## Easiest option — no password needed

When you create the server in Hetzner, scroll down to **Cloud config** and paste this into the box:

```
#cloud-config
runcmd:
  - curl -fsSL https://raw.githubusercontent.com/niharsayshell/journey-simulator/main/deploy/install.sh | bash > /var/log/journey-install.log 2>&1
```

Click **Create & Buy now**, wait about 20 minutes, then open `https://` followed by the server's IP address with dashes instead of dots, followed by `.sslip.io`. For example, IP `65.21.100.42` becomes `https://65-21-100-42.sslip.io`. Then continue at Step 4.

## Step 2 — Open the server's console

In the Hetzner Cloud Console, click your server, then the **`>_` (Console)** icon at the top right. A black window opens.

- Login: `root`
- Password: the one from the email. Typing a password shows nothing on screen, which is normal. Press Enter when you've typed it.
- On the first login it may ask you to choose a new password. Type the old one once, then the new one twice.

## Step 3 — Paste one command

Copy this whole line and paste it into the console. If Ctrl+V doesn't work, use the console's paste button or right-click. Then press **Enter**.

```
curl -fsSL https://raw.githubusercontent.com/niharsayshell/journey-simulator/main/deploy/install.sh | bash
```

Wait 10–15 minutes. When it finishes you will see a box that says **"Journey Simulator is live!"** with your link. The link looks like:

```
https://65-21-100-42.sslip.io
```

## Step 4 — Create your account

Open the link and click **Create an account**. **The first account becomes the administrator, and sign-up then closes**, so nobody else can register.

## Step 5 — Try the demo

1. **Projects → New project**
2. **Website authorization → Add a website**:
   - Host: `demo.65-21-100-42.sslip.io` (use your own numbers)
   - Verification method: Hosted file
   - Scheme: https
3. Copy the value it shows. Open the **"its owner page"** link, paste the value, and click **Publish**. Back in the tool, click **Verify now**.
4. **Scenarios → New scenario → Load Demo Shop example → Save scenario → Run → Start**.
5. To try proxies, go to **Proxy profiles** and add host `test-proxy`, port `8899`, then click **Test**.

## Updating later

When new features are added, open the console again and paste the same command. Your data is kept.

## If something goes wrong

Paste these two commands into the console and send the output to Claude:

```
cd /opt/journey-simulator && docker compose --project-name journey -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod ps
cd /opt/journey-simulator && docker compose --project-name journey -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod logs --tail=80
```

## Using your own domain (optional)

1. At your domain provider, create two **A records** that point to the server's IP: `qa.yourdomain.com` and `demo.qa.yourdomain.com`.
2. Run this command once:

```
rm /opt/journey-simulator/deploy/.env.prod; curl -fsSL https://raw.githubusercontent.com/niharsayshell/journey-simulator/main/deploy/install.sh | DOMAIN=qa.yourdomain.com bash
```

This creates new database secrets, so do it **before** you start using the tool seriously.
