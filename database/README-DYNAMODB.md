# Hướng Dẫn Setup & Thiết Kế Database — Hệ Thống Mô Phỏng Phỏng Vấn SE + AI

## 0. Yêu Cầu Hệ Thống (Prerequisites)

| Công cụ | Phiên bản tối thiểu | Mục đích |
|:---|:---|:---|
| **Node.js** | v18+ | Runtime cho Next.js |
| **npm** | v9+ | Quản lý packages |
| **MySQL** | v8.0+ | Lưu trữ users (auth, profile) |
| **AWS CLI** | v2+ | Thao tác với DynamoDB |
| **Docker** *(khuyến nghị)* | v20+ | Chạy DynamoDB Local |
| **Java Runtime** *(nếu không dùng Docker)* | v11+ | DynamoDB Local yêu cầu JRE |

---

## 1. Cấu Hình Biến Môi Trường (.env)

### 1.1. Tạo file `.env`

File `.env` cần đặt ở **cùng cấp với `package.json`** (thư mục gốc của project Next.js):

```
testing-feature/
├── .env              ← File cấu hình môi trường (ĐẶT Ở ĐÂY)
├── package.json
├── database/
│   ├── schema.sql
│   ├── setup-dynamodb.sh
│   └── ...
└── src/
```

### 1.2. Nội dung file `.env`

```env
# Database - MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=online_judge_db

# AWS DynamoDB
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=localKey
AWS_SECRET_ACCESS_KEY=secrectKey
DYNAMODB_ENDPOINT_URL=http://localhost:8000

# AI Service
OPENAI_API_KEY=sk-your-api-key

# App
NEXTAUTH_SECRET=your_random_secret
NEXTAUTH_URL=http://localhost:3000
```

### 1.3. Giải thích các biến

| Biến | Mô tả | Giá trị mẫu |
|:---|:---|:---|
| `DB_HOST` | Địa chỉ MySQL server | `localhost` |
| `DB_PORT` | Port của MySQL | `3306` |
| `DB_USER` | Tài khoản MySQL | `root` |
| `DB_PASSWORD` | Mật khẩu MySQL | *(mật khẩu của bạn)* |
| `DB_NAME` | Tên database MySQL | `online_judge_db` |
| `AWS_REGION` | Region của AWS | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key (dùng `localKey` cho local) | `localKey` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key (dùng bất kỳ cho local) | `secrectKey` |
| `DYNAMODB_ENDPOINT_URL` | URL endpoint DynamoDB Local | `http://localhost:8000` |
| `OPENAI_API_KEY` | API key của OpenAI cho tính năng AI | `sk-...` |
| `NEXTAUTH_SECRET` | Secret key cho NextAuth.js | *(chuỗi ngẫu nhiên)* |
| `NEXTAUTH_URL` | URL base của app | `http://localhost:3000` |

> ⚠️ **Lưu ý bảo mật**: File `.env` đã được thêm vào `.gitignore` (dòng `.env*`), sẽ **KHÔNG** bị push lên GitHub. Tuyệt đối không commit file `.env` chứa credentials thật.

---

## 2. Setup MySQL

### Bước 1: Khởi động MySQL Server

```bash
# Nếu dùng MySQL trên máy:
mysql.server start        # macOS
sudo service mysql start  # Linux
net start MySQL80         # Windows (PowerShell Admin)
```

### Bước 2: Chạy schema.sql để tạo database và bảng `users`

```bash
# Đăng nhập MySQL và chạy script
mysql -u root -p < database/schema.sql
```

Hoặc chạy trực tiếp trong MySQL client:

```sql
source database/schema.sql;
```

Script sẽ:
1. Tạo database `online_judge_db` (nếu chưa có)
2. Tạo bảng `users` với đầy đủ fields (role, skill_level, target_role, stats...)
3. Seed 2 tài khoản mẫu: `admin` và `student1` (mật khẩu: `password123`)

### Kiểm tra kết quả:

```sql
USE online_judge_db;
SELECT id, username, email, role, skill_level FROM users;
```

Kết quả mong đợi:

| id | username | email | role | skill_level |
|:---|:---|:---|:---|:---|
| 1 | admin | admin@example.com | ADMIN | SENIOR |
| 2 | student1 | student1@example.com | CANDIDATE | JUNIOR |

---

## 3. Setup AWS DynamoDB Local

### Cách 1: Dùng Docker (Khuyến nghị)

