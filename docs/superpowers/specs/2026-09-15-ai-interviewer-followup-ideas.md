# Ghi chú việc tiếp theo cho module AI Interviewer

> **Trạng thái: chưa phải spec chính thức** — đây là ghi chú yêu cầu ban đầu, thu thập được trong lúc user thử trang `/interview-test` sau khi 20 task nền tảng (nhánh `ai_interviewer`) hoàn tất. Brainstorming cho 2 việc dưới đây đã bắt đầu nhưng bị tạm dừng (máy dev hết dung lượng ổ đĩa để tiếp tục làm việc thoải mái). Ghi lại ở đây để tiếp tục sau, có thể trên máy khác có nhiều tài nguyên hơn.

## Bối cảnh

20 task nền tảng (xem `docs/superpowers/plans/2026-09-14-ai-interviewer-core-module.md`) đã xây xong một module AI Interviewer chạy đầy đủ 6 chặng qua WebSocket + REST, dùng **AI giả lập hoàn toàn** (`FakeLlmAgent`, `FakeSttAgent`, `FakeTtsAgent`) đứng sau interface cố định (`src/interview/agents/types.ts`). Mục đích ban đầu: test đường đi dữ liệu (data path) — không phải test chất lượng AI.

Sau khi thử trang test thủ công (`/interview-test`), user chỉ ra 2 khoảng cách thật giữa cái đã build và cái mong muốn:

## 1. Model AI thật (thay vì `FakeLlmAgent`)

**Yêu cầu của user:** tải 1 model có sẵn trên HuggingFace về chạy local, **chưa cần fine-tuning** — chỉ để test xem AI phỏng vấn có "thông minh" hơn bản giả lập (hiện tại luôn trả lời y hệt "OK, mình hiểu rồi." bất kể ngữ cảnh) hay không.

**Ghi chú kiến trúc:** interface `LlmAgent` (`chat(messages: ChatMessage[], opts): Promise<string>`) đã được thiết kế sẵn để cắm model thật vào mà không cần đụng tới phần còn lại của hệ thống (EventRouter, TurnRunner, WsGateway...). Việc cần làm là viết 1 class mới implement interface này, gọi model HuggingFace chạy local — chưa quyết định:
- Chạy qua công cụ nào (Ollama? text-generation-inference? transformers trực tiếp qua Python subprocess/HTTP server riêng? llama.cpp?)
- Model cụ thể nào (cần cân nhắc kích thước phù hợp với tài nguyên máy dev — máy hiện tại đã rất hạn chế về ổ đĩa/RAM cho Docker, cần tính toán trước khi chọn model)
- Máy dev hiện tại có đủ tài nguyên (RAM/VRAM/đĩa) để chạy 1 model LLM local không — **cần xác minh trước khi chọn hướng, có thể đây là việc phù hợp làm trên máy khác**

**Câu hỏi chưa được hỏi (brainstorming bị gián đoạn ở đây):**
- Model AI thật này thay thế `FakeLlmAgent` mặc định trong `runtime.ts`, hay chỉ dùng khi bật 1 cờ môi trường riêng (giữ fake làm mặc định cho CI/test nhanh)?
- Có cần GPU không, hay chấp nhận chạy CPU-only (chậm hơn nhưng không cần phần cứng đặc biệt)?
- Ưu tiên model tiếng Việt (interview toàn bộ bằng tiếng Việt) hay model đa ngôn ngữ chung cũng được cho bản test này?

## 2. Whiteboard canvas thật (thay vì ô nhập JSON tay)

**Yêu cầu của user:** ô nhập JSON hiện tại (`{"nodes":[...],"edges":[...]}`) không mô phỏng được trải nghiệm thật — cần 1 canvas vẽ thật giống drawio/Excalidraw/tldraw, để ứng viên vẽ bằng chuột như phỏng vấn thật.

**Ghi chú kiến trúc:** giao thức WS đã có sẵn `whiteboard.update`/`whiteboard.done` nhận `WhiteboardState { nodes: WhiteboardNode[], edges: WhiteboardEdge[] }` — chỉ cần thay phần UI (`src/app/interview-test/page.tsx`) để sinh ra đúng cấu trúc dữ liệu này từ thao tác vẽ, không cần đổi giao thức backend.

**Câu hỏi chưa được hỏi:**
- Dùng thư viện có sẵn (Excalidraw, tldraw) hay tự vẽ canvas tối giản bằng SVG/Canvas API?
- Nếu dùng thư viện ngoài — cần cân nhắc license, kích thước bundle, và việc chuyển đổi giữa định dạng nội bộ của thư viện đó và `WhiteboardState` của hệ thống.

## Việc cần làm tiếp

1. Chốt lại 2 việc này làm song song hay tuần tự (model AI trước hay whiteboard trước) — user đang được hỏi thì bị gián đoạn.
2. Nếu tiếp tục trên máy khác: máy dev hiện tại (`/home/bias29/Demo-SimuTech-Backend`) có 1 project Docker khác không liên quan (Dify) chiếm phần lớn dung lượng ổ đĩa (~10GB), cộng với các image DynamoDB Local/Judge0 của chính module này — cần dọn hoặc chuyển máy trước khi làm việc nặng (tải model AI, thử nghiệm nhiều).
3. Sau khi chốt câu trả lời, quay lại quy trình `superpowers:brainstorming` (architectural path) cho từng việc — đề xuất phương án, viết spec, rồi `superpowers:writing-plans`.
