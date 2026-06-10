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

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read database:', err);
    return structuredClone(defaultDb);
  }
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nickname: user.nickname,
    displayName: user.displayName,
    bio: user.bio || '',
    createdAt: user.createdAt
  };
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.users.find(u => u.id === req.session.userId) || null;
}

function requireLogin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  next();
}

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+$/g, '').slice(0, max);
}

function assertNickname(nickname) {
  const n = cleanText(nickname, 24).trim();
  const ok = /^[\u4e00-\u9fa5a-zA-Z0-9_\-.]{2,24}$/.test(n);
  if (!ok) return null;
  return n;
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
  name: 'womens_secret.sid',
  secret: process.env.SESSION_SECRET || 'local-demo-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(PUBLIC_DIR));

app.get('/api/me', (req, res) => {
  res.json({ user: publicUser(currentUser(req)) });
});

app.post('/api/register', async (req, res) => {
  const nickname = assertNickname(req.body.nickname);
  const password = String(req.body.password || '');
  if (!nickname) return res.status(400).json({ error: '昵称需为 2-24 位，可含中文、英文、数字、_、-、.' });
  if (password.length < 6 || password.length > 72) return res.status(400).json({ error: '密码需为 6-72 位' });

  const exists = db.users.some(u => u.nickname.toLowerCase() === nickname.toLowerCase());
  if (exists) return res.status(409).json({ error: '这个昵称已经被注册' });

  const user = {
    id: db.counters.user++,
    nickname,
    displayName: nickname,
    passwordHash: await bcrypt.hash(password, 10),
    bio: '',
    createdAt: now()
  };
  db.users.push(user);
  saveDb();
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const nickname = String(req.body.nickname || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find(u => u.nickname.toLowerCase() === nickname.toLowerCase());
  if (!user) return res.status(401).json({ error: '昵称或密码错误' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '昵称或密码错误' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.patch('/api/profile', requireLogin, (req, res) => {
  const displayName = cleanText(req.body.displayName, 24).trim();
  const bio = cleanText(req.body.bio, 80).trim();
  if (displayName.length < 2) return res.status(400).json({ error: '展示昵称至少 2 个字符' });
  req.user.displayName = displayName;
  req.user.bio = bio;
  saveDb();
  res.json({ user: publicUser(req.user) });
});

app.get('/api/users', requireLogin, (req, res) => {
  const users = db.users
    .filter(u => u.id !== req.user.id)
    .map(publicUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
  res.json({ users });
});

function postDto(post, viewerId) {
  const author = db.users.find(u => u.id === post.userId);
  const comments = db.comments
    .filter(c => c.postId === post.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(c => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      author: publicUser(db.users.find(u => u.id === c.userId))
    }));

  const likes = db.likes.filter(l => l.postId === post.id);
  return {
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    createdAt: post.createdAt,
    author: publicUser(author),
    comments,
    likesCount: likes.length,
    likedByMe: Boolean(viewerId && likes.some(l => l.userId === viewerId))
  };
}

app.get('/api/posts', (req, res) => {
  const viewer = currentUser(req);
  const posts = db.posts
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(post => postDto(post, viewer?.id));
  res.json({ posts });
});

app.post('/api/posts', requireLogin, upload.single('image'), (req, res) => {
  const content = cleanText(req.body.content, 600).trim();
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
  const post = db.posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  const content = cleanText(req.body.content, 260).trim();
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
  const post = db.posts.find(p => p.id === postId);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const index = db.likes.findIndex(l => l.postId === postId && l.userId === req.user.id);
  if (index >= 0) db.likes.splice(index, 1);
  else db.likes.push({ postId, userId: req.user.id, createdAt: now() });
  saveDb();
  res.json({ post: postDto(post, req.user.id) });
});

app.get('/api/messages', requireLogin, (req, res) => {
  const related = db.messages
    .filter(m => m.fromUserId === req.user.id || m.toUserId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const byOther = new Map();
  for (const msg of related) {
    const otherId = msg.fromUserId === req.user.id ? msg.toUserId : msg.fromUserId;
    if (!byOther.has(otherId)) {
      byOther.set(otherId, {
        user: publicUser(db.users.find(u => u.id === otherId)),
        lastMessage: msg.content,
        lastAt: msg.createdAt
      });
    }
  }
  res.json({ threads: Array.from(byOther.values()).filter(t => t.user) });
});

app.get('/api/messages/:otherId', requireLogin, (req, res) => {
  const otherId = Number(req.params.otherId);
  const other = db.users.find(u => u.id === otherId);
  if (!other) return res.status(404).json({ error: '用户不存在' });

  const messages = db.messages
    .filter(m =>
      (m.fromUserId === req.user.id && m.toUserId === otherId) ||
      (m.fromUserId === otherId && m.toUserId === req.user.id)
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(m => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt,
      mine: m.fromUserId === req.user.id,
      from: publicUser(db.users.find(u => u.id === m.fromUserId)),
      to: publicUser(db.users.find(u => u.id === m.toUserId))
    }));
  res.json({ other: publicUser(other), messages });
});

app.post('/api/messages', requireLogin, (req, res) => {
  const toUserId = Number(req.body.toUserId);
  const to = db.users.find(u => u.id === toUserId);
  if (!to) return res.status(404).json({ error: '收件人不存在' });
  if (to.id === req.user.id) return res.status(400).json({ error: '不能给自己发私信' });
  const content = cleanText(req.body.content, 500).trim();
  if (!content) return res.status(400).json({ error: '私信不能为空' });

  const message = {
    id: db.counters.message++,
    fromUserId: req.user.id,
    toUserId: to.id,
    content,
    createdAt: now()
  };
  db.messages.push(message);
  saveDb();
  res.json({ message });
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
  console.log(`女人的秘密 running at http://localhost:${PORT}`);
});
