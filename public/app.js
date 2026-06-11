const state = {
  me: null,
  posts: [],
  users: [],
  threads: [],
  currentChatUserId: null,
  activePanel: 'feedPanel'
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  landingView: $('#landingView'),
  appView: $('#appView'),
  registerForm: $('#registerForm'),
  loginForm: $('#loginForm'),
  postForm: $('#postForm'),
  profileForm: $('#profileForm'),
  passwordForm: $('#passwordForm'),
  logoutBtn: $('#logoutBtn'),
  feed: $('#feed'),
  peopleGrid: $('#peopleGrid'),
  threadList: $('#threadList'),
  messageList: $('#messageList'),
  messageForm: $('#messageForm'),
  chatHeader: $('#chatHeader'),
  imagePreview: $('#imagePreview'),
  toast: $('#toast'),
  profileDialog: $('#profileDialog'),
  profileDialogBody: $('#profileDialogBody'),
  reportDialog: $('#reportDialog'),
  reportForm: $('#reportForm'),
  adminNav: $('#adminNav'),
  adminReports: $('#adminReports'),
  ageGate: $('#ageGate'),
  ageAcceptBtn: $('#ageAcceptBtn'),
  ageLeaveBtn: $('#ageLeaveBtn'),
  meName: $('#meName'),
  meAccount: $('#meAccount'),
  myAvatarBtn: $('#myAvatarBtn'),
  settingsAvatar: $('#settingsAvatar'),
  settingsName: $('#settingsName'),
  settingsAccount: $('#settingsAccount'),
  panelTitle: $('#panelTitle')
};

const panelTitles = {
  feedPanel: '动态',
  peoplePanel: '用户',
  inboxPanel: '私信',
  settingsPanel: '我的',
  adminPanel: '管理'
};

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function userInitial(user) {
  return (user?.nickname || user?.username || '?').trim().slice(0, 1).toUpperCase();
}

function avatarMarkup(user, size = '') {
  const label = escapeHtml(userInitial(user));
  const src = user?.avatarUrl ? escapeHtml(user.avatarUrl) : '';
  const className = `avatar ${size}`.trim();
  return src
    ? `<span class="${className}"><img src="${src}" alt="${escapeHtml(user.nickname || '用户头像')}" /></span>`
    : `<span class="${className}">${label}</span>`;
}

function setAvatarButton(button, user) {
  if (!button) return;
  button.innerHTML = avatarMarkup(user, button.classList.contains('large') ? 'large' : '');
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

function setLoggedIn(loggedIn) {
  els.landingView.classList.toggle('hidden', loggedIn);
  els.appView.classList.toggle('hidden', !loggedIn);
}

async function refreshAll() {
  const data = await api('/api/me');
  state.me = data.user;
  setLoggedIn(Boolean(state.me));

  if (!state.me) {
    await loadPosts();
    return;
  }

  renderMe();
  await Promise.all([loadPosts(), loadUsers(), loadThreads()]);
  switchPanel(state.activePanel);
}

function renderMe() {
  els.meName.textContent = state.me.nickname;
  els.meAccount.textContent = `@${state.me.username}`;
  els.settingsName.textContent = state.me.nickname;
  els.settingsAccount.textContent = `@${state.me.username}`;
  setAvatarButton(els.myAvatarBtn, state.me);
  setAvatarButton(els.settingsAvatar, state.me);
  els.adminNav?.classList.toggle('hidden', !state.me.isAdmin);

  els.profileForm.nickname.value = state.me.nickname || '';
  els.profileForm.bio.value = state.me.bio || '';
  els.profileForm.location.value = state.me.location || '';
  els.profileForm.interests.value = (state.me.interests || []).join('，');
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

async function loadThreads() {
  if (!state.me) return;
  const data = await api('/api/messages/threads');
  state.threads = data.threads || [];
  renderThreads();
}

async function loadAdminReports() {
  if (!state.me?.isAdmin || !els.adminReports) return;
  const data = await api('/api/admin/reports');
  renderAdminReports(data.reports || []);
}

function switchPanel(panelId) {
  if (panelId === 'adminPanel' && !state.me?.isAdmin) return showToast('需要管理员权限');
  state.activePanel = panelId;
  $$('.panel-view').forEach((panel) => panel.classList.toggle('active', panel.id === panelId));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.panel === panelId));
  els.panelTitle.textContent = panelTitles[panelId] || '社区';
  if (panelId === 'adminPanel') loadAdminReports().catch((err) => showToast(err.message));
}

