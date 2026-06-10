const state = {
  me: null,
  posts: [],
  users: [],
  currentChatUserId: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  authView: $('#authView'),
  mainView: $('#mainView'),
  loginForm: $('#loginForm'),
  registerForm: $('#registerForm'),
  postForm: $('#postForm'),
  profileForm: $('#profileForm'),
  logoutBtn: $('#logoutBtn'),
  meBadge: $('#meBadge'),
  feed: $('#feed'),
  usersList: $('#usersList'),
  imagePreview: $('#imagePreview'),
  toast: $('#toast'),
  messagesBox: $('#messagesBox'),
  messageForm: $('#messageForm'),
  chatHint: $('#chatHint')
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function avatarText(user) {
  return (user?.displayName || user?.nickname || '?').trim().slice(0, 1).toUpperCase();
}

async function api(path, options = {}) {
  const config = {
    credentials: 'same-origin',
    headers: {},
    ...options
  };
  if (config.body && !(config.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const res = await fetch(path, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function setView(loggedIn) {
  els.authView.classList.toggle('hidden', loggedIn);
  els.mainView.classList.toggle('hidden', !loggedIn);
}

async function refreshMe() {
  const data = await api('/api/me');
  state.me = data.user;
  setView(Boolean(state.me));
  if (state.me) {
    els.meBadge.textContent = `@${state.me.nickname}`;
    els.profileForm.displayName.value = state.me.displayName || state.me.nickname;
    els.profileForm.bio.value = state.me.bio || '';
    await Promise.all([loadPosts(), loadUsers()]);
  } else {
    await loadPosts();
  }
}

async function loadPosts() {
  const data = await api('/api/posts');
  state.posts = data.posts || [];
  renderPosts();
}

async function loadUsers() {
  if (!state.me) return;
  const data = await api('/api/users');
  state.users = data.users || [];
  renderUsers();
}

function renderPosts() {
  if (!state.posts.length) {
    els.feed.innerHTML = '<div class="empty">还没有秘密。成为第一个发布的人吧。</div>';
    return;
  }

  els.feed.innerHTML = state.posts.map(post => {
    const author = post.author || { displayName: '已注销用户', nickname: 'unknown' };
    const comments = post.comments.map(comment => {
      const ca = comment.author || { displayName: '已注销用户' };
      return `
        <div class="comment">
          <strong>${escapeHtml(ca.displayName)}</strong>
          <span class="meta">${formatTime(comment.createdAt)}</span>
          <div>${escapeHtml(comment.content)}</div>
        </div>`;
    }).join('');

    return `
      <article class="post-card" data-post-id="${post.id}">
        <div class="post-head">
          <div class="avatar">${escapeHtml(avatarText(author))}</div>
          <div>
            <div class="name">${escapeHtml(author.displayName)}</div>
            <div class="meta">@${escapeHtml(author.nickname)} · ${formatTime(post.createdAt)}</div>
          </div>
        </div>
        ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ''}
        ${post.imageUrl ? `<img class="post-image" src="${escapeHtml(post.imageUrl)}" alt="用户上传图片" loading="lazy" />` : ''}
        <div class="post-actions">
          <button class="action-btn like-btn ${post.likedByMe ? 'liked' : ''}" data-action="like">♡ ${post.likesCount}</button>
          <button class="action-btn" data-action="focus-comment">评论 ${post.comments.length}</button>
        </div>
        <div class="comments">
          ${comments || '<div class="meta">暂无评论</div>'}
          <form class="comment-form" data-action="comment">
            <input name="content" maxlength="260" placeholder="写评论……" ${state.me ? '' : 'disabled'} />
            <button class="secondary" type="submit" ${state.me ? '' : 'disabled'}>发送</button>
          </form>
        </div>
      </article>`;
  }).join('');
}

function renderUsers() {
  if (!state.users.length) {
    els.usersList.className = 'users-list empty';
    els.usersList.textContent = '暂无其他用户，注册另一个账号后可测试私信。';
    return;
  }

  els.usersList.className = 'users-list';
  els.usersList.innerHTML = state.users.map(user => `
    <button class="user-row ${state.currentChatUserId === user.id ? 'active' : ''}" data-user-id="${user.id}">
      <span class="avatar">${escapeHtml(avatarText(user))}</span>
      <span>
        <span class="name">${escapeHtml(user.displayName)}</span>
        <span class="meta">@${escapeHtml(user.nickname)}</span>
      </span>
    </button>
  `).join('');
}

async function openChat(userId) {
  state.currentChatUserId = Number(userId);
  renderUsers();
  const data = await api(`/api/messages/${state.currentChatUserId}`);
  els.chatHint.textContent = `正在和 ${data.other.displayName} 私信`;
  els.messageForm.classList.remove('hidden');
  renderMessages(data.messages || []);
}

function renderMessages(messages) {
  if (!messages.length) {
    els.messagesBox.className = 'messages-box empty';
    els.messagesBox.textContent = '还没有私信，发一句开始聊天吧。';
    return;
  }
  els.messagesBox.className = 'messages-box';
  els.messagesBox.innerHTML = messages.map(msg => `
    <div class="message ${msg.mine ? 'mine' : ''}">
      <div>${escapeHtml(msg.content)}</div>
      <div class="meta">${formatTime(msg.createdAt)}</div>
    </div>
  `).join('');
  els.messagesBox.scrollTop = els.messagesBox.scrollHeight;
}

function switchTab(tabName) {
  $$('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  els.loginForm.classList.toggle('hidden', tabName !== 'login');
  els.registerForm.classList.toggle('hidden', tabName !== 'register');
}

$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(els.loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: {
        nickname: form.get('nickname'),
        password: form.get('password')
      }
    });
    els.loginForm.reset();
    showToast('登录成功');
    await refreshMe();
  } catch (err) {
    showToast(err.message);
  }
});

els.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(els.registerForm);
  try {
    await api('/api/register', {
      method: 'POST',
      body: {
        nickname: form.get('nickname'),
        password: form.get('password')
      }
    });
    els.registerForm.reset();
    showToast('注册成功');
    await refreshMe();
  } catch (err) {
    showToast(err.message);
  }
});

