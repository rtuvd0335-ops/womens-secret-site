const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

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

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return migrateDb(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to read database:', err);
    return cloneDefaultDb();
  }
}

function migrateDb(source) {
  const db = { ...cloneDefaultDb(), ...source };
  db.users = Array.isArray(db.users) ? db.users : [];
  db.posts = Array.isArray(db.posts) ? db.posts : [];
  db.comments = Array.isArray(db.comments) ? db.comments : [];
  db.likes = Array.isArray(db.likes) ? db.likes : [];
  db.messages = Array.isArray(db.messages) ? db.messages : [];
  db.counters = { ...cloneDefaultDb().counters, ...(db.counters || {}) };

  db.users = db.users.map((user) => {
    const username = cleanText(user.username || user.nickname || `user${user.id}`, 24).trim();
    const nickname = cleanText(user.displayName || user.nickname || username, 24).trim();
    return {
      id: Number(user.id),
      username,
      nickname,
      displayName: nickname,
      passwordHash: user.passwordHash,
      avatarUrl: user.avatarUrl || '',
      bio: cleanText(user.bio, 180).trim(),
      location: cleanText(user.location, 24).trim(),
      interests: Array.isArray(user.interests) ? user.interests.slice(0, 8) : [],
      createdAt: user.createdAt || now(),
      updatedAt: user.updatedAt || user.createdAt || now()
    };
  }).filter((user) => user.id && user.passwordHash);

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

function nextCounter(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+$/g, '').slice(0, max);
}

function normalizeAccount(value) {
  const account = cleanText(value, 24).trim();
  if (!/^[a-zA-Z0-9_\-.]{3,24}$/.test(account)) return null;
  return account;
}

function normalizeNickname(value) {
  const nickname = cleanText(value, 24).trim();
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-. ]{2,24}$/.test(nickname)) return null;
  return nickname;
}

function publicUser(user, viewerId = null) {
  if (!user) return null;
  const postsCount = db.posts.filter((post) => post.userId === user.id).length;
  const unreadCount = viewerId
    ? db.messages.filter((message) => message.fromUserId === user.id && message.toUserId === viewerId && !message.readAt).length
    : 0;

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

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.users.find((user) => user.id === req.session.userId) || null;
}

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

const storage = multer.diskStorage({
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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'secret_garden.sid',
  secret: process.env.SESSION_SECRET || 'local-demo-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));
app.use(express.static(PUBLIC_DIR));

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: publicUser(user, user?.id) });
});

app.post('/api/register', upload.single('avatar'), async (req, res) => {
  const username = normalizeAccount(req.body.username);
  const nickname = normalizeNickname(req.body.nickname || req.body.username);
  const password = String(req.body.password || '');

  if (!username) return res.status(400).json({ error: '账号需要 3-24 位，只能包含英文、数字、下划线、横线或点' });
  if (!nickname) return res.status(400).json({ error: '昵称需要 2-24 位，可以包含中文、英文、数字和空格' });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ error: '密码需要 6-72 位' });

  const exists = db.users.some((user) => user.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(409).json({ error: '这个账号已经被注册' });

  const user = {
    id: db.counters.user++,
    username,
    nickname,
    displayName: nickname,
    passwordHash: await bcrypt.hash(password, 10),
    avatarUrl: req.file ? `/uploads/${req.file.filename}` : '',
    bio: '',
    location: '',
    interests: [],
    createdAt: now(),
    updatedAt: now()
  };

  db.users.push(user);
  saveDb();
  req.session.userId = user.id;
  res.json({ user: publicUser(user, user.id) });
});

