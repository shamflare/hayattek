/**
 * Authenticated multipart upload with progress (XMLHttpRequest works the same on
 * Android, iOS and web; fetch has no upload progress). The body is built in memory
 * (`buildMultipartBody`), so the recording never touches the device's storage.
 */
import { API_URL, getAuthHeaders } from "./api";
import { buildMultipartBody } from "./wav";

export interface UploadError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;
}

function boundary(): string {
  let s = "----hayat";
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}

export function uploadFile<T>(
  path: string,
  file: { field: string; name: string; type: string; data: Uint8Array },
  onProgress?: (fraction: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    const b = boundary();
    const body = buildMultipartBody(b, file.field, file.name, file.type, file.data);
    xhr.open("POST", `${API_URL}${path}`);
    for (const [k, v] of Object.entries(getAuthHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("Content-Type", `multipart/form-data; boundary=${b}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(json as T);
        return;
      }
      reject(Object.assign(new Error((json.message as string) || `HTTP ${xhr.status}`), {
        status: xhr.status, code: (json.code as string) ?? "error", body: json,
      }));
    };
    // The request never reached the server: same shape as fetch's network failure so
    // `errorMessage()` shows the "check your connection" text and a retry is offered.
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request timed out"));
    xhr.onabort = () => reject(Object.assign(new Error("aborted"), { code: "aborted" }));
    xhr.timeout = 10 * 60_000;
    xhr.send(body);
  });
  return { promise, abort: () => xhr.abort() };
}
