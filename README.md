# ☁️ Cloudflare Temp Email

基于 Cloudflare Workers + D1 打造的临时邮箱服务，无需服务器即可快速搭建，支持接收邮件并自动提取验证码。

[在线演示](#) · [问题反馈](https://github.com/XddXss888/cloudflare-temp-email/issues)

---

## ✨ 功能特性

| 特性 | 说明 |
|------|------|
| 🎲 随机邮箱 | 自动生成随机前缀的临时邮箱地址 |
| 📬 邮件接收 | 支持接收任意邮件到指定域名 |
| 🔐 验证码提取 | 自动从邮件内容中提取 4-8 位数字字母验证码 |
| 🔄 Base64 支持 | 自动解析 Base64 编码的邮件内容 |
| 🚀 无服务器 | 纯 Cloudflare Workers，无需额外服务器费用 |
| 📱 API 驱动 | 纯 REST API 接口，易于集成 |

---

## 🏁 快速开始

### 前置准备

- Cloudflare 账号
- 已添加至 Cloudflare 的域名

### 步骤一：创建数据库

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → D1 → Create Database
3. 命名为 `temp-email-db`
4. 点击数据库 → Console，执行以下 SQL：

```sql
CREATE TABLE mail_boxes (
  id INTEGER PRIMARY KEY, 
  address TEXT UNIQUE, 
  created_at TIMESTAMP
);

CREATE TABLE mails (
  id INTEGER PRIMARY KEY, 
  mailbox TEXT, 
  subject TEXT, 
  from_address TEXT, 
  body TEXT, 
  verification_code TEXT, 
  created_at TIMESTAMP
);
```

### 步骤二：创建 Worker

1. Workers → Create New Worker
2. 命名为 `temp-email-worker`
3. 粘贴下方代码后 Deploy

<details>
<summary>📄 展开 Worker 代码</summary>

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get("Authorization");
    if (!auth || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = auth.slice(7);
    if (token !== "mytoken888") return json({ error: "Unauthorized" }, 401);
    
    if (request.method === "GET" && url.pathname === "/api/generate") return handleGenerate(env);
    if (request.method === "GET" && url.pathname === "/api/emails") return handleEmails(url, env);
    if (request.method === "DELETE" && url.pathname === "/api/mailboxes") return handleDelete(url, env);
    
    return json({ error: "Not Found" }, 404);
  },
  
  async email(message, env) {
    const to = message.to;
    const domains = env.DOMAINS.split(",").map(d => d.trim());
    const matched = domains.some(d => to.endsWith("." + d) || to.endsWith("@" + d));
    if (!matched) return;
    
    const from = message.from;
    const reader = message.raw.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const body = new TextDecoder().decode(merged);
    
    const subjectMatch = body.match(/^Subject:\s*(.+)$/mi);
    const subject = subjectMatch ? subjectMatch[1].trim() : "";
    const code = extractVerificationCode(body);
    
    await env.DB.prepare(
      "INSERT INTO mails (mailbox, subject, from_address, body, verification_code) VALUES (?, ?, ?, ?, ?)"
    ).bind(to, subject, from, body.substring(0, 50000), code).run();
  }
};

function extractVerificationCode(body) {
  const codeRegex = /\b([A-Za-z0-9]{4,8})\b/;
  const plainMatch = body.match(/Content-Type: text\/plain[\s\S]*?(?===-|$)/i);
  if (plainMatch) {
    const textPart = plainMatch[0];
    if (textPart.includes("Content-Transfer-Encoding: base64")) {
      const base64Match = textPart.match(/[A-Za-z0-9+\/=]{20,}/);
      if (base64Match) {
        try {
          const decoded = atob(base64Match[0]);
          const codeMatch = decoded.match(codeRegex);
          if (codeMatch) return codeMatch[1];
        } catch (e) {}
      }
    } else {
      const codeMatch = textPart.match(codeRegex);
      if (codeMatch) return codeMatch[1];
    }
  }
  const subjectLines = body.split("\n");
  for (const line of subjectLines) {
    if (line.toLowerCase().startsWith("subject:")) {
      const codeMatch = line.match(codeRegex);
      if (codeMatch) return codeMatch[1];
    }
  }
  const bodyMatch = body.match(codeRegex);
  return bodyMatch ? bodyMatch[1] : null;
}

