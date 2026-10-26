export const CAPTURE_CHANNEL = "capture";

export interface CaptureAttachment {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  hostId: string | null;
}

export interface CaptureSignal {
  id: string;
  label: string;
  image: CaptureAttachment;
  tree: CaptureAttachment | null;
}

function parseAttachment(value: unknown): CaptureAttachment | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("path" in value) ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("mimeType" in value) ||
    typeof value.mimeType !== "string" ||
    !("sizeBytes" in value) ||
    typeof value.sizeBytes !== "number" ||
    !Number.isInteger(value.sizeBytes) ||
    value.sizeBytes < 0 ||
    !("hostId" in value) ||
    (value.hostId !== null && typeof value.hostId !== "string")
  ) {
    return null;
  }
  return {
    path: value.path,
    name: value.name,
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    hostId: value.hostId,
  };
}

export function parseCaptureSignal(value: unknown): CaptureSignal | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("id" in value) ||
    typeof value.id !== "string" ||
    value.id === "" ||
    !("label" in value) ||
    typeof value.label !== "string" ||
    !("image" in value) ||
    !("tree" in value)
  ) {
    return null;
  }
  const image = parseAttachment(value.image);
  if (image === null) return null;
  const tree = value.tree === null ? null : parseAttachment(value.tree);
  if (value.tree !== null && tree === null) return null;
  return { id: value.id, label: value.label, image, tree };
}
