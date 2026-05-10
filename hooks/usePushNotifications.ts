// hooks/usePushNotifications.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * 工具函式：將 Base64 URL 安全字串轉換為 Uint8Array
 */
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const usePushNotifications = (user: any) => {
  const subscribe = async () => {
    // 1. 基本檢查
    if (!user?.id || typeof window === "undefined") return;

    try {
      // 2. 環境支援檢查
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        console.warn("💩 此裝置不支援推送通知");
        return;
      }

      // 3. 註冊 Service Worker (public/sw.js)
      const registration = await navigator.serviceWorker.register("/sw.js");

      // 4. 【關鍵修復】等待 Service Worker 真正激活 (Active)
      // 避免噴出 "Subscription failed - no active Service Worker"
      if (!registration.active) {
        console.log("💩 等待 Service Worker 激活中...");
        await new Promise<void>((resolve) => {
          const sw = registration.installing || registration.waiting;
          if (sw) {
            sw.addEventListener("statechange", (e: any) => {
              if (e.target.state === "activated") {
                console.log("💩 Service Worker 已激活");
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
      }

      // 確保 SW 真的準備好了
      await navigator.serviceWorker.ready;

      // 5. 請求權限
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("💩 使用者拒絕了通知權限");
        return;
      }

      // 6. 取得 VAPID 公鑰
      const publicKey = process.env.NEXT_PUBLIC_NOTIFICATION_KEY;
      if (!publicKey) {
        console.error("💩 找不到環境變數 NEXT_PUBLIC_NOTIFICATION_KEY");
        return;
      }

      // 7. 執行訂閱
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 8. 存入 Supabase
      // 使用 JSON.stringify 再 parse 是為了將 PushSubscription 物件轉為純 JSON，確保 keys 欄位不會遺失
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          subscription_data: JSON.parse(JSON.stringify(subscription)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id, subscription_data" },
      );

      if (error) throw error;

      console.log("💩 推送連線成功，現在就算網頁關掉也能收到通知了！");
    } catch (error: any) {
      console.error("💩 訂閱推送時發生錯誤:", error.message);
    }
  };

  return { subscribe };
};
