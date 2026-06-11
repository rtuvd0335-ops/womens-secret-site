const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it first, then run npm run import:json.');
  process.exit(1);
}

if (!fs.existsSync(DB_FILE)) {
  console.error(`No local JSON database found at ${DB_FILE}`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUsePgSsl() ? { rejectUnauthorized: false } : false
});

function shouldUsePgSsl() {
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === 'true') return true;
  return !/localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL);
}

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+$/g, '').slice(0, max);
}

function normalizeInterests(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 20).trim()).filter(Boolean).slice(0, 8);
  return cleanText(value, 120).split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function migrateJsonDb(source) {
  const db = {
    users: Array.isArray(source.users) ? source.users : [],
    posts: Array.isArray(source.posts) ? source.posts : [],
    comments: Array.isArray(source.comments) ? source.comments : [],
    likes: Array.isArray(source.likes) ? source.likes : [],
    messages: Array.isArray(source.messages) ? source.messages : []
    ,
    reports: Array.isArray(source.reports) ? source.reports : []
  };

  db.users = db.users.map((user) => {
    const username = cleanText(user.username || user.nickname || `user${user.id}`, 24).trim();
    const nickname = cleanText(user.nickname || user.displayName || username, 24).trim();
    return {
      id: Number(user.id),
      username,
      nickname,
      passwordHash: user.passwordHash,
      avatarUrl: user.avatarUrl || '',
      bio: cleanText(user.bio, 180).trim(),
      location: cleanText(user.location, 24).trim(),
      interests: normalizeInterests(user.interests || ''),
      bannedAt: user.bannedAt || null,
      createdAt: user.createdAt || new Date().toISOString(),
      updatedAt: user.updatedAt || user.createdAt || new Date().toISOString()
    };
  }).filter((user) => user.id && user.username && user.passwordHash);

  db.posts = db.posts.map((post) => ({
    id: Number(post.id),
    userId: Number(post.userId),
    content: cleanText(post.content, 800).trim(),
    imageUrl: post.imageUrl || '',
    createdAt: post.createdAt || new Date().toISOString()
  })).filter((post) => post.id && post.userId && (post.content || post.imageUrl));

  db.comments = db.comments.map((comment) => ({
    id: Number(comment.id),
    postId: Number(comment.postId),
    userId: Number(comment.userId),
    content: cleanText(comment.content, 280).trim(),
    createdAt: comment.createdAt || new Date().toISOString()
  })).filter((comment) => comment.id && comment.postId && comment.userId && comment.content);

  db.likes = db.likes.map((like) => ({
    postId: Number(like.postId),
    userId: Number(like.userId),
    createdAt: like.createdAt || new Date().toISOString()
  })).filter((like) => like.postId && like.userId);

  db.messages = db.messages.map((message) => ({
    id: Number(message.id),
    fromUserId: Number(message.fromUserId),
    toUserId: Number(message.toUserId),
    content: cleanText(message.content, 1000).trim(),
    createdAt: message.createdAt || new Date().toISOString(),
    readAt: message.readAt || null
  })).filter((message) => message.id && message.fromUserId && message.toUserId && message.content);

  db.reports = db.reports.map((report) => ({
    id: Number(report.id),
    postId: Number(report.postId),
    userId: Number(report.userId),
    reason: cleanText(report.reason, 500).trim(),
    createdAt: report.createdAt || new Date().toISOString()
  })).filter((report) => report.id && report.postId && report.userId && report.reason);

  return db;
}

async function ensureSchema() {
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
      banned_at TIMESTAMPTZ,
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

    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function importData(db) {
  await pool.query('BEGIN');
  try {
    for (const user of db.users) {
      await pool.query(
        `INSERT INTO users (id, username, nickname, password_hash, avatar_url, bio, location, interests, banned_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (username) DO UPDATE SET
           nickname = EXCLUDED.nickname,
           password_hash = EXCLUDED.password_hash,
           avatar_url = EXCLUDED.avatar_url,
           bio = EXCLUDED.bio,
           location = EXCLUDED.location,
           interests = EXCLUDED.interests,
           banned_at = EXCLUDED.banned_at,
           updated_at = EXCLUDED.updated_at`,
        [user.id, user.username, user.nickname, user.passwordHash, user.avatarUrl, user.bio, user.location, user.interests, user.bannedAt, user.createdAt, user.updatedAt]
      );
    }

    for (const post of db.posts) {
      await pool.query(
        `INSERT INTO posts (id, user_id, content, image_url, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, image_url = EXCLUDED.image_url`,
        [post.id, post.userId, post.content, post.imageUrl, post.createdAt]
      );
    }

    for (const comment of db.comments) {
      await pool.query(
        `INSERT INTO comments (id, post_id, user_id, content, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`,
        [comment.id, comment.postId, comment.userId, comment.content, comment.createdAt]
      );
    }

    for (const like of db.likes) {
      await pool.query(
        'INSERT INTO likes (post_id, user_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [like.postId, like.userId, like.createdAt]
      );
    }

    for (const message of db.messages) {
      await pool.query(
        `INSERT INTO messages (id, from_user_id, to_user_id, content, created_at, read_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, read_at = EXCLUDED.read_at`,
        [message.id, message.fromUserId, message.toUserId, message.content, message.createdAt, message.readAt]
      );
    }

    for (const report of db.reports) {
      await pool.query(
        `INSERT INTO reports (id, post_id, user_id, reason, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET reason = EXCLUDED.reason`,
        [report.id, report.postId, report.userId, report.reason, report.createdAt]
      );
    }

    await pool.query("SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1))");
    await pool.query("SELECT setval(pg_get_serial_sequence('posts', 'id'), COALESCE((SELECT MAX(id) FROM posts), 1))");
    await pool.query("SELECT setval(pg_get_serial_sequence('comments', 'id'), COALESCE((SELECT MAX(id) FROM comments), 1))");
    await pool.query("SELECT setval(pg_get_serial_sequence('messages', 'id'), COALESCE((SELECT MAX(id) FROM messages), 1))");
    await pool.query("SELECT setval(pg_get_serial_sequence('reports', 'id'), COALESCE((SELECT MAX(id) FROM reports), 1))");
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

(async () => {
  const db = migrateJsonDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  await ensureSchema();
  await importData(db);
  await pool.end();
  console.log(`Imported ${db.users.length} users, ${db.posts.length} posts, ${db.comments.length} comments, ${db.likes.length} likes, ${db.messages.length} messages, ${db.reports.length} reports.`);
})().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
