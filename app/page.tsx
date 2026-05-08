"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import YouTube from "react-youtube";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [tempName, setTempName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [currentGroup, setCurrentGroup] = useState<any>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [tags, setTags] = useState("");
  const [videoList, setVideoList] = useState<any[]>([]);
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  // 1. 宣告 avatarBg 狀態，預設為白色
  const [avatarBg, setAvatarBg] = useState("#ffffff");
  const [currentMembers, setCurrentMembers] = useState<any[]>([]);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [activeDanmakuId, setActiveDanmakuId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("global-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos" },
        (payload) => {
          console.log("收到變動:", payload.eventType, payload);

          if (payload.eventType === "INSERT") {
            const newVideo = payload.new;
            // 這裡用 prev 確保拿到最新狀態
            setUnseenCounts((prev) => {
              // 只有不在當前群組時才加 💩
              if (newVideo.group_id !== currentGroup?.id) {
                return {
                  ...prev,
                  [newVideo.group_id]: (prev[newVideo.group_id] || 0) + 1,
                };
              }
              return prev;
            });
            if (newVideo.group_id === currentGroup?.id)
              fetchVideos(currentGroup.id);
          }

          if (payload.eventType === "DELETE") {
            const oldVideo = payload.old;
            // 檢查 payload.old 是否真的拿到了 group_id
            if (oldVideo && oldVideo.group_id) {
              setUnseenCounts((prev) => ({
                ...prev,
                [oldVideo.group_id]: Math.max(
                  0,
                  (prev[oldVideo.group_id] || 0) - 1,
                ),
              }));

              if (oldVideo.group_id === currentGroup?.id) {
                fetchVideos(currentGroup.id);
              }
            } else {
              // 如果執行了 FULL 但還是拿不到，就嘗試直接刷新當前畫面
              console.warn("Delete payload 缺漏 group_id，執行強制刷新");
              if (currentGroup) fetchVideos(currentGroup.id);
            }
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ratings" },
        () => {
          console.log("偵測到新評分，同步更新...");
          if (currentGroup?.id) {
            fetchVideos(currentGroup.id); // 只要有人評分，就重新抓取目前群組的影片資料
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments" },
        () => {
          if (currentGroup?.id) fetchVideos(currentGroup.id); // 留言進來就刷資料
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, currentGroup?.id]); // 確保 currentGroup.id 變動時會重啟監聽

  // 當切換群組時，把該群組的未讀數歸零
  // 找到你原本處理「切換群組時，未讀數歸零」的那個 useEffect
  useEffect(() => {
    if (currentGroup) {
      setUnseenCounts((prev) => ({ ...prev, [currentGroup.id]: 0 }));

      // 補上這行：只要 currentGroup.id 變了，就去抓新成員
      fetchGroupMembers(currentGroup.id);
    }
  }, [currentGroup?.id]);
  // 登入
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        fetchMyGroups(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
        fetchMyGroups(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. 確保 fetchProfile 時也會把顏色抓回來
  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      setProfile(data);
      setTempName(data.display_name || "");
      setAvatarUrl(data.avatar_url || "");
      setAvatarBg(data.avatar_bg || "#ffffff"); // 補上這行，把資料庫的顏色讀出來
    }
  };

  const uploadAvatar = async (event: any) => {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) return;
      const file = event.target.files[0];
      const filePath = `${user.id}/${Math.random()}.${file.name.split(".").pop()}`;
      const { error } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);
      setAvatarUrl(publicUrl);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: tempName,
      avatar_url: avatarUrl,
      avatar_bg: avatarBg, // 存入顏色
      updated_at: new Date(),
    });

    if (!error) {
      await fetchProfile(user.id);
      setIsEditingProfile(false);
    } else {
      alert("儲存失敗: " + error.message);
    }
  };

  const fetchMyGroups = async (userId: string) => {
    const { data, error } = await supabase
      .from("group_members")
      .select("groups (*)")
      .eq("user_id", userId);

    if (error) {
      console.error(error);
      return;
    }

    // 確保只取出 groups 的部分，並過濾掉可能的空值
    const groups = data?.map((item: any) => item.groups).filter(Boolean) || [];
    setMyGroups(groups);
  };

  const handleJoinGroup = async () => {
    // 1. 使用 .maybeSingle() 取代 .single()
    // .maybeSingle() 在找不到東西時會回傳 { data: null, error: null }，不會報錯 406
    const { data: group, error } = await supabase
      .from("groups")
      .select("*")
      .eq("access_key", inputKey)
      .maybeSingle();

    if (error) {
      console.error("Join error:", error);
      alert("查詢時發生錯誤，請稍後再試");
      return;
    }

    if (group) {
      // 2. 加入成員紀錄
      const { error: joinError } = await supabase
        .from("group_members")
        .upsert([{ user_id: user.id, group_id: group.id }], {
          onConflict: "user_id, group_id", // 確保重複加入時不會出錯
        });

      if (joinError) {
        alert("加入失敗：" + joinError.message);
        return;
      }

      // 3. 成功後的操作
      setCurrentGroup(group);
      fetchMyGroups(user.id);
      fetchVideos(group.id);
      setInputKey(""); // 清空輸入框
    } else {
      // 這裡現在能正確執行了，因為 maybeSingle 沒找到會回傳 null
      alert("金鑰無效，找不到該頻道！");
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("請輸入群組名稱");
    const secretKey = crypto.randomUUID();

    // 1. 建立群組
    const { data: group, error } = await supabase
      .from("groups")
      .insert([
        {
          group_name: newGroupName,
          access_key: secretKey,
          created_by: user.id,
        },
      ])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        alert("這個群組名稱已經有人用過了，換一個吧！");
      } else {
        alert("建立失敗：" + error.message);
      }
      return;
    }

    // 2. 【關鍵修正】將創建者本人加入成員表
    const { error: memberError } = await supabase.from("group_members").insert([
      {
        user_id: user.id,
        group_id: group.id,
      },
    ]);

    if (memberError) {
      console.error("無法將創建者加入成員表:", memberError);
    }

    // 3. 更新 UI
    setGeneratedKey(secretKey);
    fetchMyGroups(user.id); // 重新抓取後，側邊欄就會出現新群組了
  };

  const fetchVideos = async (groupId: string) => {
    const { data } = await supabase
      .from("videos")
      .select(
        `
      *,
      author:created_by (display_name, avatar_url, avatar_bg),
      ratings (
        score, 
        user_id, 
        profiles:user_id (display_name, avatar_url, avatar_bg)
      ),
        comments (id, content, created_at)
    `,
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (data) setVideoList(data);
  };

  const handleSubmitVideo = async () => {
    const videoId = videoUrl.includes("/shorts/")
      ? videoUrl.split("/shorts/")[1]?.split(/[?&]/)[0]
      : videoUrl.match(
          /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,
        )?.[2];
    const embedUrl = videoId
      ? `https://www.youtube.com/embed/${videoId}${videoUrl.includes("/shorts/") ? "#shorts" : ""}`
      : null;
    if (!embedUrl) return alert("網址錯誤");
    if (videoList.some((v) => v.url === embedUrl))
      return alert("不是啊，你分享過了餒？");
    await supabase.from("videos").insert([
      {
        url: embedUrl,
        group_id: currentGroup.id,
        created_by: user.id,
        title: tags,
      },
    ]);
    setVideoUrl("");
    setTags("");
    fetchVideos(currentGroup.id);
  };
  const handleSendDanmaku = async (videoId: string) => {
    const inputEl = document.getElementById(
      `danmaku-input-${videoId}`,
    ) as HTMLInputElement;
    const content = inputEl?.value.trim();

    if (!content) return;

    const { error } = await supabase.from("comments").insert([
      {
        video_id: videoId,
        user_id: user.id,
        content: content,
      },
    ]);

    if (!error) {
      inputEl.value = ""; // 清空輸入框
      inputEl.blur(); // <-- 加上這一行，會強制讓輸入框失去焦點，手機鍵盤就會自動收起來
    } else {
      alert("彈幕發射失敗：" + error.message);
    }
  };
  const handleRate = async (
    videoId: string,
    score: number,
    creatorId: string,
  ) => {
    if (user.id === creatorId) return alert("不能投自己");
    await supabase
      .from("ratings")
      .upsert(
        { video_id: videoId, user_id: user.id, score },
        { onConflict: "video_id, user_id" },
      );
    fetchVideos(currentGroup.id);
  };

  const getAvg = (ratings: any[]) => {
    if (!ratings || ratings.length === 0) return "未評";
    const avg = ratings.reduce((a, b) => a + b.score, 0) / ratings.length;
    return avg >= 3.5 ? "ㄅ" : avg >= 2.5 ? "ㄆ" : avg >= 1.5 ? "ㄇ" : "ㄈ";
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    // 雙重確認，避免手滑
    const confirmName = prompt(
      `確定要刪除「${groupName}」嗎？此動作無法復原。\n請輸入群組名稱以確認刪除：`,
    );

    if (confirmName !== groupName) {
      if (confirmName !== null) alert("名稱輸入錯誤，取消刪除。");
      return;
    }

    // 執行刪除 (由於之前 SQL 設有 ON DELETE CASCADE，相關影片與成員紀錄會自動刪除)
    const { error } = await supabase.from("groups").delete().eq("id", groupId);

    if (error) {
      alert("刪除失敗：" + error.message);
    } else {
      alert("群組已永久刪除");
      setCurrentGroup(null); // 回到大廳
      fetchMyGroups(user.id); // 重新整理側邊欄
    }
  };
  const fetchGroupMembers = async (groupId: string) => {
    const { data, error } = await supabase
      .from("group_members")
      .select(
        `
      profiles (
        display_name, 
        avatar_url, 
        avatar_bg
      )
    `,
      )
      .eq("group_id", groupId);

    if (error) {
      console.error("抓取成員失敗:", error.message);
      return;
    }

    if (data) {
      // 攤平資料：取出關聯的 profiles 內容
      const members = data.map((m: any) => m.profiles).filter(Boolean);
      setCurrentMembers(members);
    }
  };
  const handleLogout = async () => {
    // 第一層防呆：彈出對話框
    const singleCheck = window.confirm("確定要登出嗎？");

    if (!singleCheck) return; // 使用者按取消，直接結束

    // 如果確定要登出
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert("登出失敗：" + error.message);
      return;
    }

    // 清空狀態並刷新
    setUser(null);
    setProfile(null);
    setCurrentGroup(null);
    window.location.reload();
  };
  return (
    <div className="h-full bg-black text-white flex flex-col">
      {/* 1. 手機版 & 電腦版通用頂部導覽列 */}
      {user && profile && (
        <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-800 p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Hamburger Menu & Logo */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden cursor-pointer p-1"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <h1
              onClick={() => setCurrentGroup(null)}
              className="text-xl font-black italic text-yellow-500 tracking-tighter cursor-pointer"
            >
              SHIT-VIDEO
            </h1>
          </div>

          {/* 右側個人資訊與登出按鈕 */}
          <div className="flex items-center gap-4">
            {/* 個人頭像 */}
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => setIsEditingProfile(true)}
            >
              <div className="text-right hidden sm:block">
                <p className="text-xs font-black">{profile.display_name}</p>
                <p className="text-[10px] text-gray-500 uppercase">Edit</p>
              </div>
              <img
                src={
                  profile.avatar_url ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                }
                // 加上這行！
                style={{ backgroundColor: profile.avatar_bg || "#ffffff" }}
                className="w-10 h-10 rounded-full border border-gray-700 object-cover shadow-[0_0_10px_rgba(255,255,255,0.1)]"
              />
            </div>
            {/* 登出圖示按鈕 */}
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-500 transition-colors cursor-pointer"
              title="登出"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </button>
          </div>
        </header>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* 2. 抽屜式側邊欄 (側邊滑入) */}
        <aside
          className={`fixed inset-y-0 left-0 z-[60] w-64 bg-gray-900 border-r border-gray-800 p-6 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex justify-between items-center mb-8 md:hidden">
            <span className="font-black text-yellow-500">頻道列表</span>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="text-gray-500 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <nav className="flex flex-col gap-2">
            <h2 className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-2">
              我的頻道
            </h2>
            {myGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setCurrentGroup(g);
                  fetchVideos(g.id);
                  setIsSidebarOpen(false);
                  // ... 這裡如果有 setGeneratedKey("") 也保留
                }}
                className={`p-3 rounded-2xl text-left text-sm font-bold flex justify-between items-center transition ${
                  currentGroup?.id === g.id
                    ? "bg-yellow-500 text-black shadow-lg"
                    : "hover:bg-gray-800 text-gray-500"
                }`}
              >
                {/* 群組名稱 */}
                <span className="truncate mr-2"># {g.group_name}</span>

                {/* 💩 大便新消息提示 💩 */}
                {unseenCounts[g.id] > 0 && (
                  <div className="relative flex items-center justify-center flex-shrink-0 animate-pulse-slow">
                    {/* 大便 Emoji 本體 - 這裡調大一點 */}
                    <span className="text-xl">💩</span>

                    {/* 咖啡色數字 - 放在大便旁邊 */}
                    <span className="absolute -top-1 -right-1 bg-black/80 text-[#8B4513] text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border border-gray-800 min-w-[18px] text-center shadow-lg">
                      {unseenCounts[g.id]}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* 點擊背景關閉選單 */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-[55] bg-black/60 md:hidden"
          ></div>
        )}

        {/* 3. 主畫面內容 */}
        <main className="flex-1 overflow-y-auto p-4 py-8 scrollbar-stable custom-scrollbar">
          <div className="max-w-xl mx-auto">
            {!user ? (
              <div className="text-center mt-20">
                <button
                  onClick={() =>
                    supabase.auth.signInWithOAuth({ provider: "google" })
                  }
                  className="bg-white text-black px-12 py-4 rounded-full font-black text-lg cursor-pointer shadow-xl"
                >
                  Google Login
                </button>
              </div>
            ) : isEditingProfile || !profile ? (
              <div className="bg-gray-900 p-8 rounded-[3rem] border border-yellow-500 shadow-2xl text-center">
                <h2 className="text-2xl font-black mb-8">設定檔案</h2>

                {/* 頭像預覽區 */}
                <div className="relative w-24 h-24 mx-auto mb-8 group cursor-pointer">
                  <img
                    src={
                      avatarUrl ||
                      `https://api.dicebear.com/7.x/bottts/svg?seed=${user.id}`
                    }
                    // 這裡動態套用選擇的背景顏色
                    style={{ backgroundColor: avatarBg }}
                    className="w-full h-full rounded-full border-2 border-gray-800 object-cover shadow-[0_0_10px_rgba(255,255,255,0.1)] transition-colors"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition">
                    <span className="text-[10px] font-bold">
                      {uploading ? "傳送中" : "更換圖檔"}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={uploadAvatar}
                      disabled={uploading}
                    />
                  </label>
                </div>

                {/* 顏色選擇區 */}
                <div className="mb-6">
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-2">
                    背景顏色
                  </p>
                  <div className="flex items-center gap-3 bg-black p-3 rounded-2xl border border-gray-800">
                    <input
                      type="color"
                      value={avatarBg}
                      onChange={(e) => setAvatarBg(e.target.value)}
                      className="w-10 h-10 bg-transparent border-none cursor-pointer"
                    />
                    <span className="text-xs font-mono text-gray-400 uppercase">
                      {avatarBg}
                    </span>
                  </div>
                </div>

                <input
                  className="w-full bg-black p-5 rounded-2xl text-center border border-gray-800 mb-4 outline-none focus:border-yellow-500"
                  placeholder="你的暱稱"
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                />

                <button
                  onClick={handleSaveProfile}
                  className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl cursor-pointer hover:bg-yellow-400 transition"
                >
                  儲存
                </button>

                {profile && (
                  <button
                    onClick={() => setIsEditingProfile(false)}
                    className="block w-full mt-4 text-gray-500 text-sm"
                  >
                    取消
                  </button>
                )}
              </div>
            ) : !currentGroup ? (
              <div className="space-y-8 mt-10 text-center">
                <div className="bg-gray-900 p-8 rounded-[3rem] border border-gray-800 shadow-xl">
                  <h2 className="font-bold mb-6 italic text-xl">🔑 加入群組</h2>
                  <input
                    className="w-full bg-black p-5 rounded-2xl mb-4 text-center text-sm outline-none focus:ring-1 ring-yellow-500"
                    placeholder="UUID 金鑰"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                  />
                  <button
                    onClick={handleJoinGroup}
                    className="w-full bg-yellow-500 text-black font-black p-5 rounded-2xl cursor-pointer"
                  >
                    進入
                  </button>
                </div>
                <input
                  className="bg-transparent border-b border-gray-800 p-3 text-center w-full mb-2 text-xl outline-none text-yellow-500"
                  placeholder="新頻道名稱"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <button
                  onClick={handleCreateGroup}
                  className="text-sm text-gray-500 underline font-bold cursor-pointer"
                >
                  建立頻道
                </button>
                {/* 建立頻道的按鈕下方 */}
                {generatedKey && (
                  <div className="mt-8 p-6 bg-gray-900 rounded-[2rem] border-2 border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.3)] mx-auto w-full max-w-sm">
                    <p className="text-xs text-gray-400 mb-3 uppercase tracking-widest font-black text-center">
                      🎉 頻道建立成功！
                    </p>

                    {/* 金鑰主體：text-2xl 確保大字，font-mono 確保整齊 */}
                    <div className="bg-black p-4 rounded-xl text-yellow-400 text-2xl font-mono break-all text-center border border-gray-800 mb-4 select-all shadow-inner">
                      {generatedKey}
                    </div>

                    {/* 滿版大按鈕方便大拇指點擊 */}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedKey);
                        alert("金鑰已成功複製到剪貼簿。");
                      }}
                      className="w-full bg-yellow-500 text-black py-4 rounded-xl font-black text-lg hover:bg-yellow-400 active:scale-95 transition-all cursor-pointer shadow-lg"
                    >
                      複製金鑰
                    </button>

                    <p className="text-[10px] text-gray-600 mt-4 text-center leading-relaxed">
                      提示：您可以點擊金鑰直接選取，
                      <br />
                      或使用上方按鈕直接複製。
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
                  {/* 左側標題與頭像區塊 */}
                  <div className="flex flex-col gap-2">
                    {/* 群組標題 */}
                    <h2 className="text-3xl font-black italic tracking-tighter">
                      {currentGroup.group_name}
                    </h2>

                    {/* 成員頭像列表：手機版會在標題下方，電腦版會在標題旁邊（如果需要） */}
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {currentMembers.slice(0, 5).map((member, i) => (
                          <img
                            key={i}
                            src={
                              member.avatar_url ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${i}`
                            }
                            style={{
                              backgroundColor: member.avatar_bg || "#ffffff",
                            }}
                            className="w-7 h-7 rounded-full border-2 border-black object-cover cursor-pointer hover:z-10 transition-transform active:scale-90"
                            title={member.display_name}
                            // 先留著，等一下要在這裡做點擊下拉選單
                            onClick={() =>
                              console.log("點擊了成員:", member.display_name)
                            }
                          />
                        ))}
                        {currentMembers.length > 5 && (
                          <div className="w-7 h-7 rounded-full bg-gray-800 border-2 border-black flex items-center justify-center text-[10px] font-black text-gray-500">
                            +{currentMembers.length - 5}
                          </div>
                        )}
                      </div>

                      {/* 這裡是複製金鑰按鈕，放在頭像旁邊比較好按 */}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(
                            currentGroup.access_key,
                          );
                          alert("金鑰已複製 💩");
                        }}
                        className="p-1.5 bg-gray-900 rounded-lg text-yellow-500/50 hover:text-yellow-500 transition-colors"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* 右側按鈕區塊（離開頻道、刪除等） */}
                  <div className="flex gap-3 items-center self-end md:self-center">
                    {user.id === currentGroup.created_by && (
                      <button
                        onClick={() =>
                          handleDeleteGroup(
                            currentGroup.id,
                            currentGroup.group_name,
                          )
                        }
                        className="text-[10px] text-red-500/50 hover:text-red-500 font-bold border border-red-500/20 px-2 py-1 rounded transition"
                      >
                        刪除群組
                      </button>
                    )}
                    <button
                      onClick={() => setCurrentGroup(null)}
                      className="text-xs text-gray-600 hover:text-white font-bold"
                    >
                      離開頻道
                    </button>
                  </div>
                </div>

                <div className="bg-gray-900 p-6 rounded-[2.5rem] border border-gray-800 shadow-xl">
                  <input
                    className="w-full bg-black p-4 rounded-2xl mb-3 text-sm outline-none"
                    placeholder="YouTube 連結"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                  />
                  <input
                    className="w-full bg-black p-4 rounded-2xl mb-4 text-sm outline-none"
                    placeholder="標籤 (例如: 狠角色)"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                  <button
                    onClick={handleSubmitVideo}
                    className="w-full bg-blue-600 py-4 rounded-2xl font-black shadow-lg shadow-blue-900/40 cursor-pointer"
                  >
                    分享影片
                  </button>
                </div>

                <div className="space-y-16">
                  {videoList.map((vid) => {
                    const isShorts = vid.url.includes("#shorts");
                    const ytId = vid.url
                      .split("/embed/")[1]
                      ?.split("?")[0]
                      ?.split("#")[0];
                    const isPlaying = playingVideoId === vid.id;

                    return (
                      <div
                        key={vid.id}
                        className="bg-gray-900 rounded-[3rem] overflow-hidden border border-gray-800 shadow-2xl"
                      >
                        {/* 影片容器 */}
                        <div
                          className="mx-auto bg-black relative overflow-hidden group cursor-pointer"
                          style={{
                            width: "100%",
                            maxWidth: isShorts ? "360px" : "100%",
                            aspectRatio: isShorts ? "9/16" : "16/9",
                          }}
                          onClick={() => {
                            if (!isPlaying) {
                              setPlayingVideoId(vid.id);
                            }
                          }}
                        >
                          {/* 【第一層：影片或縮圖】 */}
                          {isPlaying ? (
                            <YouTube
                              videoId={ytId} // 只需要傳 ID，例如: dQw4w9WgXcQ
                              opts={{
                                width: "100%",
                                height: "100%",
                                playerVars: {
                                  autoplay: 1, // 自動播放
                                  mute: 0, // 靜音（保證自動播放成功）
                                  rel: 0, // 不顯示相關影片
                                  modestbranding: 1,
                                },
                              }}
                              onReady={(event) => {
                                // 播放器準備好後，強制再下一次播放指令
                                event.target.playVideo();
                              }}
                              className="absolute inset-0 w-full h-full"
                            />
                          ) : (
                            <div className="relative w-full h-full">
                              <img
                                src={`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`}
                                className="w-full h-full object-cover opacity-60"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src =
                                    `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center">
                                  <svg
                                    width="32"
                                    height="32"
                                    viewBox="0 0 24 24"
                                    fill="white"
                                  >
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 【第二層：彈幕層】獨立出來，不被上面的 isPlaying 影響 */}
                          {isPlaying && (
                            <div className="absolute inset-0 z-10 pointer-events-none">
                              {vid.comments?.map((c: any, index: number) => {
                                const track = index % 8;

                                // 這裡計算「總延遲」
                                // 基礎延遲 1s (等影片跑) + 彈幕排序延遲 (index * 0.5s)
                                const totalDelay = 1 + index * 0.5;

                                return (
                                  <span
                                    key={c.id}
                                    className="danmaku-item text-base md:text-lg"
                                    style={{
                                      top: `${track * 10 + 5}%`,
                                      animationDelay: `${totalDelay}s`, // 直接寫入計算後的秒數
                                      animationDuration: "10s",
                                    }}
                                  >
                                    {c.content}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="p-8">
                          {/* 發布者資訊區 */}
                          <div className="flex items-center gap-3 mb-6 bg-black/40 p-3 rounded-2xl border border-gray-800/50">
                            <img
                              src={
                                vid.author?.avatar_url ||
                                `https://api.dicebear.com/7.x/bottts/svg?seed=${vid.created_by}`
                              }
                              style={{
                                backgroundColor:
                                  vid.author?.avatar_bg || "#ffffff",
                              }}
                              className="w-8 h-8 rounded-full border border-gray-700 object-cover"
                            />
                            <div className="flex flex-col">
                              <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-none">
                                Posted By
                              </span>
                              <span className="text-sm font-bold text-yellow-500">
                                {vid.author?.display_name || "未知大師"}
                              </span>
                            </div>
                          </div>

                          <div className="flex justify-between items-center mb-6">
                            <div className="flex gap-2 overflow-x-auto no-scrollbar">
                              {vid.title?.split(",").map(
                                (t: any) =>
                                  t.trim() && (
                                    <span
                                      key={t}
                                      className="bg-gray-800 text-blue-400 px-4 py-1.5 rounded-full text-[11px] font-black"
                                    >
                                      #{t}
                                    </span>
                                  ),
                              )}
                            </div>
                            {user.id === vid.created_by && (
                              <button
                                onClick={async () => {
                                  if (confirm("確定要刪除嗎？")) {
                                    const { error } = await supabase
                                      .from("videos")
                                      .delete()
                                      .eq("id", vid.id);

                                    if (!error) {
                                      // 關鍵：刪除成功後，立刻手動更新本人的列表
                                      setVideoList((prev) =>
                                        prev.filter((v) => v.id !== vid.id),
                                      );
                                    } else {
                                      alert("刪除失敗：" + error.message);
                                    }
                                  }
                                }}
                                className="text-gray-700 hover:text-red-500 cursor-pointer"
                              >
                                <svg
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {/* 彈幕輸入框 */}
                          <div className="mb-6 px-2">
                            <div className="relative">
                              <input
                                id={`danmaku-input-${vid.id}`} // 給每個 input 一個唯一 ID
                                disabled={user.id === vid.created_by}
                                className={`w-full bg-black border rounded-2xl py-3 px-4 text-sm outline-none transition-all pr-14 ${
                                  user.id === vid.created_by
                                    ? "border-gray-900 text-gray-700 cursor-not-allowed opacity-50"
                                    : "border-gray-800 focus:border-blue-500"
                                }`}
                                placeholder={
                                  user.id === vid.created_by
                                    ? "不能在自己的影片發彈幕喔 💩"
                                    : "發射彈幕吐槽..."
                                }
                                onKeyDown={(e) => {
                                  // 依然保留 Enter 送出的功能
                                  if (e.key === "Enter") {
                                    handleSendDanmaku(vid.id);
                                  }
                                }}
                              />

                              {/* 這是新的發射按鈕 */}
                              {user.id !== vid.created_by && (
                                <button
                                  onClick={() => handleSendDanmaku(vid.id)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl transition-all active:scale-90"
                                >
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <line x1="22" y1="2" x2="11" y2="13"></line>
                                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-8 border-t border-gray-800/50">
                            <div className="flex flex-col">
                              <span className="text-2xl text-gray-600 font-bold uppercase">
                                評價
                              </span>
                              <span className="text-3xl font-black text-yellow-500 leading-none mt-1">
                                {getAvg(vid.ratings)}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {[
                                { l: "ㄅ", s: 4 },
                                { l: "ㄆ", s: 3 },
                                { l: "ㄇ", s: 2 },
                                { l: "ㄈ", s: 1 },
                              ].map((i) => (
                                <button
                                  key={i.l}
                                  onClick={() =>
                                    handleRate(vid.id, i.s, vid.created_by)
                                  }
                                  disabled={user.id === vid.created_by}
                                  className={`w-11 h-11 rounded-2xl border-2 font-black text-lg transition-all cursor-pointer ${user.id === vid.created_by ? "border-gray-800 text-gray-800 opacity-20" : "border-gray-800 hover:bg-yellow-500 hover:text-black"}`}
                                >
                                  {i.l}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-6 flex flex-wrap gap-2">
                            {vid.ratings?.map((r: any, idx: number) => (
                              <div
                                key={idx}
                                className="bg-gray-800/30 px-3 py-1.5 rounded-xl text-[10px] border border-gray-800/50 flex items-center gap-2"
                              >
                                <img
                                  src={
                                    r.profiles?.avatar_url ||
                                    `https://api.dicebear.com/7.x/bottts/svg?seed=${r.user_id}`
                                  }
                                  // 加上這行！
                                  style={{
                                    backgroundColor:
                                      r.profiles?.avatar_bg || "#ffffff",
                                  }}
                                  className="w-4 h-4 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.1)]"
                                />
                                <span className="text-gray-400 font-bold">
                                  {r.profiles?.display_name}:
                                </span>
                                <span className="font-black text-white">
                                  {r.score === 4
                                    ? "ㄅ"
                                    : r.score === 3
                                      ? "ㄆ"
                                      : r.score === 2
                                        ? "ㄇ"
                                        : "ㄈ"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
