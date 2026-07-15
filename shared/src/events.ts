export const SOCKET_EVENTS = {
  CLIENT_PING: "client:ping",
  SERVER_PONG: "server:pong",
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_STATE: "room:state",
  PLAYER_SET_READY: "player:set-ready",
  GAME_START: "game:start",
  DRAWING_SUBMIT: "drawing:submit",
  TURN_SECRET: "turn:secret",
  GAME_CANCELLED: "game:cancelled",
} as const;
