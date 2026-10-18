/**
 * Device token storage (ADR-003). On Android/iOS the raw token lives ONLY in
 * expo-secure-store (Keychain / Keystore). Nothing else is persisted on the device:
 * medical data stays in memory and disappears when the app is closed.
 *
 * Expo web (used for development previews) has no secure storage, so the token is kept
 * in memory only — never in localStorage. Reloading the page logs the user out.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "hayat.device_token";
let memoryToken: string | null = null;

const native = Platform.OS === "ios" || Platform.OS === "android";

export async function readToken(): Promise<string | null> {
  if (!native) return memoryToken;
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function writeToken(token: string): Promise<void> {
  if (!native) {
    memoryToken = token;
    return;
  }
  await SecureStore.setItemAsync(KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteToken(): Promise<void> {
  memoryToken = null;
  if (!native) return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Already gone.
  }
}

export const tokenIsPersistent = native;
