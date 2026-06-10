# 秘密花园

一个 Node.js + Express 社区网站，支持注册登录、头像、资料页、动态、评论、点赞和私信。

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

在 Render 的网站服务里进入 `Environment`，添加：

```text
SESSION_SECRET=一串很长的随机字符
DATABASE_URL=你的 PostgreSQL 连接地址
PGSSL=true
CLOUDINARY_CLOUD_NAME=你的 Cloudinary cloud name
CLOUDINARY_API_KEY=你的 Cloudinary api key
CLOUDINARY_API_SECRET=你的 Cloudinary api secret
```

如果你使用 Cloudinary 的单条连接地址，也可以只设置：

```text
CLOUDINARY_URL=cloudinary://...
```

设置完成后，重新部署网站。

## 从本地 JSON 导入 PostgreSQL

先设置 `DATABASE_URL`，然后执行：

```bash
npm run import:json
```

这个脚本会把本地 `data/db.json` 里的用户、帖子、评论、点赞和私信导入 PostgreSQL。

## 注意

Render 免费 Web Service 的本地文件系统不是长期存储。正式使用时不要依赖 `data/db.json` 或 `public/uploads/` 保存用户数据。