```bash
# Pull và chạy DynamoDB Local container
docker run -d \
    --name dynamodb-local \
    -p 8000:8000 \
    amazon/dynamodb-local:latest

# Kiểm tra container đang chạy
docker ps | grep dynamodb
```

### Cách 2: Download trực tiếp (Không cần Docker)

```bash
# Download DynamoDB Local
curl -O https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz
tar -xzf dynamodb_local_latest.tar.gz
cd dynamodb_local_latest

# Chạy (cần Java 11+)
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb -port 8000
```

### Kiểm tra DynamoDB Local đang hoạt động:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000 --region us-east-1
```

Kết quả mong đợi: `{ "TableNames": [] }`

---

## 4. Tạo Bảng DynamoDB & Seed Data

### Chạy script setup (tạo cả 2 bảng: `Problems` + `Interviews`):

```bash
cd database/

# Cấp quyền thực thi
chmod +x setup-dynamodb.sh

# Chạy script (tự động đọc .env)
./setup-dynamodb.sh
```

> **Lưu ý trên Windows (PowerShell)**: Nếu không dùng được bash, hãy cài Git Bash hoặc WSL, rồi chạy:
> ```powershell
> bash ./database/setup-dynamodb.sh
> ```

Script sẽ tự động:
1. Đọc file `.env` để lấy `DYNAMODB_ENDPOINT_URL`, `AWS_REGION`
2. **Part 1**: Tạo bảng `Problems` + 2 GSI + seed 2 đề bài + 2 submissions
3. **Part 2**: Tạo bảng `Interviews` + 2 GSI + seed 1 phiên phỏng vấn mẫu (session + 4 chat messages + 1 code snapshot + 1 AI evaluation)
4. Demo các access patterns cho cả 2 bảng

### Kiểm tra kết quả:

```bash
# Liệt kê tất cả bảng
aws dynamodb list-tables \
    --endpoint-url http://localhost:8000 \
    --region us-east-1
```

Kết quả mong đợi:

```json
{
    "TableNames": [
        "Interviews",
        "Problems"
    ]
}
```

---

## 5. Setup Next.js App

```bash
# Cài dependencies
npm install

# Chạy dev server
npm run dev
```

App sẽ chạy tại: `http://localhost:3000`

---

## 6. Tóm Tắt Thứ Tự Setup

```
┌──────────────────────────────────────────────────┐
│  Bước 1: Tạo file .env (cấu hình credentials)   │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Bước 2: Setup MySQL                             │
│  → mysql -u root -p < database/schema.sql        │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Bước 3: Khởi động DynamoDB Local                │
│  → docker run -d -p 8000:8000                    │
│    amazon/dynamodb-local:latest                   │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Bước 4: Tạo bảng DynamoDB + Seed data           │
│  → bash database/setup-dynamodb.sh               │
└──────────────────┬───────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Bước 5: Chạy Next.js                            │
│  → npm install && npm run dev                    │
└──────────────────────────────────────────────────┘
```

---

## 7. Tổng Quan Kiến Trúc Database

Hệ thống sử dụng **Kiến trúc Hybrid (Polyglot Persistence)** kết hợp:
- **MySQL**: Quản lý bảng `users` (ACID, auth, profile, stats)
- **AWS DynamoDB**: 2 bảng Single-Table Design:
  - **`Problems`**: Đề bài, test cases nhúng, submissions
  - **`Interviews`**: Phiên phỏng vấn mô phỏng, chat messages, code snapshots, AI evaluation

### Sơ đồ kiến trúc:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MySQL (ACID / Auth)                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  users: id, username, email, password, role, skill_level │   │
│  │         target_role, total_interviews, avg_score, ...    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │ user_id                         │ user_id
         ▼                                 ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│  DynamoDB: Problems      │   │  DynamoDB: Interviews            │
