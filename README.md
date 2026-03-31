# Cloudflare 临时邮箱搭建

## 步骤

### 1. 创建数据库
- Workers & Pages → D1 → Create `temp-email-db`
- Console 执行：
```sql
CREATE TABLE mail_boxes (id INTEGER PRIMARY KEY, address TEXT UNIQUE, created_at TIMESTAMP);
CREATE TABLE mails (id INTEGER PRIMARY KEY, mailbox TEXT, subject TEXT, from_address TEXT, body TEXT, verification_code TEXT, created_at TIMESTAMP);
```

### 2. 创建 Worker
- Workers → Create → Hello World → `temp-email-worker`
- Edit Code 粘贴 worker 代码 → Deploy

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

## 测试 API

```
URL: https://temp-email-worker.你的账号.workers.dev
Token: mytoken888
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/generate | 生成临时邮箱 |
| GET | /api/emails?mailbox=xxx | 读取邮件 |
| DELETE | /api/mailboxes?address=xxx | 删除邮箱 |

### 示例
```bash
curl "https://temp-email-worker.你的账号.workers.dev/api/generate" -H "Authorization: Bearer mytoken888"
```