app.post('/api/login', async (req, res) => {
  const account = String(req.body.username || req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find((item) => item.username.toLowerCase() === account.toLowerCase());
  if (!user) return res.status(401).json({ error: '账号或密码错误' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '账号或密码错误' });

  req.session.userId = user.id;
  res.json({ user: publicUser(user, user.id) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.patch('/api/profile', requireLogin, upload.single('avatar'), (req, res) => {
  const nickname = normalizeNickname(req.body.nickname || req.user.nickname);
  if (!nickname) return res.status(400).json({ error: '昵称需要 2-24 位，可以包含中文、英文、数字和空格' });

  req.user.nickname = nickname;
  req.user.displayName = nickname;
  req.user.bio = cleanText(req.body.bio, 180).trim();
  req.user.location = cleanText(req.body.location, 24).trim();
  req.user.interests = cleanText(req.body.interests, 120)
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (req.file) req.user.avatarUrl = `/uploads/${req.file.filename}`;
  req.user.updatedAt = now();
  saveDb();
  res.json({ user: publicUser(req.user, req.user.id) });
});

app.patch('/api/password', requireLogin, async (req, res) => {
  const oldPassword = String(req.body.oldPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 6 || newPassword.length > 72) return res.status(400).json({ error: '新密码需要 6-72 位' });

  const ok = await bcrypt.compare(oldPassword, req.user.passwordHash);
  if (!ok) return res.status(400).json({ error: '原密码不正确' });

  req.user.passwordHash = await bcrypt.hash(newPassword, 10);
  req.user.updatedAt = now();
  saveDb();
  res.json({ ok: true });
});

app.get('/api/users', requireLogin, (req, res) => {
  const users = db.users
    .filter((user) => user.id !== req.user.id)
    .map((user) => publicUser(user, req.user.id))
    .sort((a, b) => b.unreadCount - a.unreadCount || a.nickname.localeCompare(b.nickname, 'zh-Hans-CN'));
  res.json({ users });
});

app.get('/api/users/:id', requireLogin, (req, res) => {
  const userId = Number(req.params.id);
  const user = db.users.find((item) => item.id === userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const recentPosts = db.posts
    .filter((post) => post.userId === user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6)
    .map((post) => postDto(post, req.user.id));
  res.json({ user: publicUser(user, req.user.id), recentPosts });
});

function postDto(post, viewerId) {
  const author = db.users.find((user) => user.id === post.userId);
  const comments = db.comments
    .filter((comment) => comment.postId === post.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: publicUser(db.users.find((user) => user.id === comment.userId), viewerId)
    }));

  const likes = db.likes.filter((like) => like.postId === post.id);
  return {
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    createdAt: post.createdAt,
    author: publicUser(author, viewerId),
    comments,
    likesCount: likes.length,
    likedByMe: Boolean(viewerId && likes.some((like) => like.userId === viewerId))
  };
}

app.get('/api/posts', (req, res) => {
  const viewer = currentUser(req);
  const posts = db.posts
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((post) => postDto(post, viewer?.id));
  res.json({ posts });
});

app.post('/api/posts', requireLogin, upload.single('image'), (req, res) => {
  const content = cleanText(req.body.content, 800).trim();
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
  if (!content && !imageUrl) return res.status(400).json({ error: '文字和图片至少发一个' });

  const post = {
    id: db.counters.post++,
    userId: req.user.id,
    content,
    imageUrl,
    createdAt: now()
  };
  db.posts.push(post);
  saveDb();
  res.json({ post: postDto(post, req.user.id) });
});

app.post('/api/posts/:id/comments', requireLogin, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.posts.find((item) => item.id === postId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const content = cleanText(req.body.content, 280).trim();
  if (!content) return res.status(400).json({ error: '评论不能为空' });

  const comment = {
    id: db.counters.comment++,
    postId,
    userId: req.user.id,
    content,
    createdAt: now()
  };
  db.comments.push(comment);
  saveDb();
  res.json({ post: postDto(post, req.user.id) });
});

app.post('/api/posts/:id/like', requireLogin, (req, res) => {
  const postId = Number(req.params.id);
  const post = db.posts.find((item) => item.id === postId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const index = db.likes.findIndex((like) => like.postId === postId && like.userId === req.user.id);
  if (index >= 0) db.likes.splice(index, 1);
  else db.likes.push({ postId, userId: req.user.id, createdAt: now() });

  saveDb();
  res.json({ post: postDto(post, req.user.id) });
});

function messageDto(message, viewerId) {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
    mine: message.fromUserId === viewerId,
    from: publicUser(db.users.find((user) => user.id === message.fromUserId), viewerId),
    to: publicUser(db.users.find((user) => user.id === message.toUserId), viewerId)
  };
}

app.get('/api/messages/threads', requireLogin, (req, res) => {
  const related = db.messages
    .filter((message) => message.fromUserId === req.user.id || message.toUserId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const threads = [];
  const seen = new Set();
  for (const message of related) {
    const otherId = message.fromUserId === req.user.id ? message.toUserId : message.fromUserId;
    if (seen.has(otherId)) continue;
    seen.add(otherId);
    const unreadCount = db.messages.filter((item) => item.fromUserId === otherId && item.toUserId === req.user.id && !item.readAt).length;
    threads.push({
      user: publicUser(db.users.find((user) => user.id === otherId), req.user.id),
      lastMessage: message.content,
      lastAt: message.createdAt,
      unreadCount
    });
  }

  res.json({ threads: threads.filter((thread) => thread.user) });
});

app.get('/api/messages/:otherId', requireLogin, (req, res) => {
  const otherId = Number(req.params.otherId);
  const other = db.users.find((user) => user.id === otherId);
  if (!other) return res.status(404).json({ error: '用户不存在' });

  let touched = false;
  for (const message of db.messages) {
    if (message.fromUserId === otherId && message.toUserId === req.user.id && !message.readAt) {
      message.readAt = now();
      touched = true;
    }
  }
  if (touched) saveDb();

  const messages = db.messages
    .filter((message) =>
      (message.fromUserId === req.user.id && message.toUserId === otherId) ||
      (message.fromUserId === otherId && message.toUserId === req.user.id)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((message) => messageDto(message, req.user.id));

  res.json({ other: publicUser(other, req.user.id), messages });
});

app.post('/api/messages', requireLogin, (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const to = db.users.find((user) => user.id === toUserId);
  if (!to) return res.status(404).json({ error: '收件人不存在' });
  if (to.id === req.user.id) return res.status(400).json({ error: '不能给自己发私信' });

  const content = cleanText(req.body.content, 1000).trim();
  if (!content) return res.status(400).json({ error: '私信不能为空' });

  const message = {
    id: db.counters.message++,
    fromUserId: req.user.id,
    toUserId: to.id,
    content,
    createdAt: now(),
    readAt: null
  };
  db.messages.push(message);
  saveDb();
  res.json({ message: messageDto(message, req.user.id) });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片不能超过 4MB' });
  res.status(400).json({ error: err.message || '请求失败' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Secret Garden running at http://localhost:${PORT}`);
});
