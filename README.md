# IU — Appwrite Setup Guide

## 1. Create an Appwrite project

1. Sign up at https://cloud.appwrite.io (free tier is fine for MVP)
2. Create a new project — name it `IU`
3. Copy your **Project ID** from the project settings

## 2. Update js/appwrite.js

Open `js/appwrite.js` and replace the config at the top:

```js
const APPWRITE_CONFIG = {
  endpoint:   'https://cloud.appwrite.io/v1',
  projectId:  'YOUR_PROJECT_ID_HERE',   // <-- paste your project ID
  databaseId: 'iu_db',
  collections: {
    users:    'users',
    sessions: 'sessions',
    reports:  'reports',
    bans:     'bans',
    messages: 'messages',
  }
};
```

## 3. Create the database

In Appwrite Console → Databases → Create database
- **Database ID**: `iu_db`
- **Name**: IU Database

## 4. Create collections

### Collection: users
**Collection ID**: `users`

Attributes:
| Key          | Type    | Required | Default |
|--------------|---------|----------|---------|
| email        | String  | Yes      | —       |
| name         | String  | Yes      | —       |
| dateOfBirth  | String  | Yes      | —       |
| age          | Integer | Yes      | —       |
| role         | String  | Yes      | user    |
| isBanned     | Boolean | Yes      | false   |
| banReason    | String  | No       | —       |
| bannedAt     | String  | No       | —       |
| reportCount  | Integer | Yes      | 0       |
| createdAt    | String  | Yes      | —       |

Permissions:
- Create: Users (any authenticated user)
- Read: Users (own document) + Role:admin
- Update: Users (own document) + Role:admin
- Delete: Role:admin

**Indexes**:
- Key: `email`, type: unique

---

### Collection: sessions
**Collection ID**: `sessions`

Attributes:
| Key                  | Type    | Required | Default  |
|----------------------|---------|----------|----------|
| userId               | String  | Yes      | —        |
| status               | String  | Yes      | waiting  |
| partnerId            | String  | No       | —        |
| partnerSessionId     | String  | No       | —        |
| roomId               | String  | No       | —        |
| isInitiator          | Boolean | No       | —        |
| revealVotes          | String[]| No       | —        |
| revealApproved       | Boolean | No       | —        |
| revealDeclined       | Boolean | No       | —        |
| signalFromInitiator  | String  | No       | —        |
| signalFromReceiver   | String  | No       | —        |
| startedAt            | String  | No       | —        |
| endedAt              | String  | No       | —        |
| createdAt            | String  | Yes      | —        |

Permissions:
- Create: Users
- Read: Users (own document + partner)
- Update: Users
- Delete: Role:admin

**Indexes**:
- Key: `status`, type: key
- Key: `userId`, type: key
- Key: `createdAt`, type: key

---

### Collection: messages
**Collection ID**: `messages`

Attributes:
| Key       | Type    | Required |
|-----------|---------|----------|
| roomId    | String  | Yes      |
| senderId  | String  | Yes      |
| text      | String  | Yes      |
| blocked   | Boolean | Yes      |
| timestamp | String  | Yes      |

Permissions:
- Create: Users
- Read: Users
- Update: None
- Delete: Role:admin

**Indexes**:
- Key: `roomId`, type: key
- Key: `timestamp`, type: key

---

### Collection: reports
**Collection ID**: `reports`

Attributes:
| Key          | Type   | Required |
|--------------|--------|----------|
| reportedBy   | String | Yes      |
| reportedUser | String | Yes      |
| sessionId    | String | No       |
| reason       | String | Yes      |
| details      | String | No       |
| status       | String | Yes      |
| adminNotes   | String | No       |
| createdAt    | String | Yes      |

Permissions:
- Create: Users
- Read: Role:admin
- Update: Role:admin
- Delete: Role:admin

**Indexes**:
- Key: `status`, type: key
- Key: `createdAt`, type: key

---

### Collection: bans
**Collection ID**: `bans`

Attributes:
| Key        | Type   | Required |
|------------|--------|----------|
| userId     | String | Yes      |
| reason     | String | Yes      |
| adminNotes | String | No       |
| createdAt  | String | Yes      |

Permissions:
- Create: Role:admin
- Read: Role:admin
- Delete: Role:admin

---

## 5. Set up Realtime

In Appwrite Console → your project → Settings → Realtime
Make sure Realtime is enabled (it is by default on Cloud).

No extra configuration needed — the app uses Appwrite Realtime to push session and message updates.

## 6. Register your platform (web)

In Appwrite Console → your project → Platforms → Add Platform → Web
- **Name**: IU Web
- **Hostname**: `localhost` (for development)
  Add another entry for your production domain when you deploy.

## 7. Make yourself an admin

After registering via the app, go to Appwrite Console → Databases → iu_db → users
Find your user document and change `role` from `user` to `admin`.

Then visit `/pages/admin.html` — you will have full admin access.

## 8. Running locally

Since this is pure HTML/CSS/JS with no build step:

```bash
# Option 1: Python simple server
python3 -m http.server 8000

# Option 2: Node http-server
npx http-server -p 8000 -c-1

# Option 3: VS Code Live Server extension
```

Then open: http://localhost:8000

## 9. Deploying to production

Upload the entire `iu/` folder to any static host:
- **Netlify**: drag the folder into netlify.com/drop
- **Vercel**: `vercel` CLI in the folder
- **GitHub Pages**: push to a repo, enable Pages
- **Cloudflare Pages**: connect your git repo

After deploying, add your production URL as a platform in Appwrite.

## 10. Optional — Stream moderation API

For production message moderation beyond the built-in keyword filter:

1. Sign up at https://getstream.io
2. Get your API key and secret
3. Create an Appwrite Function that calls Stream's moderation API
4. Trigger it from the `messages` collection on document create

The client-side filter in `js/appwrite.js` (`clientSideFilter()`) handles the MVP case.

---

## Architecture summary

```
index.html          Landing page
pages/register.html  Sign up (with 18+ age gate)
pages/login.html     Sign in
pages/queue.html     Matchmaking waiting room
pages/call.html      Audio/video call + chat + reveal
pages/admin.html     Admin dashboard

css/global.css       Design system, components
css/landing.css      Landing page styles
css/auth.css         Auth page styles
css/call.css         Call + queue + admin styles

js/appwrite.js       Appwrite SDK init + all API calls
js/auth-guard.js     Route protection helpers
js/webrtc.js         WebRTC peer connection manager
```

Appwrite provides:
- **Auth**: email/password accounts with JWT sessions
- **Database**: all data storage
- **Realtime**: live updates for matchmaking, signaling, chat
- No WebSocket server required — everything runs client-side
