# SimuTech Backend - Hệ Thống Mô Phỏng Phỏng Vấn SE Hỗ Trợ AI

Backend dịch vụ cho nền tảng mô phỏng phỏng vấn kỹ thuật phần mềm (Software Engineering Mock Interview), hỗ trợ hỏi đáp tương tác hai chiều thời gian thực với AI, đồng bộ mã nguồn, nộp bài chấm thử và tổng hợp báo cáo đánh giá năng lực chi tiết.

---

## 🏛️ Kiến Trúc Hệ Thống (Architecture Overview)

Dự án áp dụng kiến trúc phân tầng (**Layered Architecture**) kết hợp với mô hình lưu trữ đa cơ chế (**Polyglot Persistence**):

```
┌─────────────────────────────────────────────────────────────┐
│                 Next.js App Router (API Routes)             │
│        (Auth, Problems, Interviews, Submissions, Health)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                       Service Layer                         │
│       (AuthService, ProblemService, InterviewService)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                      Repository Layer                       │
│    (UserRepository, ProblemRepository, InterviewRepository) │
└──────────────────┬───────────────────────┬──────────────────┘
                   │                       │
         ┌─────────▼─────────┐   ┌─────────▼─────────┐
         │       MySQL       │   │    AWS DynamoDB   │
         │ (ACID, Auth, User)│   │(Single-Table NoSQL)│
         └───────────────────┘   └───────────────────┘
```

* **MySQL**: Quản lý tài khoản, phân quyền (`ADMIN`, `CANDIDATE`), hồ sơ năng lực và điểm trung bình tích lũy (bảo đảm tính nhất quán ACID).
* **AWS DynamoDB (Single-Table Design)**:
  * Bảng `Problems`: Lưu trữ thông tin đề bài, test cases và các lần nộp bài (Submissions).
  * Bảng `Interviews`: Lưu trữ toàn bộ phiên phỏng vấn, tin nhắn trao đổi (Chat Messages), lịch sử mã nguồn (Code Snapshots) và báo cáo đánh giá AI (Evaluation Report).

---

## 📁 Cấu Trúc Thư Mục Dự Án (`src/`)