function renderPosts() {
  if (!state.posts.length) {
    els.feed.innerHTML = '<div class="empty-state">还没有动态。发布第一条内容，让社区开始呼吸。</div>';
    return;
  }

  els.feed.innerHTML = state.posts.map((post) => {
    const author = post.author || { id: 0, nickname: '已注销用户', username: 'unknown' };
    const comments = (post.comments || []).map((comment) => {
      const ca = comment.author || { nickname: '已注销用户' };
      return `
        <div class="comment">
          <button class="inline-user" data-user-id="${ca.id || ''}" type="button">${escapeHtml(ca.nickname)}</button>
          <span>${escapeHtml(comment.content)}</span>
          <small>${formatTime(comment.createdAt)}</small>
        </div>`;
    }).join('');

    return `
      <article class="post-card" data-post-id="${post.id}">
        <header class="post-head">
          <button class="avatar-btn" data-user-id="${author.id}" type="button">${avatarMarkup(author)}</button>
          <div>
            <button class="name-link" data-user-id="${author.id}" type="button">${escapeHtml(author.nickname)}</button>
            <span>@${escapeHtml(author.username)} · ${formatTime(post.createdAt)}</span>
          </div>
        </header>
        ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ''}
        ${post.imageUrl ? `<img class="post-image" src="${escapeHtml(post.imageUrl)}" alt="用户发布的图片" loading="lazy" />` : ''}
        <div class="post-actions">
          <button class="chip-btn ${post.likedByMe ? 'active' : ''}" data-action="like" type="button">喜欢 ${post.likesCount}</button>
          <button class="chip-btn" data-action="focus-comment" type="button">评论 ${post.comments.length}</button>
          ${state.me ? `<button class="chip-btn" data-action="report" type="button">举报</button>` : ''}
          ${state.me?.isAdmin ? `<button class="chip-btn danger" data-action="admin-delete-post" type="button">删除</button>` : ''}
        </div>
        <div class="comment-list">
          ${comments || '<p class="muted">还没有评论</p>'}
        </div>
        <form class="comment-form">
          <input name="content" maxlength="280" placeholder="写评论" ${state.me ? '' : 'disabled'} />
          <button class="outline-btn small" type="submit" ${state.me ? '' : 'disabled'}>发送</button>
        </form>
      </article>`;
  }).join('');
}

