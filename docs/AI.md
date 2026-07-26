# Using RoomKit with AI

RoomKit ships an MCP server (`apps/mcp`) that lets AI agents — Claude Code,
Claude Desktop, or any MCP-capable client — operate the studio for you:
create themes, manage assets, write event sequences, and run tests end to
end, all through conversation.

## What the AI can do

- **Author themes**: create/duplicate themes, devices, players, websites,
  phases, hints, messages; upload media files from your machine (or use
  fileless placeholder assets while prototyping).
- **Write scenario logic**: read and edit event sequences as JSON with
  schema validation and warnings for references to missing assets.
- **Test without hardware**: create a test session, connect *virtual
  devices* (headless stand-ins for the room's screens/props), fire device
  triggers, and read the session logs to verify the scenario — no player
  app needed. With a running player app it can also open real device
  windows and drive website tests.
- **Operate sessions**: start/pause/end, switch phases, adjust the timer,
  push hints, inspect logs and post-game summaries.

## One-time setup

1. Build the server:

   ```sh
   pnpm install
   pnpm build:mcp
   ```

2. Register it with your AI client. For Claude Code, from anywhere:

   ```sh
   claude mcp add roomkit -- node /path/to/RoomKit/apps/mcp/dist/index.js
   ```

   (Other clients: add a stdio server running
   `node /path/to/RoomKit/apps/mcp/dist/index.js` — see
   `apps/mcp/README.md` for a config snippet.)

No environment variables are needed; credentials are provided in the chat.

## Starting a conversation

The RoomKit server (API + database + storage) must be running — locally
that is `./compose.sh` and `pnpm dev:server`.

Open your AI client and tell it where the server is and how to log in:

> Log in to my RoomKit server at http://localhost:3000 with admin id
> `admin` and password `…`, then select the theme "스텔라호".

The agent calls the `login` tool, picks the theme, and from then on all
tools default to it. The agent can call `get_started` on its own to learn
the RoomKit concepts and workflow — you don't need to explain them.

## Example prompts

- "Create a new theme called *Midnight Lab* with a 60-minute timer, three
  phases, and two devices (main screen and puzzle console)."
- "Upload everything in `~/audio/lab/` as SFX assets."
- "Write an event for phase 1: when the console fires `code:correct`, play
  the success SFX, wait 2 seconds, then switch to phase 2."
- "Run a test: start a session with virtual devices, fire `code:correct`
  from the console, and show me the logs."
- "Start a website test for the console device pointed at
  http://localhost:5175 using player `<playerId>`." (needs the player app
  running)
- "Why doesn't my intro event fire? Check its trigger and sequence."

## Caveats

- **Credentials go to the AI session.** The agent holds the admin id and
  password in memory for re-login; anyone who can talk to that session can
  operate your RoomKit server. Use it with dev/local servers, or accept
  that the AI session is as privileged as the studio admin.
- **Virtual devices are logic-accurate, not timing-accurate.** They
  acknowledge every command instantly, so media playback and `waitUntilEnd`
  take zero time. Use a real player window for timing/visual checks.
- **Deletes are permanent.** The tools warn the agent to confirm before
  deleting things it didn't create, but review destructive requests in
  clients that prompt for tool approval.
- **Website tests and player-driven sessions** require the player app
  (launcher) to be running and connected; the agent needs its `playerId`.