```
src/
├── app/
│   └── api/                        # Next.js App Router REST API Endpoints
│       ├── health/route.ts         # GET /api/health (Ping MySQL & DynamoDB)
│       ├── auth/
│       │   ├── register/route.ts   # POST /api/auth/register (Đăng ký tài khoản)
│       │   ├── login/route.ts      # POST /api/auth/login (Đăng nhập nhận JWT)
│       │   └── me/route.ts         # GET /api/auth/me (Lấy thông tin người dùng hiện tại)
│       ├── problems/
│       │   ├── route.ts            # GET /api/problems (Danh sách & Lọc bài tập)
│       │   └── [id]/route.ts       # GET /api/problems/:id (Chi tiết bài tập)
│       ├── submissions/
│       │   └── route.ts            # POST: nộp bài giải, GET: xem lịch sử nộp
│       └── interviews/
│           ├── route.ts            # POST: bắt đầu phỏng vấn, GET: lịch sử phỏng vấn
│           └── [id]/
│               ├── route.ts        # GET /api/interviews/:id (Chi tiết toàn bộ phiên)
│               ├── chat/route.ts   # POST: gửi câu trả lời & nhận phản hồi từ AI
│               ├── code/route.ts   # POST: lưu snapshot mã nguồn & kết quả test
│               └── evaluate/route.ts # POST: kết thúc & tạo báo cáo chấm điểm AI
│
├── config/
│   └── env.ts                      # Validate cấu hình môi trường bằng Zod
│
├── entities/                       # Định nghĩa Domain Entities, Enums, DTOs & Key Helpers
│   ├── user.entity.ts              # Thực thể User (MySQL)
│   ├── problem.entity.ts           # Thực thể Problem (DynamoDB Table Problems)
│   ├── submission.entity.ts        # Thực thể Submission (DynamoDB Table Problems)
│   ├── interview.entity.ts         # Thực thể Interview Session (DynamoDB Table Interviews)
│   ├── chat-message.entity.ts      # Thực thể Chat Message (DynamoDB Table Interviews)
│   ├── code-snapshot.entity.ts     # Thực thể Code Snapshot (DynamoDB Table Interviews)
│   ├── ai-evaluation.entity.ts     # Thực thể AI Evaluation (DynamoDB Table Interviews)
│   ├── dynamodb.types.ts           # Type Union và hằng số Tables & GSI
│   └── index.ts                    # Barrel export tập trung (import via `@/entities`)
│
├── lib/
│   ├── db/
│   │   ├── mysql.ts                # Connection pool singleton (mysql2/promise)
│   │   └── dynamodb.ts             # DynamoDBDocumentClient singleton (@aws-sdk)
│   ├── api-response.ts             # Chuẩn hóa format response JSON (apiSuccess, apiError)
│   └── jwt.ts                      # Tiện ích tạo, xác thực và trích xuất Bearer Token
│
├── repositories/                   # Data Access Layer (Giao tiếp trực tiếp với DB)
│   ├── user.repository.ts          # Thao tác SQL với bảng `users`
│   ├── problem.repository.ts       # Thao tác DynamoDB trên bảng `Problems`
│   └── interview.repository.ts     # Thao tác DynamoDB trên bảng `Interviews`
│
└── services/                       # Business Logic Layer (Điều phối nghiệp vụ)
    ├── auth.service.ts             # Xác thực, mã hóa bcrypt, cấp phát JWT
    ├── problem.service.ts          # Xử lý bài tập, bảo mật test cases ẩn
    └── interview.service.ts        # Quản lý luồng phỏng vấn AI, chấm điểm và cập nhật profile
```

---

## 🚀 Hướng Dẫn Khởi Động Backend

### Bước 0: Yêu Cầu Cài Đặt Sẵn (Prerequisites)
* **Node.js** v18+ & **npm** v9+
* **MySQL** v8.0+ đang chạy ở port `3306`
* **Docker** (khuyến nghị) hoặc Java JRE 11+ để chạy DynamoDB Local
* **AWS CLI** v2 (để chạy script khởi tạo bảng NoSQL)

---

### Bước 1: Cấu Hình Biến Môi Trường (`.env`)

Tạo file `.env` tại thư mục gốc của project (`Testing Feature/testing-feature/.env`):

```env
# Database - MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=online_judge_db

# AWS DynamoDB (Kết nối DynamoDB Local)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=localKey
AWS_SECRET_ACCESS_KEY=secrectKey
DYNAMODB_ENDPOINT_URL=http://localhost:8000
DYNAMODB_PROBLEMS_TABLE=Problems
DYNAMODB_INTERVIEWS_TABLE=Interviews

# AI Service
OPENAI_API_KEY=sk-your-api-key

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=7d
NEXTAUTH_URL=http://localhost:3000
```

---

### Bước 2: Khởi Tạo Cơ Sở Dữ Liệu MySQL

Mở terminal và thực thi file `schema.sql`:

```bash
# Windows PowerShell / CMD hoặc Linux Bash:
mysql -u root -p < database/schema.sql
```
*Script sẽ tự động tạo database `online_judge_db`, bảng `users` và chèn 2 tài khoản mẫu (1 Admin, 1 Candidate).*

---

### Bước 3: Khởi Động AWS DynamoDB Local

Khởi động container DynamoDB Local qua Docker:

```bash
docker run -d -p 8000:8000 --name dynamodb-local amazon/dynamodb-local:latest
```

Kiểm tra DynamoDB Local đang hoạt động:
```bash
curl http://localhost:8000
# Kết quả phản hồi 400 Bad Request kèm header DynamoDB là bình thường và đã sẵn sàng.
```