function renderAdminReports(reports) {
  if (!reports.length) {
    els.adminReports.innerHTML = '<div class="empty-state">目前没有举报。</div>';
    return;
  }

  els.adminReports.innerHTML = reports.map((report) => {
    const post = report.post;
    const author = post?.author;
    return `
      <article class="admin-card" data-post-id="${post?.id || ''}" data-user-id="${author?.id || ''}">
        <div class="admin-card-head">
          <strong>举报 #${report.id}</strong>
          <span>${formatTime(report.createdAt)}</span>
        </div>
        <p><strong>原因：</strong>${escapeHtml(report.reason)}</p>
        <p><strong>举报人：</strong>${report.reporter ? escapeHtml(report.reporter.nickname) : '未知用户'}</p>
        ${post ? `
          <div class="reported-post">
            <p><strong>作者：</strong>${escapeHtml(author?.nickname || '未知用户')} @${escapeHtml(author?.username || '')}</p>
            <p>${escapeHtml(post.content || '发布了一张图片')}</p>
            ${post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" alt="被举报图片" />` : ''}
          </div>
          <div class="card-actions">
            <button class="outline-btn small" data-admin-action="delete-post" type="button">删除帖子</button>
            <button class="solid-btn small danger-solid" data-admin-action="ban-user" type="button">封禁作者</button>
          </div>
        ` : '<p class="muted">该帖子已经被删除。</p>'}
      </article>
    `;
  }).join('');
}

function renderUsers() {
  if (!state.users.length) {
    els.peopleGrid.innerHTML = '<div class="empty-state">还没有其他用户。可以让朋友注册后一起测试资料页和私信。</div>';
    return;
  }

  els.peopleGrid.innerHTML = state.users.map((user) => `
    <article class="person-card" data-user-id="${user.id}">
      <button class="avatar-btn large" data-user-id="${user.id}" type="button">${avatarMarkup(user, 'large')}</button>
      <div>
        <h3>${escapeHtml(user.nickname)}</h3>
        <p>@${escapeHtml(user.username)}</p>
      </div>
      <p class="bio">${escapeHtml(user.bio || '这个人还没有写简介。')}</p>
      <div class="tags">${(user.interests || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
      <div class="card-actions">
        <button class="outline-btn small" data-action="profile" type="button">查看资料</button>
        <button class="solid-btn small" data-action="message" type="button">私信</button>
      </div>
      ${user.unreadCount ? `<span class="badge">${user.unreadCount}</span>` : ''}
    </article>
  `).join('');
}

function renderThreads() {
  if (!state.threads.length) {
    els.threadList.innerHTML = '<div class="empty-state">还没有私信。去用户列表里选择一个人开始聊天。</div>';
    return;
  }

  els.threadList.innerHTML = state.threads.map((thread) => `
    <button class="thread-row ${state.currentChatUserId === thread.user.id ? 'active' : ''}" data-user-id="${thread.user.id}" type="button">
      ${avatarMarkup(thread.user)}
      <span>
        <strong>${escapeHtml(thread.user.nickname)}</strong>
        <small>${escapeHtml(thread.lastMessage)}</small>
      </span>
      ${thread.unreadCount ? `<em>${thread.unreadCount}</em>` : ''}
    </button>
  `).join('');
}

async function openProfile(userId) {
  const data = await api(`/api/users/${userId}`);
  const user = data.user;
  const recentPosts = data.recentPosts || [];
  els.profileDialogBody.innerHTML = `
    <section class="dialog-profile">
      ${avatarMarkup(user, 'xl')}
      <h2>${escapeHtml(user.nickname)}</h2>
      <p>@${escapeHtml(user.username)}</p>
      <div class="profile-stats">
        <span><strong>${user.postsCount}</strong>动态</span>
        <span><strong>${formatTime(user.createdAt)}</strong>加入</span>
      </div>
      <p class="bio">${escapeHtml(user.bio || '这个人还没有写简介。')}</p>
      ${user.location ? `<p class="muted">所在地：${escapeHtml(user.location)}</p>` : ''}
      <div class="tags">${(user.interests || []).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>
      ${state.me?.id !== user.id ? `<button class="solid-btn full" data-dialog-message="${user.id}" type="button">给她发私信</button>` : ''}
    </section>
    <section class="dialog-posts">
      <h3>最近动态</h3>
      ${recentPosts.length ? recentPosts.map((post) => `<p>${escapeHtml(post.content || '发布了一张图片')}</p>`).join('') : '<p class="muted">暂无动态</p>'}
    </section>
  `;
  els.profileDialog.showModal();
}

async function openChat(userId) {
  state.currentChatUserId = Number(userId);
  const data = await api(`/api/messages/${state.currentChatUserId}`);
  els.chatHeader.innerHTML = `${avatarMarkup(data.other)}<strong>${escapeHtml(data.other.nickname)}</strong><span>@${escapeHtml(data.other.username)}</span>`;
  els.messageForm.classList.remove('hidden');
  renderMessages(data.messages || []);
  await Promise.all([loadThreads(), loadUsers()]);
  switchPanel('inboxPanel');
}

function renderMessages(messages) {
  if (!messages.length) {
    els.messageList.className = 'message-list empty';
    els.messageList.textContent = '还没有消息。写一句话开始聊天。';
    return;
  }

  els.messageList.className = 'message-list';
  els.messageList.innerHTML = messages.map((message) => `
    <div class="message ${message.mine ? 'mine' : ''}">
      <p>${escapeHtml(message.content)}</p>
      <small>${formatTime(message.createdAt)}</small>
    </div>
  `).join('');
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function resetAuthForms() {
  els.registerForm.reset();
  els.loginForm.reset();
}

$$('[data-scroll-auth]').forEach((button) => {
  button.addEventListener('click', () => $('#authPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
});

$$('[data-auth-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    const tab = button.dataset.authTab;
    $$('[data-auth-tab]').forEach((item) => item.classList.toggle('active', item.dataset.authTab === tab));
    els.registerForm.classList.toggle('hidden', tab !== 'register');
    els.loginForm.classList.toggle('hidden', tab !== 'login');
  });
});

$$('[data-panel], [data-panel-shortcut]').forEach((button) => {
  button.addEventListener('click', () => switchPanel(button.dataset.panel || button.dataset.panelShortcut));
});

els.registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/register', { method: 'POST', body: new FormData(els.registerForm) });
    resetAuthForms();
    showToast('注册成功，欢迎来到秘密花园');
    await refreshAll();
  } catch (err) {
    showToast(err.message);
  }
});

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: { username: form.get('username'), password: form.get('password') }
    });
    resetAuthForms();
    showToast('登录成功');
    await refreshAll();
  } catch (err) {
    showToast(err.message);
  }
});

