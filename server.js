const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);
const USE_CLOUDINARY = Boolean(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

if (USE_CLOUDINARY && !process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const defaultDb = {
  users: [],
  posts: [],
  comments: [],
  likes: [],
  messages: [],
  counters: { user: 1, post: 1, comment: 1, message: 1 }
};

function cloneDefaultDb() {
  return JSON.parse(JSON.stringify(defaultDb));
}

function now() {
  return new Date().toISOString();
}

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+$/g, '').slice(0, max);
}

function normalizeAccount(value) {
  const account = cleanText(value, 24).trim();
  return /^[a-zA-Z0-9_\-.]{3,24}$/.test(account) ? account : null;
}

function normalizeNickname(value) {
  const nickname = cleanText(value, 24).trim();
  return /^[\u4e00-\u9fa5a-zA-Z0-9_\-. ]{2,24}$/.test(nickname) ? nickname : null;
}

function normalizeInterests(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 20).trim()).filter(Boolean).slice(0, 8);
  return cleanText(value, 120)
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function nextCounter(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function migrateJsonDb(source) {
  const db = { ...cloneDefaultDb(), ...source };
  db.users = Array.isArray(db.users) ? db.users : [];
  db.posts = Array.isArray(db.posts) ? db.posts : [];
  db.comments = Array.isArray(db.comments) ? db.comments : [];
  db.likes = Array.isArray(db.likes) ? db.likes : [];
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  db.counters = { ...cloneDefaultDb().counters, ...(db.counters || {}) };

  db.users = db.users.map((user) => {
    const username = cleanText(user.username || user.nickname || `user${user.id}`, 24).trim();
    const nickname = cleanText(user.nickname || user.displayName || username, 24).trim();
    return {
      id: Number(user.id),
      username,
      nickname,
      displayName: nickname,
      passwordHash: user.passwordHash,
      avatarUrl: user.avatarUrl || '',
      bio: cleanText(user.bio, 180).trim(),
      location: cleanText(user.location, 24).trim(),
      interests: normalizeInterests(user.interests || ''),
      createdAt: user.createdAt || now(),
      updatedAt: user.updatedAt || user.createdAt || now()
    };
  }).filter((user) => user.id && user.username && user.passwordHash);

  db.posts = db.posts.map((post) => ({
    id: Number(post.id),
    userId: Number(post.userId),
    content: cleanText(post.content, 800).trim(),
    imageUrl: post.imageUrl || '',
    createdAt: post.createdAt || now()
  })).filter((post) => post.id && post.userId && (post.content || post.imageUrl));

  db.comments = db.comments.map((comment) => ({
    id: Number(comment.id),
    postId: Number(comment.postId),
    userId: Number(comment.userId),
    content: cleanText(comment.content, 280).trim(),
    createdAt: comment.createdAt || now()
  })).filter((comment) => comment.id && comment.postId && comment.userId && comment.content);

  db.likes = db.likes.map((like) => ({
    postId: Number(like.postId),
    userId: Number(like.userId),
    createdAt: like.createdAt || now()
  })).filter((like) => like.postId && like.userId);

  db.messages = db.messages.map((message) => ({
    id: Number(message.id),
    fromUserId: Number(message.fromUserId),
    toUserId: Number(message.toUserId),
    content: cleanText(message.content, 1000).trim(),
    createdAt: message.createdAt || now(),
    readAt: message.readAt || null
  })).filter((message) => message.id && message.fromUserId && message.toUserId && message.content);

  db.counters.user = Math.max(db.counters.user, nextCounter(db.users));
  db.counters.post = Math.max(db.counters.post, nextCounter(db.posts));
  db.counters.comment = Math.max(db.counters.comment, nextCounter(db.comments));
  db.counters.message = Math.max(db.counters.message, nextCounter(db.messages));
  return db;
}

function loadJsonDb() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
  try {
    return migrateJsonDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (err) {
    console.error('Failed to read local JSON database:', err);
    return cloneDefaultDb();
  }
}

function saveJsonDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const localDb = USE_POSTGRES ? null : loadJsonDb();

const pool = USE_POSTGRES ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUsePgSsl() ? { rejectUnauthorized: false } : false
}) : null;

