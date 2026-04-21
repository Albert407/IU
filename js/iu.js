// ═══════════════════════════════════════════════════════════════════════════
// IU — Pure Client-Side Engine
// No backend. Uses:
//   - localStorage  → user accounts, session history, reports
//   - BroadcastChannel → real-time signaling between tabs (same origin)
//   - WebRTC PeerConnection → actual audio/video P2P
// ═══════════════════════════════════════════════════════════════════════════

const IU = (() => {

  // ── STORAGE KEYS ────────────────────────────────────────────────────────
  const K = {
    USERS:    'iu_users',
    CURRENT:  'iu_current_user',
    SESSION:  'iu_active_session',
    REPORTS:  'iu_reports',
    QUEUE:    'iu_queue',        // list of waiting peer IDs
    SIGNALS:  'iu_signals_',    // prefix + roomId
  };

  // ── ICE SERVERS (public STUN — works for same-network / most peers) ──────
  const ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ]
  };

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH
  // ═══════════════════════════════════════════════════════════════════════
  function getUsers() {
    return JSON.parse(localStorage.getItem(K.USERS) || '{}');
  }
  function saveUsers(u) {
    localStorage.setItem(K.USERS, JSON.stringify(u));
  }

  function register({ name, email, password, dateOfBirth }) {
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) throw new Error('Invalid date of birth.');
    const age = Math.floor((Date.now() - dob) / (365.25 * 24 * 3600 * 1000));
    if (age < 18) throw new Error('You must be 18 or older to use IU.');

    const users = getUsers();
    if (Object.values(users).find(u => u.email === email.toLowerCase())) {
      throw new Error('Email already registered.');
    }

    const id = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const user = { id, name, email: email.toLowerCase(), password, age, dateOfBirth: dob.toISOString(), role: 'user', isBanned: false, reportCount: 0, createdAt: Date.now() };
    users[id] = user;
    saveUsers(users);
    setCurrentUser(user);
    return user;
  }

  function login({ email, password }) {
    const users = getUsers();
    const user = Object.values(users).find(u => u.email === email.toLowerCase());
    if (!user || user.password !== password) throw new Error('Invalid email or password.');
    if (user.isBanned) throw new Error('Your account has been suspended.');
    setCurrentUser(user);
    return user;
  }

  function logout() {
    localStorage.removeItem(K.CURRENT);
    sessionStorage.removeItem(K.SESSION);
    window.location.href = getRoot() + 'index.html';
  }

  function setCurrentUser(user) {
    // Don't store password in session
    const { password: _, ...safe } = user;
    sessionStorage.setItem(K.CURRENT, JSON.stringify(safe));
  }

  function getCurrentUser() {
    const raw = sessionStorage.getItem(K.CURRENT);
    return raw ? JSON.parse(raw) : null;
  }

  function requireAuth(redirectTo) {
    const user = getCurrentUser();
    if (!user) { window.location.href = redirectTo || getRoot() + 'index.html'; return null; }
    return user;
  }

  function requireAdmin(redirectTo) {
    const user = requireAuth(redirectTo);
    if (user && user.role !== 'admin') { window.location.href = redirectTo || getRoot() + 'index.html'; return null; }
    return user;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MATCHMAKING via BroadcastChannel
  // Two users in different tabs signal each other through a shared channel.
  // One tab joins the queue (writes itself), the other finds it and they
  // negotiate a WebRTC room via the channel.
  // ═══════════════════════════════════════════════════════════════════════

  let _channel = null;
  let _channelHandlers = {};

  function getChannel() {
    if (!_channel) {
      _channel = new BroadcastChannel('iu_matchmaking');
      _channel.onmessage = (e) => {
        const { type, ...data } = e.data;
        if (_channelHandlers[type]) _channelHandlers[type](data);
      };
    }
    return _channel;
  }

  function onChannel(type, handler) {
    _channelHandlers[type] = handler;
  }

  function sendChannel(type, data = {}) {
    getChannel().postMessage({ type, ...data });
  }

  function closeChannel() {
    if (_channel) { _channel.close(); _channel = null; _channelHandlers = {}; }
  }

  // Queue management (localStorage as shared state across tabs)
  function getQueue() {
    return JSON.parse(localStorage.getItem(K.QUEUE) || '[]');
  }
  function saveQueue(q) {
    localStorage.setItem(K.QUEUE, JSON.stringify(q));
  }

  function joinQueue(userId) {
    const q = getQueue().filter(e => e.id !== userId);
    q.push({ id: userId, ts: Date.now() });
    saveQueue(q);
  }

  function leaveQueue(userId) {
    saveQueue(getQueue().filter(e => e.id !== userId));
  }

  function findMatch(myId) {
    const q = getQueue();
    // Remove stale entries (> 5 min old)
    const fresh = q.filter(e => Date.now() - e.ts < 5 * 60 * 1000);
    if (fresh.length !== q.length) saveQueue(fresh);
    return fresh.find(e => e.id !== myId) || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WebRTC
  // ═══════════════════════════════════════════════════════════════════════

  class PeerConnection {
    constructor({ isInitiator, onRemoteStream, onConnectionState, onIceCandidate, onOffer, onAnswer }) {
      this.pc = new RTCPeerConnection(ICE);
      this.localStream = null;
      this.isInitiator = isInitiator;
      this._pendingCandidates = [];

      this.pc.ontrack = e => { if (onRemoteStream) onRemoteStream(e.streams[0]); };
      this.pc.onconnectionstatechange = () => { if (onConnectionState) onConnectionState(this.pc.connectionState); };
      this.pc.onicecandidate = e => { if (e.candidate && onIceCandidate) onIceCandidate(e.candidate.toJSON()); };
    }

    async startMedia(includeVideo = false) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
        video: includeVideo
      });
      this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
      return this.localStream;
    }

    async createOffer() {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      return offer;
    }

    async handleOffer(sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      // flush pending candidates
      for (const c of this._pendingCandidates) await this.pc.addIceCandidate(new RTCIceCandidate(c));
      this._pendingCandidates = [];
      return answer;
    }

    async handleAnswer(sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }

    async addIceCandidate(candidate) {
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        this._pendingCandidates.push(candidate);
      }
    }

    async enableVideo() {
      const vs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const vt = vs.getVideoTracks()[0];
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(vt);
      else this.pc.addTrack(vt, this.localStream);
      this.localStream.addTrack(vt);
      return vt;
    }

    toggleMute(muted) {
      this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    }

    destroy() {
      this.localStream?.getTracks().forEach(t => t.stop());
      this.pc.close();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHAT (BroadcastChannel per room)
  // ═══════════════════════════════════════════════════════════════════════

  let _chatChannel = null;

  function openChat(roomId, onMessage) {
    if (_chatChannel) _chatChannel.close();
    _chatChannel = new BroadcastChannel('iu_chat_' + roomId);
    _chatChannel.onmessage = e => { if (onMessage) onMessage(e.data); };
    return _chatChannel;
  }

  function sendChat(msg) {
    if (_chatChannel) _chatChannel.postMessage(msg);
  }

  function closeChat() {
    if (_chatChannel) { _chatChannel.close(); _chatChannel = null; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MODERATION (client-side keyword filter)
  // ═══════════════════════════════════════════════════════════════════════

  const BAD_PATTERNS = [
    /\b(fuck|shit|ass\b|bitch|dick|cunt|nigger|faggot|kys|kill yourself)\b/gi,
    /\b(go die|you should die)\b/gi,
    /(\d[\s\-.]){9,}/g,   // phone numbers
  ];

  function filterMessage(text) {
    for (const p of BAD_PATTERNS) {
      if (p.test(text)) return { text: '[Message removed by moderation]', blocked: true };
    }
    return { text, blocked: false };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REPORTS & ADMIN
  // ═══════════════════════════════════════════════════════════════════════

  function getReports() {
    return JSON.parse(localStorage.getItem(K.REPORTS) || '[]');
  }

  function submitReport({ reportedBy, reportedByName, reason, details, sessionId }) {
    const reports = getReports();
    reports.unshift({
      id: 'r_' + Date.now(),
      reportedBy, reportedByName,
      reason, details, sessionId,
      status: 'pending',
      createdAt: Date.now()
    });
    localStorage.setItem(K.REPORTS, JSON.stringify(reports));
    return reports[0];
  }

  function resolveReport(id, status) {
    const reports = getReports().map(r => r.id === id ? { ...r, status } : r);
    localStorage.setItem(K.REPORTS, JSON.stringify(reports));
  }

  function banUser(userId) {
    const users = getUsers();
    if (users[userId]) { users[userId].isBanned = true; saveUsers(users); }
  }

  function unbanUser(userId) {
    const users = getUsers();
    if (users[userId]) { users[userId].isBanned = false; saveUsers(users); }
  }

  function getStats() {
    const users = getUsers();
    const reports = getReports();
    const history = JSON.parse(localStorage.getItem('iu_session_history') || '[]');
    return {
      totalUsers: Object.keys(users).length,
      totalSessions: history.length,
      pendingReports: reports.filter(r => r.status === 'pending').length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SESSION HISTORY
  // ═══════════════════════════════════════════════════════════════════════

  function logSession(data) {
    const h = JSON.parse(localStorage.getItem('iu_session_history') || '[]');
    h.unshift({ ...data, ts: Date.now() });
    if (h.length > 200) h.length = 200;
    localStorage.setItem('iu_session_history', JSON.stringify(h));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════════════════════════════════════

  function getRoot() {
    // Determine if we're in pages/ subdir
    return window.location.pathname.includes('/pages/') ? '../' : '';
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  function showToast(msg, type = 'info', duration = 4000) {
    let cont = document.querySelector('.toast-container');
    if (!cont) {
      cont = document.createElement('div');
      cont.className = 'toast-container';
      document.body.appendChild(cont);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    cont.appendChild(el);
    setTimeout(() => {
      el.style.cssText += 'opacity:0;transform:translateX(30px);transition:0.3s;';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────
  return {
    register, login, logout, getCurrentUser, requireAuth, requireAdmin,
    getUsers, banUser, unbanUser,
    getChannel, onChannel, sendChannel, closeChannel,
    joinQueue, leaveQueue, findMatch,
    PeerConnection,
    openChat, sendChat, closeChat, filterMessage,
    submitReport, getReports, resolveReport, getStats, logSession,
    formatTime, showToast, uid, getRoot,
  };
})();
