# ReforgedZ Ticket Bot + Transcripts - Setup Guide

## What This Is
One app that runs both:
- **Discord ticket bot** - 5 questionnaire types (NA1, NA2, EU1, EU2, Ban Appeal), claim system, evidence requirements
- **Transcript web server** - admin panel at `transcripts.reforgedz.net` with search, viewer, login

## Ports
- **1 port needed: `3100` (TCP)** - Transcript web server (configurable via `WEB_PORT`)
- The Discord bot uses WebSocket to Discord's API (no port needed)

---

## Pterodactyl Setup

**Egg:** Generic Node.js (v20)
**Startup Command:** `npm run setup && npm run build && npm start`
**Allocated Port:** `3100`

### Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `TOKEN` | your-discord-bot-token | Discord bot token from Developer Portal |
| `DATABASE_URL` | `file:./tixbot.db` | SQLite database for tickets |
| `WEB_PORT` | `3100` | Port for transcript web server (match your allocated port) |
| `JWT_SECRET` | random-64-char-string | Secret for admin panel sessions |
| `API_KEY` | random-48-char-string | Shared secret for transcript uploads |
| `TRANSCRIPT_API_KEY` | same-as-API_KEY | Must match API_KEY exactly |

### First Boot
1. Bot starts + transcript server starts on port 3100
2. Visit `https://transcripts.reforgedz.net/login`
3. Default admin: `admin` / `admin` -- **change immediately**
4. In Discord, run these slash commands:
```
/setrole role:@YourStaffRole
/na1categoryopen category:#na1-tickets
/na2categoryopen category:#na2-tickets
/eu1categoryopen category:#eu1-tickets
/eu2categoryopen category:#eu2-tickets
/banappealcategoryopen category:#ban-appeals
/claimedcategory category:#claimed-tickets
```

---

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create application, go to **Bot** tab
3. Copy token, enable **Server Members Intent** + **Message Content Intent**
4. Invite with: `https://discord.com/oauth2/authorize?client_id=YOUR_ID&permissions=8&scope=bot%20applications.commands`

### Config File
Edit `config/config.jsonc` with your Discord IDs:
- `clientId` - Bot application ID
- `guildId` - Your Discord server ID
- `openTicketChannelId` - Channel for the "Open Ticket" button
- `logsChannelId` - Channel for ticket logs

---

## npm Scripts

| Command | What it does |
|---------|-------------|
| `npm run setup` | Install deps + generate Prisma + create DB |
| `npm run build` | Compile TypeScript bot code |
| `npm start` | Start both bot + transcript server |
| `npm run start:bot` | Start only the Discord bot |
| `npm run start:web` | Start only the transcript web server |
