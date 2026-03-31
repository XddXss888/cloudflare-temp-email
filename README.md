# Cloudflare Worker 临时邮箱

基于 Cloudflare Workers + D1 数据库的临时邮箱服务，支持接收邮件并自动提取验证码。

---

## 快速开始

### 1. 创建数据库
- Workers & Pages → D1 → Create `temp-email-db`
- Console 执行：
```sql
CREATE TABLE mail_boxes (id INTEGER PRIMARY KEY, address TEXT UNIQUE, created_at TIMESTAMP);
CREATE TABLE mails (id INTEGER PRIMARY KEY, mailbox TEXT, subject TEXT, from_address TEXT, body TEXT, verification_code TEXT, created_at TIMESTAMP);
```

### 2. 创建 Worker
- Workers → Create → Hello World → `temp-email-worker`
- 粘贴下方代码

<details>
<summary>点击展开 Worker 代码</summary>

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

### 3. 绑定数据库
- Settings → Bindings → Add → D1 → DB = temp-email-db

### 4. 设置环境变量
| Variable | Value |
|----------|-------|
| FREEMAIL_TOKEN | mytoken888 |
| DOMAINS | 你的域名 |

### 5. Email Routing
- 域名 → Email → Enable → Catch-all → Send to Worker → temp-email-worker

### 6. 添加域名记录
| 类型 | 名称 | 内容 | 优先级 |
|------|------|------|--------|
| MX | * | route1.mx.cloudflare.net | 13 |
| MX | * | route2.mx.cloudflare.net | 40 |
| MX | * | route3.mx.cloudflare.net | 21 |

---

## API

**地址**: `https://temp-email-worker.你的账号.workers.dev`  
**Token**: `mytoken888`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/generate | 生成临时邮箱 |
| GET | /api/emails?mailbox=xxx | 读取邮件 |
| DELETE | /api/mailboxes?address=xxx | 删除邮箱 |

### 示例
```bash
# 生成邮箱
curl "https://temp-email-worker.你的账号.workers.dev/api/generate" -H "Authorization: Bearer mytoken888"

# 查看邮件
curl "https://temp-email-worker.你的账号.workers.dev/api/emails?mailbox=xxx@xxx.com" -H "Authorization: Bearer mytoken888"
```