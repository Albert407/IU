// js/appwrite.js
// Appwrite SDK loaded via CDN in each HTML page
// Configuration — update these with your Appwrite project details

const APPWRITE_CONFIG = {
  endpoint:   'https://cloud.appwrite.io/v1',  // or your self-hosted endpoint
  projectId:  'YOUR_PROJECT_ID',               // replace with your project ID
  databaseId: 'iu_db',
  collections: {
    users:    'users',
    sessions: 'sessions',
    reports:  'reports',
    bans:     'bans',
    messages: 'messages',
  }
};

// Initialize Appwrite client
let _client, _account, _databases, _realtime, _functions;

function getClient() {
  if (_client) return _client;
  _client = new Appwrite.Client()
    .setEndpoint(APPWRITE_CONFIG.endpoint)
    .setProject(APPWRITE_CONFIG.projectId);
  return _client;
}

function getAccount() {
  if (_account) return _account;
  _account = new Appwrite.Account(getClient());
  return _account;
}

function getDatabases() {
  if (_databases) return _databases;
  _databases = new Appwrite.Databases(getClient());
  return _databases;
}

function getRealtime() {
  if (_realtime) return _realtime;
  _realtime = new Appwrite.Realtime(getClient());
  return _realtime;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

async function register({ email, password, name, dateOfBirth }) {
  const dob = new Date(dateOfBirth);
  const age = Math.floor((Date.now() - dob) / (365.25 * 24 * 3600 * 1000));

  if (isNaN(dob.getTime())) throw new Error('Invalid date of birth.');
  if (age < 18) throw new Error('You must be 18 or older to use IU.');

  const account = getAccount();
  const userId = Appwrite.ID.unique();

  // Create Appwrite auth account
  await account.create(userId, email, password, name);

  // Login immediately
  await account.createEmailPasswordSession(email, password);

  // Store additional user data in database
  const db = getDatabases();
  await db.createDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    userId,
    {
      email,
      name,
      dateOfBirth: dob.toISOString(),
      age,
      role: 'user',
      isBanned: false,
      reportCount: 0,
      createdAt: new Date().toISOString(),
    }
  );

  return { userId, email, name, age };
}

async function login({ email, password }) {
  const account = getAccount();
  await account.createEmailPasswordSession(email, password);
  const user = await account.get();

  // Check if banned
  const db = getDatabases();
  const profile = await db.getDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    user.$id
  );

  if (profile.isBanned) {
    await account.deleteSession('current');
    throw new Error('Your account has been suspended.');
  }

  return { ...user, profile };
}

async function logout() {
  await getAccount().deleteSession('current');
  window.location.href = '../index.html';
}

async function getCurrentUser() {
  try {
    const account = getAccount();
    const user = await account.get();
    const db = getDatabases();
    const profile = await db.getDocument(
      APPWRITE_CONFIG.databaseId,
      APPWRITE_CONFIG.collections.users,
      user.$id
    );
    return { ...user, profile };
  } catch {
    return null;
  }
}

// ─── SESSIONS / MATCHMAKING ─────────────────────────────────────────────────

async function createSession(userId) {
  const db = getDatabases();
  return db.createDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.sessions,
    Appwrite.ID.unique(),
    {
      userId,
      status: 'waiting',      // waiting | matched | audio | reveal | video | ended
      partnerId: null,
      roomId: null,
      revealVotes: [],
      startedAt: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
    }
  );
}

async function updateSession(sessionId, data) {
  const db = getDatabases();
  return db.updateDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.sessions,
    sessionId,
    data
  );
}

async function findWaitingSession(excludeUserId) {
  const db = getDatabases();
  const result = await db.listDocuments(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.sessions,
    [
      Appwrite.Query.equal('status', 'waiting'),
      Appwrite.Query.notEqual('userId', excludeUserId),
      Appwrite.Query.orderAsc('createdAt'),
      Appwrite.Query.limit(1),
    ]
  );
  return result.documents[0] || null;
}

// ─── MESSAGES ───────────────────────────────────────────────────────────────

async function sendMessage(roomId, senderId, text) {
  // Basic client-side moderation filter
  const filtered = clientSideFilter(text);

  const db = getDatabases();
  return db.createDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.messages,
    Appwrite.ID.unique(),
    {
      roomId,
      senderId,
      text: filtered.text,
      blocked: filtered.blocked,
      timestamp: new Date().toISOString(),
    }
  );
}

