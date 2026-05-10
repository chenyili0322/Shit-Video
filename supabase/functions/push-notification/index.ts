import { createClient } from "supabase";
import WebPush from "web-push";

Deno.serve(async (req) => {
  try {
    // 接收來自 Webhook 的資料
    const { record } = await req.json();

    // 1. 設定 VAPID (用你之前在網頁後台設定的 Secret)
    const publicVapidKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const privateVapidKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("VAPID_SUBJECT")!;

    WebPush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);

    // 2. 初始化 Supabase Admin 客戶端
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // 這裡要用 Service Role 才能繞過 RLS 查資料
    );

    // 3. 找出群組內「除了發布者」以外的所有成員 ID
    const { data: members } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", record.group_id)
      .neq("user_id", record.created_by);

    const userIds = members?.map((m) => m.user_id) || [];
    if (userIds.length === 0)
      return new Response(JSON.stringify({ message: "No one to notify" }));

    // 4. 找出這些人的推送地址 (Subscription)
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("subscription_data")
      .in("user_id", userIds);

    // 5. 執行推送
    const pushPromises = subscriptions?.map((sub) => {
      return WebPush.sendNotification(
        sub.subscription_data,
        JSON.stringify({
          title: "SHIT-VIDEO 有新大便！",
          body: `有人分享了新影片：${record.title || "快來看！"} 💩`,
          url: "/",
        }),
      ).catch((err) => console.error("單一推播發送失敗:", err));
    });

    if (pushPromises) await Promise.all(pushPromises);

    return new Response(JSON.stringify({ message: "Success" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
});