│  ┌────────────────────┐  │   │  ┌─────────────────────────────┐ │
│  │ Problem Metadata   │◄─┼───┼──│ Interview Session (METADATA)│ │
│  │ (sk = METADATA)    │  │   │  │ interview_type, ai_model,   │ │
│  │ + hints, tags,     │  │   │  │ status, overall_score       │ │
│  │   companies, ...   │  │   │  └─────────────────────────────┘ │
│  └────────────────────┘  │   │  ┌─────────────────────────────┐ │
│  ┌────────────────────┐  │   │  │ Chat Messages (MSG#...)     │ │
│  │ Submissions        │  │   │  │ sender, content,            │ │
│  │ (sk = SUBMISSION#) │  │   │  │ message_type                │ │
│  │ + ai_review,       │  │   │  └─────────────────────────────┘ │
│  │   memory, tests    │  │   │  ┌─────────────────────────────┐ │
│  └────────────────────┘  │   │  │ Code Snapshots (CODE#...)   │ │
│                          │   │  │ code, test_results,         │ │
│  GSI: user-submissions   │   │  │ ai_code_review              │ │
│  GSI: category-difficulty│   │  └─────────────────────────────┘ │
└──────────────────────────┘   │  ┌─────────────────────────────┐ │
                               │  │ AI Evaluation (EVAL#...)    │ │
                               │  │ scores (5 tiêu chí),        │ │
                               │  │ strengths, weaknesses,      │ │
                               │  │ hire_recommendation         │ │
                               │  └─────────────────────────────┘ │
                               │                                  │
                               │  GSI: user-interviews-index      │
                               │  GSI: problem-interviews-index   │
                               └──────────────────────────────────┘
```

---

## 8. Bảng `Problems` (Single-Table Design)

### Khóa chính (Primary Key):
- **Partition Key (PK - HASH)**: `problem_id` (String) — ví dụ: `"prob_1"`
- **Sort Key (SK - RANGE)**: `sk` (String)
  - Đối với đề bài: `sk = "METADATA"`
  - Đối với bài nộp: `sk = "SUBMISSION#<submission_id>"`

### Chỉ mục phụ toàn cục (GSI):

| Tên GSI | Partition Key (HASH) | Sort Key (RANGE) | Loại chỉ mục | Mục đích sử dụng |
| :--- | :--- | :--- | :--- | :--- |
| **`user-submissions-index`** | `user_id` (String) | `created_at` (String) | Sparse GSI | Lấy lịch sử nộp bài của 1 học viên |
| **`category-difficulty-index`** | `category` (String) | `difficulty` (String) | Sparse GSI | Lọc bài tập theo chủ đề và độ khó |

### 8.1. Item Đề bài (`sk = "METADATA"`)
```json
{
  "problem_id": "prob_1",
  "sk": "METADATA",
  "entity_type": "PROBLEM",
  "title": "Two Sum",
  "description": "Given an array of integers nums and an integer target...",
  "difficulty": "EASY",
  "category": "Array",
  "starter_code": "def two_sum(nums, target):\n    pass",
  "test_cases": [
    { "id": 1, "input": "[2,7,11,15]\n9", "output": "[0,1]", "is_sample": true },
    { "id": 2, "input": "[3,2,4]\n6", "output": "[1,2]", "is_sample": true },
    { "id": 3, "input": "[3,3]\n6", "output": "[0,1]", "is_sample": false }
  ],
  "hints": ["Thử dùng hashmap để lưu giá trị đã duyệt", "Xem xét complement = target - nums[i]"],
  "tags": ["hashmap", "array", "two-pointer"],
  "companies": ["Google", "Amazon", "Meta", "Apple"],
  "interview_frequency": 95,
  "constraints": "1 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9",
  "follow_up_questions": [
    "Nếu array đã sorted thì approach thay đổi thế nào?",
    "Nếu có nhiều hơn 2 số (3Sum, 4Sum) thì giải quyết ra sao?"
  ],
  "supported_languages": ["python", "javascript", "java", "cpp"],
  "created_at": "2026-09-07T10:10:00Z"
}
```

### 8.2. Item Lượt nộp bài (`sk = "SUBMISSION#..."`)
```json
{
  "problem_id": "prob_1",
  "sk": "SUBMISSION#sub_1725700000001",
  "entity_type": "SUBMISSION",
  "submission_id": "sub_1725700000001",
  "user_id": "2",
  "language": "python",
  "code": "def two_sum(nums, target): ...",
  "status": "ACCEPTED",
  "execution_time_ms": 45,
  "memory_usage_kb": 14200,
  "test_cases_passed": 3,
  "total_test_cases": 3,
  "error_message": null,
  "ai_review": "Code sử dụng hashmap approach tối ưu O(n). Biến đặt tên rõ ràng...",
  "interview_id": "intv_1725700000001",
  "created_at": "2026-09-07T10:30:00Z"
}
```

---

## 9. Bảng `Interviews` (Single-Table Design)

### Khóa chính (Primary Key):
- **Partition Key (PK - HASH)**: `interview_id` (String) — ví dụ: `"intv_1725700000001"`
- **Sort Key (SK - RANGE)**: `sk` (String)
  - Phiên phỏng vấn: `sk = "METADATA"`
  - Tin nhắn chat: `sk = "MSG#<timestamp>#<msg_id>"`
  - Code snapshot: `sk = "CODE#<timestamp>"`
  - Đánh giá AI: `sk = "EVAL#<eval_id>"`

### Chỉ mục phụ toàn cục (GSI):

| Tên GSI | Partition Key (HASH) | Sort Key (RANGE) | Mục đích sử dụng |
| :--- | :--- | :--- | :--- |
| **`user-interviews-index`** | `user_id` (String) | `started_at` (String) | Lấy lịch sử phỏng vấn của 1 user |
| **`problem-interviews-index`** | `problem_id` (String) | `started_at` (String) | Xem thống kê phỏng vấn theo bài |

### 9.1. Item Phiên Phỏng Vấn (`sk = "METADATA"`)
```json
{
  "interview_id": "intv_1725700000001",
  "sk": "METADATA",
  "entity_type": "INTERVIEW",
  "user_id": "2",
  "problem_id": "prob_1",
  "interview_type": "CODING",
  "difficulty": "EASY",
  "status": "COMPLETED",
  "ai_model": "gpt-4o",
  "duration_seconds": 2700,
  "overall_score": 78,
  "started_at": "2026-09-07T10:00:00Z",
  "completed_at": "2026-09-07T10:45:00Z"
}
```

### 9.2. Item Tin Nhắn Chat (`sk = "MSG#..."`)
```json
{
  "interview_id": "intv_1725700000001",
  "sk": "MSG#2026-09-07T10:01:00Z#msg_001",
  "entity_type": "MESSAGE",
  "sender": "AI",
  "content": "Chào bạn! Hôm nay chúng ta sẽ cùng giải bài Two Sum...",
  "message_type": "QUESTION",
  "created_at": "2026-09-07T10:01:00Z"
}
```

### 9.3. Item Code Snapshot (`sk = "CODE#..."`)
```json
{
  "interview_id": "intv_1725700000001",
  "sk": "CODE#2026-09-07T10:15:00Z",
  "entity_type": "CODE_SNAPSHOT",
  "language": "python",
  "code": "def two_sum(nums, target): ...",
  "test_results": {
    "passed": 3,
    "total": 3,
    "details": [
      { "test_id": 1, "status": "PASSED", "execution_time_ms": 12 }
    ]
  },
  "ai_code_review": "Code tốt! Sử dụng hashmap đạt O(n) time và O(n) space.",
  "created_at": "2026-09-07T10:15:00Z"
}
```

### 9.4. Item Đánh Giá AI (`sk = "EVAL#..."`)
```json
{
  "interview_id": "intv_1725700000001",
  "sk": "EVAL#eval_001",
  "entity_type": "EVALUATION",
  "scores": {
    "problem_solving": 80,
    "code_quality": 85,
    "communication": 75,
    "time_management": 85,
    "optimization": 70
  },
  "overall_score": 78,
  "strengths": ["Giải thích approach rõ ràng", "Code clean"],
  "weaknesses": ["Cần gợi ý mới nghĩ ra optimal approach"],
  "suggestions": ["Luyện phân tích bài trước khi code"],
  "hire_recommendation": "LEAN_YES",
  "created_at": "2026-09-07T10:46:00Z"
}
```

---

## 10. Bảng Tra Cứu Access Patterns (Mẫu Truy Vấn)

### Bảng `Problems`:

| STT | Nhu cầu người dùng | Cơ chế truy vấn DynamoDB | Câu lệnh mẫu |
| :--- | :--- | :--- | :--- |
| **AP1** | Xem nội dung đề bài & test cases | `GetItem` trên bảng chính | `Key: { problem_id: 'prob_1', sk: 'METADATA' }` |
| **AP2** | Xem danh sách bài nộp của bài toán | `Query` trên bảng chính | `problem_id = 'prob_1' AND begins_with(sk, 'SUBMISSION#')` |
| **AP3** | Lấy cả đề bài lẫn các lượt nộp gần nhất | `Query` trên bảng chính (1 request) | `problem_id = 'prob_1'` |
| **AP4** | Học viên xem lịch sử nộp bài của mình | `Query` qua **GSI: `user-submissions-index`** | `user_id = '2'` |
| **AP5** | Lọc bài tập theo dạng bài và độ khó | `Query` qua **GSI: `category-difficulty-index`** | `category = 'Array' AND difficulty = 'EASY'` |

### Bảng `Interviews`:

| STT | Nhu cầu người dùng | Cơ chế truy vấn DynamoDB | Câu lệnh mẫu |
| :--- | :--- | :--- | :--- |
| **AP1** | Xem thông tin phiên phỏng vấn | `GetItem` trên bảng chính | `Key: { interview_id: 'intv_xxx', sk: 'METADATA' }` |
| **AP2** | Xem lại toàn bộ chat trong phỏng vấn | `Query` trên bảng chính | `interview_id = 'intv_xxx' AND begins_with(sk, 'MSG#')` |
| **AP3** | Xem code snapshots theo thời gian | `Query` trên bảng chính | `interview_id = 'intv_xxx' AND begins_with(sk, 'CODE#')` |
| **AP4** | Xem đánh giá AI cho phỏng vấn | `Query` trên bảng chính | `interview_id = 'intv_xxx' AND begins_with(sk, 'EVAL#')` |
| **AP5** | Lấy toàn bộ context phỏng vấn (1 request) | `Query` trên bảng chính | `interview_id = 'intv_xxx'` |
| **AP6** | Xem lịch sử phỏng vấn của user | `Query` qua **GSI: `user-interviews-index`** | `user_id = '2'` |
| **AP7** | Thống kê phỏng vấn theo bài | `Query` qua **GSI: `problem-interviews-index`** | `problem_id = 'prob_1'` |

---

## 11. Truy Vấn Bằng SQL Trên DynamoDB (PartiQL)

Trong AWS Console -> DynamoDB -> **PartiQL editor**:

### Bảng Problems:
```sql
-- Lấy thông tin đề bài Two Sum:
SELECT * FROM "Problems"
WHERE "problem_id" = 'prob_1' AND "sk" = 'METADATA';

-- Lấy toàn bộ các bài nộp của bài Two Sum:
SELECT * FROM "Problems"
WHERE "problem_id" = 'prob_1' AND "sk" LIKE 'SUBMISSION#%';

-- Dùng GSI lấy lịch sử nộp bài của user 2:
SELECT * FROM "Problems"."user-submissions-index"
WHERE "user_id" = '2';
```

### Bảng Interviews:
```sql
-- Lấy thông tin phiên phỏng vấn:
SELECT * FROM "Interviews"
WHERE "interview_id" = 'intv_1725700000001' AND "sk" = 'METADATA';

-- Lấy toàn bộ chat messages của phiên phỏng vấn:
SELECT * FROM "Interviews"
WHERE "interview_id" = 'intv_1725700000001' AND "sk" LIKE 'MSG#%';

-- Lấy đánh giá AI:
SELECT * FROM "Interviews"
WHERE "interview_id" = 'intv_1725700000001' AND "sk" LIKE 'EVAL#%';

-- Dùng GSI lấy lịch sử phỏng vấn của user 2:
SELECT * FROM "Interviews"."user-interviews-index"
WHERE "user_id" = '2';

-- Dùng GSI lấy thống kê phỏng vấn theo bài:
SELECT * FROM "Interviews"."problem-interviews-index"
WHERE "problem_id" = 'prob_1';
```

---

## 12. Xử Lý Sự Cố (Troubleshooting)

| Lỗi | Nguyên nhân | Cách sửa |
|:---|:---|:---|
| `Could not connect to the endpoint URL: http://localhost:8000` | DynamoDB Local chưa chạy | Chạy `docker start dynamodb-local` hoặc khởi động lại container |
| `Table already exists` | Bảng đã được tạo trước đó | Script sẽ tự bỏ qua và tiếp tục. Nếu muốn tạo lại, xóa bảng trước: `aws dynamodb delete-table --table-name Problems --endpoint-url http://localhost:8000` |
| `Access denied for user 'root'@'localhost'` | Sai mật khẩu MySQL | Kiểm tra `DB_PASSWORD` trong `.env` |
| `Unknown database 'online_judge_db'` | Chưa chạy `schema.sql` | Chạy `mysql -u root -p < database/schema.sql` |
| `bash: ./setup-dynamodb.sh: Permission denied` | Chưa cấp quyền thực thi | Chạy `chmod +x database/setup-dynamodb.sh` |
