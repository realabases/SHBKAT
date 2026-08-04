import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import {
  readMessagesFromChannel,
  client,
  sendMessageToChannel,
} from "cordbridge";

import setupSockets from "./sockets.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || "localhost:5173" },
});

app.use(express.json());
app.use(cors());

const PORT = 3000;
const SERVERID = "1347277495086616617";
const CATEGORYID = "1347898548771094528";

let ready = false;
let guild;

const cache = new Map();
const langs = ["javascript", "c", "python", "assembly", "java"];

const updateCodeCache = async (lang) => {
  const codes = await readMessagesFromChannel(guild, lang, CATEGORYID);
  cache.set(lang, codes);
  console.log(`cache updated for ${lang}!`);
};

app.get("/", (_, res) => res.send("WebSocket server is running"));

app.get("/code/:lang", async (req, res) => {
  if (!ready) return res.sendStatus(503);

  const { lang } = req.params;
  if (!cache.has(lang)) await updateCodeCache(lang);

  const codes = cache.get(lang);
  if (!codes || !codes.length)
    return res.status(404).send("Code not available");

  const code =
    lang === "names" ? codes : codes[Math.floor(Math.random() * codes.length)];
  res.send(code);
});

setupSockets(io, cache, () => guild, CATEGORYID, sendMessageToChannel);

server.listen(PORT, () => {
  client.login("tok-here");
  console.log(`Server running at http://localhost:${PORT}`);
});

client.on("clientReady", async () => {
  console.log("Discord bot ready");
  ready = true;
  guild = await client.guilds.fetch(SERVERID);
  langs.forEach(updateCodeCache);
  setInterval(
    () => {
      console.log("updating cache..");
      langs.forEach(updateCodeCache);
    },
    5 * 60 * 1000,
  );
});