async function handleGenerate(env) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let name = "", sub = "";
  for (let i = 0; i < 6; i++) name += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 6; i++) sub += chars[Math.floor(Math.random() * chars.length)];
  const domains = env.DOMAINS.split(",").map(d => d.trim());
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const address = name + "@" + sub + "." + domain;
  await env.DB.prepare("INSERT OR IGNORE INTO mail_boxes (address) VALUES (?)").bind(address).run();
  return json({ email: address });
}

async function handleEmails(url, env) {
  const mailbox = url.searchParams.get("mailbox");
  if (!mailbox) return json({ error: "mailbox required" }, 400);
  const result = await env.DB.prepare(
    "SELECT * FROM mails WHERE mailbox = ? ORDER BY created_at DESC LIMIT 10"
  ).bind(mailbox).all();
  return json(result.results || []);
}

async function handleDelete(url, env) {
  const address = url.searchParams.get("address");
  if (!address) return json({ error: "address required" }, 400);
  await env.DB.prepare("DELETE FROM mails WHERE mailbox = ?").bind(address).run();
  await env.DB.prepare("DELETE FROM mail_boxes WHERE address = ?").bind(address).run();
  return json({ success: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
```

</details>

### 步骤三：绑定数据库

Worker 详情页 → Settings → Bindings → Add → D1

| 配置项 | 值 |
|--------|-----|
| Variable name | `DB` |
| D1 database | `temp-email-db` |

### 步骤四：配置环境变量

同步骤三，进入环境变量配置页面：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `DOMAINS` | `your-domain.com` | 你的域名，多个用逗号分隔 |
| `FREEMAIL_TOKEN` | `mytoken888` | API 访问令牌 |

### 步骤五：配置邮件路由

1. 进入域名 Dashboard → Email → Email Routing
2. Enable Email Routing
3. 创建 Catch-all 地址
4. Send to Worker → `temp-email-worker`

### 步骤六：添加 MX 记录

进入域名 DNS 设置，添加以下记录：

| 类型 | 名称 | 内容 | 优先级 |
|------|------|------|--------|
| MX | `@` | `route1.mx.cloudflare.net` | 13 |
| MX | `@` | `route2.mx.cloudflare.net` | 40 |
| MX | `@` | `route3.mx.cloudflare.net` | 21 |

> 💡 如果需要支持子域名邮箱，名称填写 `*`

---

## 📡 API 文档

### 基础信息

| 配置项 | 值 |
|--------|-----|
| Base URL | `https://temp-email-worker.你的账号.workers.dev` |
| 认证方式 | Bearer Token |
| Token | `mytoken888` |

### 接口列表

#### 生成临时邮箱

```http
GET /api/generate
```

**响应示例：**

```json
{
  "email": "abc123@def456.your-domain.com"
}
```

#### 获取邮件列表

```http
GET /api/emails?mailbox=<邮箱地址>
```

**响应示例：**

```json
[
  {
    "mailbox": "abc123@def456.your-domain.com",
    "subject": "Your verification code",
    "from_address": "noreply@example.com",
    "verification_code": "AB1234",
    "body": "...",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

#### 删除邮箱

```http
DELETE /api/mailboxes?address=<邮箱地址>
```

**响应示例：**

```json
{
  "success": true
}
```

### cURL 示例

```bash
# 生成临时邮箱
curl -X GET "https://temp-email-worker.你的账号.workers.dev/api/generate" \
  -H "Authorization: Bearer mytoken888"

# 获取邮件
curl -X GET "https://temp-email-worker.你的账号.workers.dev/api/emails?mailbox=abc123@def456.your-domain.com" \
  -H "Authorization: Bearer mytoken888"

# 删除邮箱
curl -X DELETE "https://temp-email-worker.你的账号.workers.dev/api/mailboxes?address=abc123@def456.your-domain.com" \
  -H "Authorization: Bearer mytoken888"
```

---

## 📦 项目结构

```
cloudflare-temp-email/
└── README.md    # 项目文档
```

---

## ⚙️ 自定义配置

| 环境变量 | 必填 | 说明 |
|----------|------|------|
| `DOMAINS` | ✅ | 允许接收邮件的域名，多个用逗号分隔 |
| `FREEMAIL_TOKEN` | ✅ | API 认证令牌 |

---

## 📄 开源协议

MIT License · 由 [XddXss888](https://github.com/XddXss888) 编写