function shouldUsePgSsl() {
  if (!process.env.DATABASE_URL) return false;
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === 'true') return true;
  return !/localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL);
}

function rowUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    nickname: row.nickname,
    displayName: row.nickname,
    passwordHash: row.password_hash,
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    location: row.location || '',
    interests: row.interests || [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function rowPost(row) {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    content: row.content || '',
    imageUrl: row.image_url || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function rowComment(row) {
  return {
    id: Number(row.id),
    postId: Number(row.post_id),
    userId: Number(row.user_id),
    content: row.content || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function rowMessage(row) {
  return {
    id: Number(row.id),
    fromUserId: Number(row.from_user_id),
    toUserId: Number(row.to_user_id),
    content: row.content || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    readAt: row.read_at ? (row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at) : null
  };
}

function publicUser(user, viewerId = null, context = {}) {
  if (!user) return null;
  const postsCount = context.postsCount?.get(user.id) ?? 0;
  const unreadCount = viewerId ? (context.unreadCount?.get(user.id) ?? 0) : 0;
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.displayName,
    displayName: user.nickname || user.displayName,
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    location: user.location || '',
    interests: user.interests || [],
    createdAt: user.createdAt,
    postsCount,
    unreadCount
  };
}

function countBy(items, keyGetter) {
  const map = new Map();
  for (const item of items) {
    const key = keyGetter(item);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function makeContext(users, posts, messages, viewerId = null) {
  const unread = viewerId
    ? countBy(messages.filter((message) => message.toUserId === viewerId && !message.readAt), (message) => message.fromUserId)
    : new Map();
  return {
    usersById: new Map(users.map((user) => [user.id, user])),
    postsCount: countBy(posts, (post) => post.userId),
    unreadCount: unread
  };
}

async function initPostgres() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      interests TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_users_created ON messages(from_user_id, to_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_to_unread ON messages(to_user_id, read_at);
  `);
}

async function getUserById(id) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rowUser(result.rows[0]);
  }
  return localDb.users.find((user) => user.id === Number(id)) || null;
}

async function getUserByUsername(username) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    return rowUser(result.rows[0]);
  }
  return localDb.users.find((user) => user.username.toLowerCase() === String(username).toLowerCase()) || null;
}

async function getAllData() {
  if (USE_POSTGRES) {
    const [users, posts, comments, likes, messages] = await Promise.all([
      pool.query('SELECT * FROM users'),
      pool.query('SELECT * FROM posts ORDER BY created_at DESC'),
      pool.query('SELECT * FROM comments ORDER BY created_at ASC'),
      pool.query('SELECT post_id, user_id, created_at FROM likes'),
      pool.query('SELECT * FROM messages ORDER BY created_at DESC')
    ]);
    return {
      users: users.rows.map(rowUser),
      posts: posts.rows.map(rowPost),
      comments: comments.rows.map(rowComment),
      likes: likes.rows.map((row) => ({ postId: Number(row.post_id), userId: Number(row.user_id), createdAt: row.created_at })),
      messages: messages.rows.map(rowMessage)
    };
  }
  return localDb;
}

async function createUser(data) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      `INSERT INTO users (username, nickname, password_hash, avatar_url, bio, location, interests)
       VALUES ($1, $2, $3, $4, '', '', '{}')
       RETURNING *`,
      [data.username, data.nickname, data.passwordHash, data.avatarUrl || '']
    );
    return rowUser(result.rows[0]);
  }

  const user = {
    id: localDb.counters.user++,
    username: data.username,
    nickname: data.nickname,
    displayName: data.nickname,
    passwordHash: data.passwordHash,
    avatarUrl: data.avatarUrl || '',
    bio: '',
    location: '',
    interests: [],
    createdAt: now(),
    updatedAt: now()
  };
  localDb.users.push(user);
  saveJsonDb(localDb);
  return user;
}

async function updateUserProfile(userId, data) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      `UPDATE users
       SET nickname = $2, avatar_url = COALESCE($3, avatar_url), bio = $4, location = $5, interests = $6, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [userId, data.nickname, data.avatarUrl || null, data.bio, data.location, data.interests]
    );
    return rowUser(result.rows[0]);
  }

  const user = localDb.users.find((item) => item.id === Number(userId));
  if (!user) return null;
  user.nickname = data.nickname;
  user.displayName = data.nickname;
  if (data.avatarUrl) user.avatarUrl = data.avatarUrl;
  user.bio = data.bio;
  user.location = data.location;
  user.interests = data.interests;
  user.updatedAt = now();
  saveJsonDb(localDb);
  return user;
}

async function updateUserPassword(userId, passwordHash) {
  if (USE_POSTGRES) {
    await pool.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [userId, passwordHash]);
    return;
  }
  const user = localDb.users.find((item) => item.id === Number(userId));
  if (user) {
    user.passwordHash = passwordHash;
    user.updatedAt = now();
    saveJsonDb(localDb);
  }
}

async function createPost(data) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      'INSERT INTO posts (user_id, content, image_url) VALUES ($1, $2, $3) RETURNING *',
      [data.userId, data.content, data.imageUrl || '']
    );
    return rowPost(result.rows[0]);
  }
  const post = { id: localDb.counters.post++, userId: data.userId, content: data.content, imageUrl: data.imageUrl || '', createdAt: now() };
  localDb.posts.push(post);
  saveJsonDb(localDb);
  return post;
}

