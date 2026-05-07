import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Redis } from "@upstash/redis";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const USER_COOLDOWN_MS = 3000; 
const PIXEL_LOCK_MS = 10000;   
const INACTIVITY_LIMIT_MS = 0.5 * 60 * 1000; 

const redis = new Redis({
  url: "https://lasting-gelding-115646.upstash.io",
  token: "gQAAAAAAAcO-AAIgcDE0MDgyMDYzODE3NmE0MmY5YmI0YWIzNmIwOTdjMmFiMg",
});

const grid = new Map();
const userCooldowns = new Map();

// 🟢 Identity Trackers (Now tracking by hidden Client ID!)
const activeConnections = new Map(); // ws -> clientId
const userTabCount = new Map();      // clientId -> number of open tabs
const disconnectedUsers = new Map(); // clientId -> disconnect timestamp

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function handleUserDisconnect(ws) {
  const clientId = activeConnections.get(ws);
  if (clientId) {
    activeConnections.delete(ws);
    const count = (userTabCount.get(clientId) || 1) - 1;
    
    if (count <= 0) {
      userTabCount.delete(clientId);
      disconnectedUsers.set(clientId, Date.now());
      console.log(`⚠️ Client disconnected, starting 10m timer: ${clientId}`);
    } else {
      userTabCount.set(clientId, count);
    }
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [clientId, disconnectTime] of disconnectedUsers.entries()) {
    if (now - disconnectTime > INACTIVITY_LIMIT_MS) {
      console.log(`🧹 Purging dead user data: ${clientId}`);
      
      const keysToDelete = [];
      for (const [key, cell] of grid.entries()) {
        if (cell.clientId === clientId) keysToDelete.push(key);
      }

      keysToDelete.forEach(key => {
        grid.delete(key);
        redis.del(key).catch(() => {});
      });

      disconnectedUsers.delete(clientId);
      userCooldowns.delete(clientId);

      broadcast({ type: "purge_user", clientId });
    }
  }
}, 60000);

wss.on("connection", async (ws) => {
  console.log("✅ WebSocket connected");
  ws.send(JSON.stringify({ type: "init", data: Object.fromEntries(grid) }));

  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === "identify") {
        const { clientId, username } = msg;

        // 1. Manage Presence Tracking
        if (activeConnections.get(ws) !== clientId) {
          activeConnections.set(ws, clientId);
          userTabCount.set(clientId, (userTabCount.get(clientId) || 0) + 1);
          
          if (disconnectedUsers.has(clientId)) {
            console.log(`🛡️ Client returned, canceling timer: ${clientId}`);
            disconnectedUsers.delete(clientId);
          }
        }

        // 2. Seamlessly update display names on all existing blocks
        let nameChanged = false;
        const keysToUpdate = [];
        for (const [key, cell] of grid.entries()) {
          if (cell.clientId === clientId && cell.username !== username) {
            cell.username = username;
            keysToUpdate.push(key);
            nameChanged = true;
          }
        }
        
        if (nameChanged) {
          keysToUpdate.forEach(key => redis.set(key, JSON.stringify(grid.get(key))).catch(()=>{}));
          broadcast({ type: "rename", clientId, username });
        }
        return;
      }

      if (msg.type === "pixel") {
        const { x, y, color, clientId, username, action } = msg;
        const key = `${x},${y}`;
        const now = Date.now();

        if (action === "unown") {
          const existing = grid.get(key);
          if (existing && existing.clientId === clientId) {
            grid.delete(key);
            broadcast({ type: "pixel", action: "unown", x, y });
            redis.del(key).catch(() => {});
          }
          return;
        }

        if (action === "place") {
          const userReadyTime = userCooldowns.get(clientId) || 0;
          if (now < userReadyTime) return; 

          const existingCell = grid.get(key);
          if (existingCell && existingCell.clientId !== clientId && now < existingCell.lockedUntil) {
            return; 
          }

          const lockedUntil = now + PIXEL_LOCK_MS;
          const cellData = { color, clientId, username, lockedUntil };
          
          grid.set(key, cellData);
          userCooldowns.set(clientId, now + USER_COOLDOWN_MS);

          broadcast({ type: "pixel", action: "place", x, y, ...cellData });
          redis.set(key, JSON.stringify(cellData)).catch(() => {});
        }
      }
    } catch (err) {
      console.log("Invalid message");
    }
  });

  ws.on("close", () => {
    handleUserDisconnect(ws);
    console.log("❌ WebSocket disconnected");
  });
});

app.get("/", (req, res) => res.send("Server running 🚀"));
server.listen(3000, () => console.log("🔥 Server running on http://localhost:3000"));