async function getMessages(roomId) {
  const db = getDatabases();
  const result = await db.listDocuments(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.messages,
    [
      Appwrite.Query.equal('roomId', roomId),
      Appwrite.Query.orderAsc('timestamp'),
      Appwrite.Query.limit(100),
    ]
  );
  return result.documents;
}

function subscribeToMessages(roomId, callback) {
  const rt = getRealtime();
  return rt.subscribe(
    `databases.${APPWRITE_CONFIG.databaseId}.collections.${APPWRITE_CONFIG.collections.messages}.documents`,
    event => {
      const doc = event.payload;
      if (doc.roomId === roomId) callback(doc, event.events);
    }
  );
}

function subscribeToSession(sessionId, callback) {
  const rt = getRealtime();
  return rt.subscribe(
    `databases.${APPWRITE_CONFIG.databaseId}.collections.${APPWRITE_CONFIG.collections.sessions}.documents.${sessionId}`,
    event => callback(event.payload, event.events)
  );
}

// ─── REPORTS ────────────────────────────────────────────────────────────────

async function submitReport({ reportedBy, reportedUser, sessionId, reason, details }) {
  const db = getDatabases();
  const doc = await db.createDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.reports,
    Appwrite.ID.unique(),
    {
      reportedBy,
      reportedUser,
      sessionId,
      reason,
      details,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
  );

  // Increment report count on reported user
  const profile = await db.getDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    reportedUser
  );
  await db.updateDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    reportedUser,
    { reportCount: (profile.reportCount || 0) + 1 }
  );

  return doc;
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

async function getReports(status = null) {
  const db = getDatabases();
  const queries = [Appwrite.Query.orderDesc('createdAt'), Appwrite.Query.limit(50)];
  if (status) queries.push(Appwrite.Query.equal('status', status));
  const result = await db.listDocuments(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.reports,
    queries
  );
  return result.documents;
}

async function banUser(userId, reason, adminNotes) {
  const db = getDatabases();
  await db.updateDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    userId,
    { isBanned: true, banReason: reason, bannedAt: new Date().toISOString() }
  );
  return db.createDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.bans,
    Appwrite.ID.unique(),
    { userId, reason, adminNotes, createdAt: new Date().toISOString() }
  );
}

async function resolveReport(reportId, status, adminNotes) {
  const db = getDatabases();
  return db.updateDocument(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.reports,
    reportId,
    { status, adminNotes }
  );
}

async function getUsers(limit = 50) {
  const db = getDatabases();
  const result = await db.listDocuments(
    APPWRITE_CONFIG.databaseId,
    APPWRITE_CONFIG.collections.users,
    [Appwrite.Query.orderDesc('createdAt'), Appwrite.Query.limit(limit)]
  );
  return result.documents;
}

async function getStats() {
  const db = getDatabases();
  const [users, sessions, reports] = await Promise.all([
    db.listDocuments(APPWRITE_CONFIG.databaseId, APPWRITE_CONFIG.collections.users, [Appwrite.Query.limit(1)]),
    db.listDocuments(APPWRITE_CONFIG.databaseId, APPWRITE_CONFIG.collections.sessions, [Appwrite.Query.limit(1)]),
    db.listDocuments(APPWRITE_CONFIG.databaseId, APPWRITE_CONFIG.collections.reports, [Appwrite.Query.equal('status','pending'), Appwrite.Query.limit(1)]),
  ]);
  return {
    totalUsers: users.total,
    totalSessions: sessions.total,
    pendingReports: reports.total,
  };
}

// ─── CLIENT-SIDE CONTENT FILTER ─────────────────────────────────────────────

function clientSideFilter(text) {
  // Basic filter — complement with Stream API or Appwrite Function in production
  const blocked_patterns = [
    /\b(fuck|shit|ass|bitch|dick|cunt|nigger|faggot)\b/gi,
    /\b(kill yourself|kys|go die)\b/gi,
    /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/g,  // phone numbers
    /(https?:\/\/[^\s]+)/gi,                   // links (block sharing in blind phase)
  ];

  let blocked = false;
  for (const pattern of blocked_patterns) {
    if (pattern.test(text)) { blocked = true; break; }
  }

  return {
    text: blocked ? '[Message removed]' : text,
    blocked
  };
}

// ─── UTILS ──────────────────────────────────────────────────────────────────

function formatTime(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function showToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(120%)';
    toast.style.transition = '0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