async function createComment(data) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      'INSERT INTO comments (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
      [data.postId, data.userId, data.content]
    );
    return rowComment(result.rows[0]);
  }
  const comment = { id: localDb.counters.comment++, postId: data.postId, userId: data.userId, content: data.content, createdAt: now() };
  localDb.comments.push(comment);
  saveJsonDb(localDb);
  return comment;
}

async function toggleLike(postId, userId) {
  if (USE_POSTGRES) {
    const deleted = await pool.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id', [postId, userId]);
    if (!deleted.rowCount) await pool.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, userId]);
    return;
  }
  const index = localDb.likes.findIndex((like) => like.postId === postId && like.userId === userId);
  if (index >= 0) localDb.likes.splice(index, 1);
  else localDb.likes.push({ postId, userId, createdAt: now() });
  saveJsonDb(localDb);
}

async function createMessage(data) {
  if (USE_POSTGRES) {
    const result = await pool.query(
      'INSERT INTO messages (from_user_id, to_user_id, content) VALUES ($1, $2, $3) RETURNING *',
      [data.fromUserId, data.toUserId, data.content]
    );
    return rowMessage(result.rows[0]);
  }
  const message = { id: localDb.counters.message++, fromUserId: data.fromUserId, toUserId: data.toUserId, content: data.content, createdAt: now(), readAt: null };
  localDb.messages.push(message);
  saveJsonDb(localDb);
  return message;
}

async function markMessagesRead(fromUserId, toUserId) {
  if (USE_POSTGRES) {
    await pool.query('UPDATE messages SET read_at = now() WHERE from_user_id = $1 AND to_user_id = $2 AND read_at IS NULL', [fromUserId, toUserId]);
    return;
  }
  let changed = false;
  for (const message of localDb.messages) {
    if (message.fromUserId === fromUserId && message.toUserId === toUserId && !message.readAt) {
      message.readAt = now();
      changed = true;
    }
  }
  if (changed) saveJsonDb(localDb);
}

async function findPost(postId) {
  if (USE_POSTGRES) {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    return rowPost(result.rows[0]);
  }
  return localDb.posts.find((post) => post.id === Number(postId)) || null;
}

function postDto(post, viewerId, data) {
  const context = makeContext(data.users, data.posts, data.messages, viewerId);
  const comments = data.comments
    .filter((comment) => comment.postId === post.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: publicUser(context.usersById.get(comment.userId), viewerId, context)
    }));
  const likes = data.likes.filter((like) => like.postId === post.id);
  return {
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    createdAt: post.createdAt,
    author: publicUser(context.usersById.get(post.userId), viewerId, context),
    comments,
    likesCount: likes.length,
    likedByMe: Boolean(viewerId && likes.some((like) => like.userId === viewerId))
  };
}

function messageDto(message, viewerId, context) {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
    mine: message.fromUserId === viewerId,
    from: publicUser(context.usersById.get(message.fromUserId), viewerId, context),
    to: publicUser(context.usersById.get(message.toUserId), viewerId, context)
  };
}