---

### Bước 4: Tạo Bảng DynamoDB và Nạp Dữ Liệu Mẫu

Chạy script Bash đi kèm để tự động tạo 2 bảng `Problems`, `Interviews` và các Global Secondary Indexes (GSI):

```bash
# Trên Git Bash hoặc Linux terminal:
cd database
chmod +x setup-dynamodb.sh
./setup-dynamodb.sh
```

*(Script sẽ tự động tạo bảng `Problems` với GSI `user-submissions-index`, `category-difficulty-index`; tạo bảng `Interviews` với GSI `user-interviews-index`, `problem-interviews-index` và seed dữ liệu mẫu).*

---

### Bước 5: Cài Đặt Dependencies và Khởi Chạy Server

Quay lại thư mục gốc của backend và chạy:

```bash
# Cài đặt thư viện
npm install

# Khởi động server chế độ Development
npm run dev
```

Server sẽ khởi chạy tại: **`http://localhost:3000`**

---

## 🩺 Kiểm Tra Trạng Thái Hệ Thống (Health Check)

Truy cập endpoint: **`GET http://localhost:3000/api/health`**

Response mẫu khi hệ thống kết nối thành công cả 2 database:
```json
{
  "success": true,
  "data": {
    "uptime": 12.5,
    "timestamp": "2026-09-14T06:00:00.000Z",
    "databases": {
      "mysql": {
        "status": "CONNECTED",
        "message": ""
      },
      "dynamodb": {
        "status": "CONNECTED",
        "message": "Tables: Interviews, Problems"
      }
    }
  }
}
```

---

## 📡 Danh Sách API Endpoints Chính

| Module | Method | Endpoint | Mô tả |
|:---|:---|:---|:---|
| **System** | `GET` | `/api/health` | Kiểm tra kết nối MySQL & DynamoDB Local |
| **Auth** | `POST` | `/api/auth/register` | Đăng ký tài khoản ứng viên |
| **Auth** | `POST` | `/api/auth/login` | Đăng nhập nhận JWT Token |
| **Auth** | `GET` | `/api/auth/me` | Lấy profile (kèm `Authorization: Bearer <token>`) |
| **Problems** | `GET` | `/api/problems` | Lấy danh sách đề bài (hỗ trợ query `category`, `difficulty`) |
| **Problems** | `GET` | `/api/problems/:id` | Xem chi tiết bài toán và sample test cases |
| **Problems** | `POST` | `/api/problems` | Thêm bài toán mới (Admin) |
| **Submissions** | `POST` | `/api/submissions` | Nộp code giải bài |
| **Submissions** | `GET` | `/api/submissions?problem_id=...` | Xem lịch sử nộp bài theo problem hoặc user |
| **Interviews** | `POST` | `/api/interviews` | Khởi tạo phiên phỏng vấn mới & nhận lời chào từ AI |
| **Interviews** | `GET` | `/api/interviews?user_id=...` | Danh sách các phiên phỏng vấn của ứng viên |
| **Interviews** | `GET` | `/api/interviews/:id` | Lấy toàn bộ ngữ cảnh phiên (metadata, chat, code, report) |
| **Interviews** | `POST` | `/api/interviews/:id/chat` | Gửi tin nhắn và nhận phản hồi tương tác từ AI |
| **Interviews** | `POST` | `/api/interviews/:id/code` | Lưu snapshot code và kết quả chạy test case |
| **Interviews** | `POST` | `/api/interviews/:id/evaluate` | Hoàn tất phỏng vấn, tạo báo cáo chấm điểm AI và cập nhật vào MySQL |

---

## 🧪 Kiểm Tra Tính Toàn Vẹn Mã Nguồn (Type-Check)

Dự án sử dụng TypeScript nghiêm ngặt. Để kiểm tra toàn bộ code trước khi commit/deploy:

```bash
npx tsc --noEmit
```