els.logoutBtn.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    state.me = null;
    state.currentChatUserId = null;
    showToast('已退出登录');
    await refreshAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
  els.imagePreview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="图片预览" />`;
  els.imagePreview.classList.remove('hidden');
});

els.postForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.me) return showToast('请先登录');

  try {
    await api('/api/posts', { method: 'POST', body: new FormData(els.postForm) });
    els.postForm.reset();
    els.imagePreview.innerHTML = '';
    els.imagePreview.classList.add('hidden');
    showToast('发布成功');
    await loadPosts();
  } catch (err) {
    showToast(err.message);
  }
});

els.feed.addEventListener('click', async (event) => {
  const userButton = event.target.closest('[data-user-id]');
  if (userButton && userButton.dataset.userId) {
    await openProfile(userButton.dataset.userId).catch((err) => showToast(err.message));
    return;
  }

  const button = event.target.closest('button[data-action]');
  const card = event.target.closest('.post-card');
  if (!button || !card) return;
  const postId = card.dataset.postId;

  if (button.dataset.action === 'like') {
    if (!state.me) return showToast('请先登录再点赞');
    await api(`/api/posts/${postId}/like`, { method: 'POST' }).catch((err) => showToast(err.message));
    await loadPosts();
  }

  if (button.dataset.action === 'focus-comment') {
    $('input[name="content"]', card)?.focus();
  }

  if (button.dataset.action === 'report') {
    els.reportForm.postId.value = postId;
    els.reportForm.reason.value = '';
    els.reportDialog.showModal();
  }

  if (button.dataset.action === 'admin-delete-post') {
    if (!confirm('确定删除这条帖子吗？')) return;
    await api(`/api/admin/posts/${postId}`, { method: 'DELETE' }).catch((err) => showToast(err.message));
    await loadPosts();
  }
});

els.feed.addEventListener('submit', async (event) => {
  const form = event.target.closest('.comment-form');
  if (!form) return;
  event.preventDefault();
  if (!state.me) return showToast('请先登录再评论');

  const card = form.closest('.post-card');
  const content = new FormData(form).get('content');
  try {
    await api(`/api/posts/${card.dataset.postId}/comments`, { method: 'POST', body: { content } });
    form.reset();
    await loadPosts();
  } catch (err) {
    showToast(err.message);
  }
});

els.peopleGrid.addEventListener('click', async (event) => {
  const card = event.target.closest('.person-card');
  const id = event.target.closest('[data-user-id]')?.dataset.userId || card?.dataset.userId;
  if (!id) return;

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'message') {
    await openChat(id).catch((err) => showToast(err.message));
  } else {
    await openProfile(id).catch((err) => showToast(err.message));
  }
});

els.threadList.addEventListener('click', async (event) => {
  const row = event.target.closest('.thread-row');
  if (!row) return;
  await openChat(row.dataset.userId).catch((err) => showToast(err.message));
});

els.messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentChatUserId) return showToast('请先选择会话');
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

els.profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/profile', { method: 'PATCH', body: new FormData(els.profileForm) });
    state.me = data.user;
    renderMe();
    showToast('资料已保存');
    await Promise.all([loadPosts(), loadUsers(), loadThreads()]);
  } catch (err) {
    showToast(err.message);
  }
});

els.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.passwordForm);
  try {
    await api('/api/password', {
      method: 'PATCH',
      body: {
        oldPassword: form.get('oldPassword'),
        newPassword: form.get('newPassword')
      }
    });
    els.passwordForm.reset();
    showToast('密码已更新');
  } catch (err) {
    showToast(err.message);
  }
});

els.myAvatarBtn.addEventListener('click', () => switchPanel('settingsPanel'));
els.settingsAvatar.addEventListener('click', () => els.profileForm.avatar.click());

els.profileDialog.addEventListener('click', async (event) => {
  if (event.target.matches('[data-close-dialog]')) {
    els.profileDialog.close();
    return;
  }

  const messageButton = event.target.closest('[data-dialog-message]');
  if (messageButton) {
    const userId = messageButton.dataset.dialogMessage;
    els.profileDialog.close();
    await openChat(userId).catch((err) => showToast(err.message));
  }
});

els.reportDialog.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-report]')) els.reportDialog.close();
});

els.reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(els.reportForm);
  try {
    await api('/api/reports', {
      method: 'POST',
      body: {
        postId: form.get('postId'),
        reason: form.get('reason')
      }
    });
    els.reportDialog.close();
    showToast('举报已提交');
  } catch (err) {
    showToast(err.message);
  }
});

els.adminReports?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-admin-action]');
  if (!button) return;
  const card = button.closest('.admin-card');
  const postId = card?.dataset.postId;
  const userId = card?.dataset.userId;

  try {
    if (button.dataset.adminAction === 'delete-post' && postId) {
      if (!confirm('确定删除这条帖子吗？')) return;
      await api(`/api/admin/posts/${postId}`, { method: 'DELETE' });
      showToast('帖子已删除');
    }

    if (button.dataset.adminAction === 'ban-user' && userId) {
      if (!confirm('确定封禁这个用户吗？')) return;
      await api(`/api/admin/users/${userId}/ban`, { method: 'POST' });
      showToast('用户已封禁');
    }

    await Promise.all([loadAdminReports(), loadPosts(), loadUsers()]);
  } catch (err) {
    showToast(err.message);
  }
});

function initAgeGate() {
  if (localStorage.getItem('secretGardenAgeOk') === 'yes') return;
  els.ageGate?.classList.remove('hidden');
}

els.ageAcceptBtn?.addEventListener('click', () => {
  localStorage.setItem('secretGardenAgeOk', 'yes');
  els.ageGate.classList.add('hidden');
});

els.ageLeaveBtn?.addEventListener('click', () => {
  window.location.href = 'https://www.google.com';
});

initAgeGate();
refreshAll().catch((err) => showToast(err.message));
