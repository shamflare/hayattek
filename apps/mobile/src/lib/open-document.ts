/**
 * Open a clinical document. The download endpoint requires the auth header, so we
 * cannot hand the URL to a browser. Native: download into the app cache with the
 * header, then hand the file to the OS viewer via the share sheet. Web: fetch as a
 * blob and open an object URL. Nothing is stored beyond the OS cache file.
 */
import { Platform } from "react-native";

import { API_URL, getAuthHeaders } from "./api";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "application/dicom": "dcm",
};

export async function openDocument(id: string, mimeType: string): Promise<void> {
  const url = `${API_URL}/api/v1/documents/${id}/download`;
  const headers = getAuthHeaders();

  if (Platform.OS === "web") {
    const res = await fetch(url, { headers });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  const { Directory, File, Paths } = await import("expo-file-system");
  const Sharing = await import("expo-sharing");
  const dir = new Directory(Paths.cache, "hayat-docs");
  if (!dir.exists) dir.create();
  const target = new File(dir, `${id}.${EXT[mimeType] ?? "bin"}`);
  if (target.exists) target.delete();
  const task = File.createDownloadTask(url, target, { headers });
  const file = await task.downloadAsync();
  if (!file) throw new Error("download interrupted");
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: "حياة" });
  }
}
