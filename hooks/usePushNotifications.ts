// hooks/usePushNotifications.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * 工具函式：將 Base64 URL 安全字串轉換為 Uint8Array
 * 這是 Push API 規範要求的格式，直接傳字串在很多手機上會噴錯
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const usePushNotifications = (user: any) => {
  const subscribe = async () => {
    // 伺服器端渲染 (SSR) 檢查與使用者登入檢查
    if (!user?.id || typeof window === "undefined") return;

    try {
      // 1. 核心環境檢查
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        console.warn("💩 這台裝置或瀏覽器不支援推送通知");
        return;
      }

      // 2. 註冊 Service Worker 
      // 檔案必須位於 public/sw.js
      const registration = await navigator.serviceWorker.register("/sw.js");

      // 3. 請求使用者授權
      // 如果已經授權過，瀏覽器會自動回傳 'granted'
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("💩 使用者拒絕了通知權限");
        return;
      }

      // 4. 取得 VAPID 公鑰並執行訂閱
      const publicKey = process.env.NEXT_PUBLIC_NOTIFICATION_KEY;
      if (!publicKey) {
        console.error("💩 找不到環境變數 NEXT_PUBLIC_NOTIFICATION_KEY");
        return;
      }

      // 執行訂閱動作
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 5. 將訂閱憑證存入 Supabase
      // 使用 upsert 確保同一位使用者更換金鑰時能自動更新
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          subscription_data: JSON.parse(JSON.stringify(subscription)), // 確保轉為純 JSON
        },
        { onConflict: "user_id, subscription_data" }
      );

      if (error) throw error;

      console.log("💩 推送連線成功，現在就算網頁關掉也能收到通知了！");
    } catch (error: any) {
      // 如果出現 'Subscription failed - no active Service Worker'
      // 通常是 sw.js 還在啟動中，請重新整理網頁即可
      console.error("💩 訂閱推送時發生錯誤:", error.message);
    }
  };

  return { subscribe };
};