els.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    state.me = null;
    state.currentChatUserId = null;
    els.messageForm.classList.add('hidden');
    els.messagesBox.className = 'messages-box empty';
    els.messagesBox.textContent = '还没有打开任何对话';
    showToast('已退出登录');
    await refreshMe();
  } catch (err) {
    showToast(err.message);
  }
});

els.profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(els.profileForm);
  try {
    const data = await api('/api/profile', {
      method: 'PATCH',
      body: {
        displayName: form.get('displayName'),
        bio: form.get('bio')
      }
    });
    state.me = data.user;
    els.meBadge.textContent = `@${state.me.nickname}`;
    showToast('资料已保存');
    await Promise.all([loadPosts(), loadUsers()]);
  } catch (err) {
    showToast(err.message);
  }
});

els.postForm.image.addEventListener('change', () => {
  const file = els.postForm.image.files?.[0];
  if (!file) {
    els.imagePreview.classList.add('hidden');
    els.imagePreview.innerHTML = '';
    return;
  }
  const url = URL.createObjectURL(file);
  els.imagePreview.innerHTML = `<img src="${url}" alt="预览" />`;
  els.imagePreview.classList.remove('hidden');
});

els.postForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.me) return showToast('请先登录再发布');
  const form = new FormData(els.postForm);
  try {
    await api('/api/posts', { method: 'POST', body: form });
    els.postForm.reset();
    els.imagePreview.innerHTML = '';
    els.imagePreview.classList.add('hidden');
    showToast('发布成功');
    await loadPosts();
  } catch (err) {
    showToast(err.message);
  }
});

els.feed.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const card = e.target.closest('.post-card');
  const postId = card?.dataset.postId;
  if (!postId) return;

  if (btn.dataset.action === 'like') {
    if (!state.me) return showToast('请先登录再点赞');
    try {
      await api(`/api/posts/${postId}/like`, { method: 'POST' });
      await loadPosts();
    } catch (err) {
      showToast(err.message);
    }
  }

  if (btn.dataset.action === 'focus-comment') {
    $('input[name="content"]', card)?.focus();
  }
});

els.feed.addEventListener('submit', async (e) => {
  const form = e.target.closest('.comment-form');
  if (!form) return;
  e.preventDefault();
  if (!state.me) return showToast('请先登录再评论');
  const card = form.closest('.post-card');
  const postId = card?.dataset.postId;
  const content = new FormData(form).get('content');
  try {
    await api(`/api/posts/${postId}/comments`, { method: 'POST', body: { content } });
    form.reset();
    await loadPosts();
  } catch (err) {
    showToast(err.message);
  }
});

els.usersList.addEventListener('click', async (e) => {
  const row = e.target.closest('.user-row');
  if (!row) return;
  try {
    await openChat(row.dataset.userId);
  } catch (err) {
    showToast(err.message);
  }
});

els.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentChatUserId) return showToast('请先选择聊天对象');
  const content = new FormData(els.messageForm).get('content');
  try {
    await api('/api/messages', {
      method: 'POST',
      body: { toUserId: state.currentChatUserId, content }
    });
    els.messageForm.reset();
    await openChat(state.currentChatUserId);
  } catch (err) {
    showToast(err.message);
  }
});

refreshMe().catch(err => showToast(err.message));