const storage = USE_CLOUDINARY ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${uuidv4()}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('只允许上传 jpg、png、gif、webp 图片'));
  }
});

async function uploadImage(file, folder) {
  if (!file) return '';
  if (!USE_CLOUDINARY) return `/uploads/${file.filename}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `secret-garden/${folder}`,
        resource_type: 'image'
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    Readable.from(file.buffer).pipe(stream);
  });
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const sessionStore = USE_POSTGRES ? new pgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true
}) : undefined;

app.use(session({
  store: sessionStore,
  name: 'secret_garden.sid',
  secret: process.env.SESSION_SECRET || 'local-demo-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: USE_POSTGRES ? 'postgres' : 'local-json',
    images: USE_CLOUDINARY ? 'cloudinary' : 'local-uploads'
  });
});

async function currentUser(req) {
  if (!req.session.userId) return null;
  return getUserById(req.session.userId);
}

async function requireLogin(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

app.get('/api/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, user?.id);
    res.json({ user: publicUser(user, user?.id, context) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/register', upload.single('avatar'), async (req, res, next) => {
  try {
    const username = normalizeAccount(req.body.username);
    const nickname = normalizeNickname(req.body.nickname || req.body.username);
    const password = String(req.body.password || '');

    if (!username) return res.status(400).json({ error: '账号需要 3-24 位，只能包含英文、数字、下划线、横线或点' });
    if (!nickname) return res.status(400).json({ error: '昵称需要 2-24 位，可以包含中文、英文、数字和空格' });
    if (password.length < 6 || password.length > 72) return res.status(400).json({ error: '密码需要 6-72 位' });
    if (await getUserByUsername(username)) return res.status(409).json({ error: '这个账号已经被注册' });

    const avatarUrl = await uploadImage(req.file, 'avatars');
    const user = await createUser({
      username,
      nickname,
      avatarUrl,
      passwordHash: await bcrypt.hash(password, 10)
    });

    req.session.userId = user.id;
    res.json({ user: publicUser(user, user.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const account = String(req.body.username || req.body.nickname || '').trim();
    const password = String(req.body.password || '');
    const user = await getUserByUsername(account);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: '账号或密码错误' });

    req.session.userId = user.id;
    res.json({ user: publicUser(user, user.id) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.patch('/api/profile', requireLogin, upload.single('avatar'), async (req, res, next) => {
  try {
    const nickname = normalizeNickname(req.body.nickname || req.user.nickname);
    if (!nickname) return res.status(400).json({ error: '昵称需要 2-24 位，可以包含中文、英文、数字和空格' });

    const avatarUrl = await uploadImage(req.file, 'avatars');
    const user = await updateUserProfile(req.user.id, {
      nickname,
      avatarUrl,
      bio: cleanText(req.body.bio, 180).trim(),
      location: cleanText(req.body.location, 24).trim(),
      interests: normalizeInterests(req.body.interests)
    });
    res.json({ user: publicUser(user, user.id) });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/password', requireLogin, async (req, res, next) => {
  try {
    const oldPassword = String(req.body.oldPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 6 || newPassword.length > 72) return res.status(400).json({ error: '新密码需要 6-72 位' });
    if (!(await bcrypt.compare(oldPassword, req.user.passwordHash))) return res.status(400).json({ error: '原密码不正确' });

    await updateUserPassword(req.user.id, await bcrypt.hash(newPassword, 10));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/users', requireLogin, async (req, res, next) => {
  try {
    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, req.user.id);
    const users = data.users
      .filter((user) => user.id !== req.user.id)
      .map((user) => publicUser(user, req.user.id, context))
      .sort((a, b) => b.unreadCount - a.unreadCount || a.nickname.localeCompare(b.nickname, 'zh-Hans-CN'));
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

app.get('/api/users/:id', requireLogin, async (req, res, next) => {
  try {
    const user = await getUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: '用户不存在' });

    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, req.user.id);
    const recentPosts = data.posts
      .filter((post) => post.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6)
      .map((post) => postDto(post, req.user.id, data));
    res.json({ user: publicUser(user, req.user.id, context), recentPosts });
  } catch (err) {
    next(err);
  }
});

app.get('/api/posts', async (req, res, next) => {
  try {
    const viewer = await currentUser(req);
    const data = await getAllData();
    const posts = data.posts
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((post) => postDto(post, viewer?.id, data));
    res.json({ posts });
  } catch (err) {
    next(err);
  }
});

app.post('/api/posts', requireLogin, upload.single('image'), async (req, res, next) => {
  try {
    const content = cleanText(req.body.content, 800).trim();
    const imageUrl = await uploadImage(req.file, 'posts');
    if (!content && !imageUrl) return res.status(400).json({ error: '文字和图片至少发一个' });

    const post = await createPost({ userId: req.user.id, content, imageUrl });
    const data = await getAllData();
    res.json({ post: postDto(post, req.user.id, data) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/posts/:id/comments', requireLogin, async (req, res, next) => {
  try {
    const postId = Number(req.params.id);
    const post = await findPost(postId);
    if (!post) return res.status(404).json({ error: '帖子不存在' });

    const content = cleanText(req.body.content, 280).trim();
    if (!content) return res.status(400).json({ error: '评论不能为空' });

    await createComment({ postId, userId: req.user.id, content });
    const data = await getAllData();
    res.json({ post: postDto(post, req.user.id, data) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/posts/:id/like', requireLogin, async (req, res, next) => {
  try {
    const postId = Number(req.params.id);
    const post = await findPost(postId);
    if (!post) return res.status(404).json({ error: '帖子不存在' });

    await toggleLike(postId, req.user.id);
    const data = await getAllData();
    res.json({ post: postDto(post, req.user.id, data) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/threads', requireLogin, async (req, res, next) => {
  try {
    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, req.user.id);
    const related = data.messages
      .filter((message) => message.fromUserId === req.user.id || message.toUserId === req.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const seen = new Set();
    const threads = [];
    for (const message of related) {
      const otherId = message.fromUserId === req.user.id ? message.toUserId : message.fromUserId;
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      threads.push({
        user: publicUser(context.usersById.get(otherId), req.user.id, context),
        lastMessage: message.content,
        lastAt: message.createdAt,
        unreadCount: data.messages.filter((item) => item.fromUserId === otherId && item.toUserId === req.user.id && !item.readAt).length
      });
    }
    res.json({ threads: threads.filter((thread) => thread.user) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/messages/:otherId', requireLogin, async (req, res, next) => {
  try {
    const otherId = Number(req.params.otherId);
    const other = await getUserById(otherId);
    if (!other) return res.status(404).json({ error: '用户不存在' });

    await markMessagesRead(otherId, req.user.id);
    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, req.user.id);
    const messages = data.messages
      .filter((message) =>
        (message.fromUserId === req.user.id && message.toUserId === otherId) ||
        (message.fromUserId === otherId && message.toUserId === req.user.id)
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((message) => messageDto(message, req.user.id, context));
    res.json({ other: publicUser(other, req.user.id, context), messages });
  } catch (err) {
    next(err);
  }
});

app.post('/api/messages', requireLogin, async (req, res, next) => {
  try {
    const toUserId = Number(req.body.toUserId);
    const to = await getUserById(toUserId);
    if (!to) return res.status(404).json({ error: '收件人不存在' });
    if (to.id === req.user.id) return res.status(400).json({ error: '不能给自己发私信' });

    const content = cleanText(req.body.content, 1000).trim();
    if (!content) return res.status(400).json({ error: '私信不能为空' });

    const message = await createMessage({ fromUserId: req.user.id, toUserId: to.id, content });
    const data = await getAllData();
    const context = makeContext(data.users, data.posts, data.messages, req.user.id);
    res.json({ message: messageDto(message, req.user.id, context) });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片不能超过 4MB' });
  res.status(400).json({ error: err.message || '请求失败' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

initPostgres()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Secret Garden running at http://localhost:${PORT}`);
      console.log(`Storage: ${USE_POSTGRES ? 'PostgreSQL' : 'local JSON'} / ${USE_CLOUDINARY ? 'Cloudinary' : 'local uploads'}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize storage:', err);
    process.exit(1);
  });
