const rooms = new Map();

const colors = [
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "pink",
  "cyan",
  "teal",
  "lime",
  "indigo",
  "gray",
];

const generateRoomCode = (length = 8) =>
  [...Array(length)]
    .map(
      () =>
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[
          Math.floor(Math.random() * 62)
        ],
    )
    .join("");

const assignColor = (index) => colors[index % colors.length];

export default function setupSockets(
  io,
  cache,
  getGuild,
  CATEGORYID,
  sendMessageToChannel,
) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    const emitToRoom = (roomId, event, data) => io.to(roomId).emit(event, data);
    const broadcastPlayers = (roomId) => {
      const room = rooms.get(roomId);
      if (room) {
        emitToRoom(roomId, "players", {
          players: room.players,
          roomId,
          code: room.code,
          started: room.started,
          lang: room.lang,
          raceType: room.raceType,
        });
      }
    };

    socket.on("createRoom", ({ username }) => {
      const roomId = generateRoomCode();
      const codes = cache.get("python");
      if (!codes) return socket.emit("error", "server error, try again later");
      const code = codes[Math.floor(Math.random() * codes.length)];

      rooms.set(roomId, {
        owner: socket.id,
        players: [{ id: socket.id, username, color: assignColor(0), lps: 0 }],
        code,
        started: false,
        lang: "Python",
        raceType: 0,
      });

      socket.join(roomId);
      socket.emit("roomCreated", roomId);
      broadcastPlayers(roomId);

      emitToRoom(roomId, "getMsg", {
        type: "join",
        text: "joined the room",
        player: username,
        color: assignColor(0),
      });

      sendMessageToChannel(
        getGuild(),
        "logs",
        CATEGORYID,
        `${username} created room ${roomId}`,
      );
    });

    socket.on("changeCode", (roomId, lang) => {
      const room = rooms.get(roomId);
      const codes = cache.get(lang) || [];
      const code = codes[Math.floor(Math.random() * codes.length)];

      room.code = code;

      broadcastPlayers(roomId);
    });

    socket.on("joinRoom", ({ roomId, username }) => {
      const room = rooms.get(roomId);
      if (!room) return socket.emit("error", "Room does not exist");

      const color = assignColor(room.players.length);
      room.players.push({ id: socket.id, username, color, lps: 0 });

      socket.join(roomId);
      emitToRoom(roomId, "playerJoined", { id: socket.id, username });
      emitToRoom(roomId, "getMsg", {
        type: "join",
        text: "joined the room",
        player: username,
        color,
      });

      broadcastPlayers(roomId);
      console.log(`${username} joined room ${roomId}`);
    });

    socket.on("leaveRoom", (roomId) => {
      const room = rooms.get(roomId);
      if (!room) return;
      let roomToDelete = null;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;
      room.players = room.players.filter((p) => p.id !== socket.id);
      socket.leave(roomId);

      emitToRoom(roomId, "getMsg", {
        type: "join",
        text: "left the room",
        player: player?.username || "null",
        color: player?.color || "red",
      });

      if (room.owner === socket.id) roomToDelete = roomId;
      broadcastPlayers(roomId);
      socket.emit("leftRoom");

      if (roomToDelete) {
        emitToRoom(roomToDelete, "roomClosed");
        rooms.delete(roomToDelete);
        emitToRoom(roomToDelete, "error", "Room owner left");
      }
    });

    socket.on("sendMsg", (roomId, msg) => {
      const room = rooms.get(roomId);
      const player = room?.players.find((p) => p.id === socket.id);

      if (!room || !player)
        return socket.emit("error", "Room or player not found");

      const { username, color } = player;
      emitToRoom(roomId, "getMsg", {
        type: "msg",
        text: msg,
        player: username,
        color,
      });

      console.log(`${username} (${socket.id}) in ${roomId}: ${msg}`);
    });

    socket.on("startRace", (roomId) => {
      const room = rooms.get(roomId);

      if (room?.owner !== socket.id)
        return socket.emit("error", "Only the owner can start the race");

      room.started = !room.started;
      emitToRoom(roomId, "raceStarted", room.started);
      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;
      emitToRoom(roomId, "getMsg", {
        type: "bd",
        text: `${room.started ? "STARTED THE RACE" : "ENDED THE RACE"}`,
        player: player.username,
        color: player.color,
      });
    });

    socket.on("getRoomState", () => {
      for (const [roomId, room] of rooms) {
        const player = room.players.find((p) => p.id === socket.id);
        if (player) {
          socket.emit("players", {
            players: room.players,
            roomId,
            code: room.code,
            started: room.started,
          });
          break;
        }
      }
    });

    socket.on("amIOwner", (roomId) => {
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (player) {
        const isOwner = room.owner === socket.id;
        socket.emit("youAreOwner", isOwner);
      }
    });

    socket.on("editRoom", (roomId, { raceType, lang }) => {
      const room = rooms.get(roomId);
      if (!room)
        return socket.emit(
          "error",
          "Room does not exist, try reloading the page",
        );
      if (room.started) return socket.emit("error", "Race already started");

      if (room.owner !== socket.id) return;

      if (raceType) room.raceType = raceType;
      if (lang) {
        room.lang = lang;
        lang = lang.toLowerCase();

        const codes = cache.get(lang) || ["nigga"];
        const code = codes[Math.floor(Math.random() * codes.length)];

        room.code = code;
      }

      broadcastPlayers(roomId);
    });

    socket.on("finished", ({ roomId, lps, acc }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      if (!player) return;

      player.lps = lps;

      emitToRoom(roomId, "getMsg", {
        type: "bd",
        text: `FINISHED (${lps} LPS | %${acc} ACC)`,
        player: player.username,
        color: player.color,
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      let roomToDelete = null;

      for (const [roomId, room] of rooms.entries()) {
        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;
        room.players = room.players.filter((p) => p.id !== socket.id);
        socket.leave(roomId);

        broadcastPlayers(roomId);

        emitToRoom(roomId, "getMsg", {
          type: "join",
          text: "left the room",
          player: player?.username || "null",
          color: player?.color || "red",
        });

        if (room.owner === socket.id) roomToDelete = roomId;
      }

      if (roomToDelete) {
        emitToRoom(roomToDelete, "roomClosed");
        rooms.delete(roomToDelete);
        console.log(`Room ${roomToDelete} closed (owner left)`);
        emitToRoom(roomToDelete, "error", "Room owner left");
      }
    });
  });
}
