# 秘密花园

一个 Node.js + Express 社区网站，支持注册登录、头像、资料页、动态、评论、点赞和私信。

## 18+ 社区治理

网站包含基础成人社区治理能力：

- 18+ 年龄确认入口
- 首页社区规则说明
- 用户可举报帖子
- 管理员可查看举报
- 管理员可删除帖子
- 管理员可封禁用户

这不是先审后发模式，用户发布后会立即展示；管理员通过举报后台进行事后处理。

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:3000
```

## 数据存储

项目现在支持两种模式：

1. 没有配置环境变量时：使用本地 `data/db.json` 和 `public/uploads/`，只适合本地测试。
2. 配置云端环境变量后：文字数据进入 PostgreSQL，头像和图片进入 Cloudinary，适合线上使用。

## 线上环境变量

当前 `render.yaml` 会让 Render 自动创建 PostgreSQL，并自动设置：

```text
DATABASE_URL
PGSSL=true
SESSION_SECRET
```

图片存储还需要你在 Render 的网站服务里进入 `Environment`，添加 Cloudinary 相关变量：

```text
CLOUDINARY_CLOUD_NAME=你的 Cloudinary cloud name
CLOUDINARY_API_KEY=你的 Cloudinary api key
CLOUDINARY_API_SECRET=你的 Cloudinary api secret
```

管理员可以删除帖子、封禁用户、查看举报。你可以设置：

```text
ADMIN_USERNAMES=你的账号名
```

如果不设置，数据库里的第一个用户会自动拥有管理员权限。

如果你使用 Cloudinary 的单条连接地址，也可以只设置：

```text
CLOUDINARY_URL=cloudinary://...
```

设置完成后，重新部署网站。没有 Cloudinary 配置时，图片仍然会临时保存到 `public/uploads/`，不适合长期使用。

## 从本地 JSON 导入 PostgreSQL

先设置 `DATABASE_URL`，然后执行：

```bash
npm run import:json
```

这个脚本会把本地 `data/db.json` 里的用户、帖子、评论、点赞和私信导入 PostgreSQL。

## 注意

Render 免费 Web Service 的本地文件系统不是长期存储。正式使用时不要依赖 `data/db.json` 或 `public/uploads/` 保存用户数据。
