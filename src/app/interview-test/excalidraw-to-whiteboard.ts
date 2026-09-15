import type { WhiteboardEdge, WhiteboardNode, WhiteboardState } from "../../interview/domain/types";

// Kiểu tối thiểu cần dùng từ ExcalidrawElement — không import type thật từ @excalidraw/excalidraw
// để khỏi kéo theo toàn bộ dependency vào 1 file build được cả ở server (an toàn hơn khi refactor).
interface MinimalExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  containerId?: string | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  isDeleted?: boolean;
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const EDGE_TYPES = new Set(["arrow", "line"]);

/**
 * Excalidraw không có khái niệm "node/edge" — chỉ có các element hình học rời rạc. Ta suy ra đồ thị:
 * hình khối (rectangle/ellipse/diamond) hoặc text đứng riêng -> node (label = text bị "bind" vào nó,
 * nếu có); arrow/line có 2 đầu bind vào 2 element khác -> edge. Arrow không bind đủ 2 đầu bị bỏ qua
 * (không suy ra được from/to). Đây là ánh xạ tốt-nhất-có-thể, không cần khớp 100% ý người vẽ.
 */
export function excalidrawToWhiteboardState(elements: readonly MinimalExcalidrawElement[]): WhiteboardState {
  const live = elements.filter((el) => !el.isDeleted);
  const textByContainerId = new Map<string, string>();
  for (const el of live) {
    if (el.type === "text" && el.containerId) textByContainerId.set(el.containerId, el.text ?? "");
  }

  const nodes: WhiteboardNode[] = [];
  const edges: WhiteboardEdge[] = [];
  for (const el of live) {
    if (SHAPE_TYPES.has(el.type)) {
      nodes.push({ id: el.id, label: textByContainerId.get(el.id) ?? "", x: Math.round(el.x), y: Math.round(el.y) });
    } else if (el.type === "text" && !el.containerId) {
      nodes.push({ id: el.id, label: el.text ?? "", x: Math.round(el.x), y: Math.round(el.y) });
    } else if (EDGE_TYPES.has(el.type)) {
      const from = el.startBinding?.elementId;
      const to = el.endBinding?.elementId;
      if (!from || !to) continue;
      const label = textByContainerId.get(el.id);
      edges.push(label ? { from, to, label } : { from, to });
    }
  }
  return { nodes, edges };
}
