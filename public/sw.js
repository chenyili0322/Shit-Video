// public/sw.js
self.addEventListener("push", (event) => {
  const data = event.data
    ? event.data.json()
    : { title: "SHIT-VIDEO", body: "有人丟了大便！💩" };

  const options = {
    body: data.body,
    icon: "/vercel.svg", // 你的 App 圖示
    badge: "/vercel.svg", // Android 狀態列小圖示
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
