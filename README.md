# IU — Pure HTML/CSS/JS Edition
## No backend. No server. No install.

---

## Run it

```bash
# Option 1 — Python (comes with macOS/Linux)
python3 -m http.server 8080

# Option 2 — Node
npx http-server -p 8080 -c-1

# Option 3 — VS Code Live Server extension (click "Go Live")
```

Open: **http://localhost:8080**

> You MUST serve via HTTP — file:// won't work because WebRTC and
> BroadcastChannel require a secure context (localhost counts).

---

## How it works (no backend)

| Feature | How |
|---|---|
| User accounts | `localStorage` — register/login stored in browser |
| Matchmaking | `BroadcastChannel('iu_matchmaking')` — tabs on same origin see each other |
| WebRTC signaling | `BroadcastChannel('iu_sig_<roomId>')` — offer/answer/ICE exchanged between tabs |
| Audio/Video | Native WebRTC PeerConnection with Google STUN servers |
| Chat messages | `BroadcastChannel('iu_chat_<roomId>')` — instant delivery between tabs |
| Moderation | Client-side keyword filter in `js/iu.js` |
| Reports | Stored in `localStorage` |
| Admin panel | Reads localStorage — accessible at `/pages/admin.html` |
| Sessions | `sessionStorage` — cleared when tab closes |

---

## Testing with two tabs

1. Open `http://localhost:8080`
2. Register **Account A** (e.g. alice@test.com / password123, DOB: 1990-01-01)
3. Open a **second tab** to `http://localhost:8080`
4. Register **Account B** (e.g. bob@test.com / password123, DOB: 1990-01-01)
5. In tab A → go to Queue → click **Find Someone**
6. In tab B → go to Queue → click **Find Someone**
7. They match via BroadcastChannel. Both go to the call page.
8. Allow microphone when prompted.
9. You can chat, hear audio between tabs, and test the reveal flow.

> Both tabs must be on the same `localhost:PORT` origin for BroadcastChannel to work.

---

## File structure

```
iu-pure/
├── index.html              Landing page
├── pages/
│   ├── register.html       Sign up (18+ age gate)
│   ├── login.html          Sign in
│   ├── queue.html          Matchmaking waiting room
│   ├── call.html           Full call interface (audio → reveal → video)
│   └── admin.html          Admin dashboard
├── css/
│   └── global.css          Full design system (NexusGrid aesthetic)
└── js/
    └── iu.js               All logic — auth, matchmaking, WebRTC, chat, reports
```

---

## Limitations (pure client-side)

- **Same origin only** — both users must be on the same `localhost:PORT`. For a real
  multi-user experience, you need a signaling server (WebSocket or WebRTC
  "serverless" services like PeerJS Cloud).
- **WebRTC NAT traversal** — same-machine connections work perfectly. Connections
  across different networks may fail without a TURN server.
- **Data persists per browser** — localStorage is per-browser. Two users on different
  computers won't see each other's data.

To go beyond same-origin, integrate a free **PeerJS** signaling server or use 
**Socket.io** as a thin signaling layer — no database required.

---

## Make yourself admin

Open DevTools → Application → Local Storage → `iu_users`
Find your user object and change `"role":"user"` to `"role":"admin"`.
Then open `/pages/admin.html`.
